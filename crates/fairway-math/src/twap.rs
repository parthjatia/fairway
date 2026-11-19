//! Pool TWAP (M16) for tokens without an oracle: a price accumulator (price × slots) with a ring buffer of
//! observations, so `settle_markout` can read the average pool price over a past window.
//!
//! Semantics: the price in effect during slot `s` is the pool price after the last swap of the previous slot with a
//! swap. `cum(x)` = Σ price × slots up to slot `x`. An observation (slot, cum) is written by the first price update in a
//! slot that is at least `OBS_MIN_GAP` slots after the newest observation, so `OBS_CAP` observations cover at least
//! `OBS_CAP × OBS_MIN_GAP` slots of history. Between observations `cum` is interpolated linearly: exact when the price
//! did not change between them, otherwise off by at most the price change inside one gap (documented in RISKS.md).
//! Prices are 1e12 fixed point (`markout::PRICE_SCALE`).

pub const OBS_CAP: usize = 64;
/// minimum slots between observations (64 × 8 = 512 slots ≈ 3.4 min of history, more than max_settle_slots + horizon)
pub const OBS_MIN_GAP: u64 = 8;
/// default TWAP window that ends at the markout horizon (25 slots ≈ 10 s)
pub const DEFAULT_TWAP_WINDOW_SLOTS: u64 = 25;

/// Scalar part of the accumulator (the observation arrays are passed separately so callers can update them in place;
/// onchain the arrays live in the Pool account and are never copied onto the 4 KB SBF stack).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TwapHeader {
    pub last_slot: u64,
    /// pool price after the most recent update (in effect from the next slot on)
    pub last_price: u64,
    /// cumulative price × slots at `last_slot`
    pub cum: u128,
    /// index of the newest observation
    pub head: u16,
    /// observations written (≤ OBS_CAP); 0 = accumulator not started
    pub count: u16,
}

pub type ObsSlots = [u64; OBS_CAP];
pub type ObsCums = [u128; OBS_CAP];

fn cum_since_last(h: &TwapHeader, x: u64) -> u128 {
    h.cum.saturating_add((h.last_price as u128).saturating_mul((x - h.last_slot) as u128))
}

/// Record the pool price after a swap / liquidity change at `slot`. Slots never go backwards; a smaller slot is ignored.
pub fn record(h: &mut TwapHeader, obs_slot: &mut ObsSlots, obs_cum: &mut ObsCums, slot: u64, price: u64) {
    if h.count == 0 {
        *h = TwapHeader { last_slot: slot, last_price: price, cum: 0, head: 0, count: 1 };
        obs_slot[0] = slot;
        obs_cum[0] = 0;
        return;
    }
    if slot < h.last_slot {
        return;
    }
    if slot > h.last_slot {
        h.cum = cum_since_last(h, slot);
        h.last_slot = slot;
        if slot >= obs_slot[h.head as usize].saturating_add(OBS_MIN_GAP) {
            h.head = ((h.head as usize + 1) % OBS_CAP) as u16;
            obs_slot[h.head as usize] = slot;
            obs_cum[h.head as usize] = h.cum;
            h.count = (h.count + 1).min(OBS_CAP as u16);
        }
    }
    h.last_price = price;
}

fn oldest(h: &TwapHeader) -> usize {
    if (h.count as usize) < OBS_CAP {
        0
    } else {
        (h.head as usize + 1) % OBS_CAP
    }
}

/// Oldest slot `cum_at` can answer for.
pub fn oldest_slot(h: &TwapHeader, obs_slot: &ObsSlots) -> Option<u64> {
    (h.count > 0).then(|| obs_slot[oldest(h)])
}

/// Cumulative price × slots at slot `x`, or `None` when `x` is older than the history kept.
pub fn cum_at(h: &TwapHeader, obs_slot: &ObsSlots, obs_cum: &ObsCums, x: u64) -> Option<u128> {
    if h.count == 0 || x < oldest_slot(h, obs_slot)? {
        return None;
    }
    if x >= h.last_slot {
        return Some(cum_since_last(h, x));
    }
    // walk observations newest → oldest to find the bracket [obs_i, upper)
    let (mut up_slot, mut up_cum) = (h.last_slot, h.cum);
    for k in 0..h.count as usize {
        let i = (h.head as usize + OBS_CAP - k) % OBS_CAP;
        let (s, c) = (obs_slot[i], obs_cum[i]);
        if s <= x {
            if up_slot == s {
                return Some(c);
            }
            let span = (up_slot - s) as u128;
            return Some(c + (up_cum - c) * (x - s) as u128 / span);
        }
        up_slot = s;
        up_cum = c;
    }
    None
}

/// Time-weighted average price over `[from, to)`, 1e12 fixed point. `None` if the window is empty or out of history.
pub fn twap(h: &TwapHeader, obs_slot: &ObsSlots, obs_cum: &ObsCums, from: u64, to: u64) -> Option<u64> {
    if to <= from {
        return None;
    }
    let d = cum_at(h, obs_slot, obs_cum, to)?.checked_sub(cum_at(h, obs_slot, obs_cum, from)?)?;
    u64::try_from(d / (to - from) as u128).ok().filter(|p| *p > 0)
}

/// Owned accumulator (tests, offchain mirrors). Onchain code calls the free functions on the Pool's fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TwapState {
    pub h: TwapHeader,
    pub obs_slot: ObsSlots,
    pub obs_cum: ObsCums,
}

impl Default for TwapState {
    fn default() -> Self {
        Self { h: TwapHeader::default(), obs_slot: [0; OBS_CAP], obs_cum: [0; OBS_CAP] }
    }
}

impl TwapState {
    pub fn record(&mut self, slot: u64, price: u64) {
        record(&mut self.h, &mut self.obs_slot, &mut self.obs_cum, slot, price)
    }
    pub fn oldest_slot(&self) -> Option<u64> {
        oldest_slot(&self.h, &self.obs_slot)
    }
    pub fn cum_at(&self, x: u64) -> Option<u128> {
        cum_at(&self.h, &self.obs_slot, &self.obs_cum, x)
    }
    pub fn twap(&self, from: u64, to: u64) -> Option<u64> {
        twap(&self.h, &self.obs_slot, &self.obs_cum, from, to)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_price_twap_is_the_price() {
        let mut t = TwapState::default();
        t.record(100, 5_000);
        assert_eq!(t.twap(100, 200), Some(5_000));
        assert_eq!(t.twap(150, 151), Some(5_000));
        assert_eq!(t.twap(99, 120), None); // before history
        assert_eq!(t.twap(120, 120), None); // empty window
    }

    #[test]
    fn step_change_is_time_weighted() {
        let mut t = TwapState::default();
        t.record(0, 100);
        t.record(10, 300); // price 100 during [0,10), 300 from 10
        assert_eq!(t.twap(0, 10), Some(100));
        assert_eq!(t.twap(10, 20), Some(300));
        assert_eq!(t.twap(0, 20), Some(200));
        assert_eq!(t.twap(5, 15), Some(200));
    }

    #[test]
    fn several_swaps_in_one_slot_use_the_last_price() {
        let mut t = TwapState::default();
        t.record(0, 100);
        t.record(10, 1_000_000); // manipulation inside one slot...
        t.record(10, 300); // ...reverted in the same slot only counts the final price
        assert_eq!(t.twap(10, 20), Some(300));
    }

    #[test]
    fn exact_at_observations_and_matches_brute_force_with_dense_obs() {
        // updates every OBS_MIN_GAP slots: every update is an observation, so interpolation is exact
        let mut t = TwapState::default();
        let mut prices = vec![];
        for k in 0..40u64 {
            let p = 1_000 + (k * 37 % 11) * 100;
            t.record(k * OBS_MIN_GAP, p);
            prices.push(p);
        }
        let price_at = |s: u64| prices[((s / OBS_MIN_GAP) as usize).min(prices.len() - 1)];
        for (from, to) in [(0u64, 8u64), (3, 77), (100, 175), (8, 312), (311, 400)] {
            let brute: u128 = (from..to).map(|s| price_at(s) as u128).sum();
            assert_eq!(t.twap(from, to), Some((brute / (to - from) as u128) as u64), "{from}..{to}");
        }
    }

    #[test]
    fn ring_buffer_keeps_bounded_history() {
        let mut t = TwapState::default();
        for s in 0..2_000u64 {
            t.record(s, 1_000 + s);
        }
        assert_eq!(t.h.count as usize, OBS_CAP);
        let oldest = t.oldest_slot().unwrap();
        assert!(2_000 - oldest >= (OBS_CAP as u64 - 1) * OBS_MIN_GAP);
        assert_eq!(t.cum_at(oldest - 1), None);
        assert!(t.twap(oldest, 1_999).is_some());
        // price rising 1/slot: TWAP over [a,b) ≈ price at the midpoint (within one gap of interpolation error)
        let tw = t.twap(1_900, 1_950).unwrap() as i64;
        assert!((tw - (1_000 + 1_924)).abs() <= OBS_MIN_GAP as i64, "{tw}");
    }

    #[test]
    fn out_of_order_slots_are_ignored_and_no_overflow_at_extremes() {
        let mut t = TwapState::default();
        t.record(10, u64::MAX);
        t.record(5, 1);
        assert_eq!(t.h.last_slot, 10);
        t.record(1_000_000, u64::MAX);
        assert_eq!(t.twap(10, 1_000_000), Some(u64::MAX));
    }
}
