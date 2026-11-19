//! Launch fee schedule (M16): during a launch window the fee depends on the tier AND the slots since launch.
//! Each tier decays linearly from its start fee to its end fee over `window_slots`; after the window the pool's
//! normal tier fees apply. Rounded up (pool-favourable). Integer-only.

use crate::{MAX_FEE_BPS, NUM_TIERS};

/// Per-tier fee curve: `[RETAIL, STANDARD, TOXIC]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LaunchCurve {
    pub start_bps: [u16; NUM_TIERS],
    pub end_bps: [u16; NUM_TIERS],
}

/// Defaults: TOXIC 1000 → 80, STANDARD (fresh wallets) 300 → 30, RETAIL 30 → 5.
pub const DEFAULT_LAUNCH_CURVE: LaunchCurve = LaunchCurve { start_bps: [30, 300, 1_000], end_bps: [5, 30, 80] };
/// Default launch window: 750 slots ≈ 5 minutes at 400 ms.
pub const DEFAULT_LAUNCH_WINDOW_SLOTS: u64 = 750;

/// Valid curve: every tier decays (start ≥ end), tiers are ordered RETAIL ≤ STANDARD ≤ TOXIC at both ends, all ≤ MAX_FEE_BPS.
/// Ordering at both ends implies ordering at every slot (linear interpolation preserves it).
pub fn valid_launch_curve(c: &LaunchCurve) -> bool {
    (0..NUM_TIERS).all(|t| c.start_bps[t] >= c.end_bps[t] && c.start_bps[t] <= MAX_FEE_BPS)
        && c.start_bps[0] <= c.start_bps[1]
        && c.start_bps[1] <= c.start_bps[2]
        && c.end_bps[0] <= c.end_bps[1]
        && c.end_bps[1] <= c.end_bps[2]
}

/// Where a slot sits relative to a launch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchPhase {
    /// trading has not opened yet (swaps are refused)
    NotStarted,
    /// inside the window: the launch fee applies
    Window { elapsed: u64 },
    /// window over (or no launch configured): normal tier fees
    After,
}

pub fn launch_phase(slot: u64, launch_slot: u64, window_slots: u64) -> LaunchPhase {
    if window_slots == 0 {
        return LaunchPhase::After;
    }
    if slot < launch_slot {
        return LaunchPhase::NotStarted;
    }
    let elapsed = slot - launch_slot;
    if elapsed >= window_slots {
        LaunchPhase::After
    } else {
        LaunchPhase::Window { elapsed }
    }
}

/// Launch fee for `tier` at `elapsed` slots into a `window_slots` window:
/// `end + ceil((start − end) × (window − elapsed) / window)`. elapsed 0 → start; it reaches `end` after the window.
pub fn decayed_fee_bps(curve: &LaunchCurve, tier: u8, elapsed: u64, window_slots: u64) -> u16 {
    let t = (tier as usize).min(NUM_TIERS - 1);
    let (s, e) = (curve.start_bps[t] as u128, curve.end_bps[t] as u128);
    if window_slots == 0 || elapsed >= window_slots || s <= e {
        return curve.end_bps[t];
    }
    let remaining = (window_slots - elapsed) as u128;
    (e + ((s - e) * remaining).div_ceil(window_slots as u128)) as u16
}

/// The fee during a launch, or `None` when the normal tier fee applies (no launch / window over).
/// Callers must refuse swaps in `LaunchPhase::NotStarted`.
pub fn launch_fee_bps(curve: &LaunchCurve, tier: u8, slot: u64, launch_slot: u64, window_slots: u64) -> Option<u16> {
    match launch_phase(slot, launch_slot, window_slots) {
        LaunchPhase::Window { elapsed } => Some(decayed_fee_bps(curve, tier, elapsed, window_slots)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{TIER_RETAIL, TIER_STANDARD, TIER_TOXIC};
    const C: LaunchCurve = DEFAULT_LAUNCH_CURVE;

    #[test]
    fn block_zero_pays_start_fee() {
        assert_eq!(launch_fee_bps(&C, TIER_TOXIC, 1_000, 1_000, 750), Some(1_000));
        assert_eq!(launch_fee_bps(&C, TIER_STANDARD, 1_000, 1_000, 750), Some(300));
        assert_eq!(launch_fee_bps(&C, TIER_RETAIL, 1_000, 1_000, 750), Some(30));
    }

    #[test]
    fn linear_decay_rounded_up() {
        // halfway: toxic 80 + ceil(920 * 375 / 750) = 540
        assert_eq!(decayed_fee_bps(&C, TIER_TOXIC, 375, 750), 540);
        assert_eq!(decayed_fee_bps(&C, TIER_STANDARD, 375, 750), 165);
        assert_eq!(decayed_fee_bps(&C, TIER_RETAIL, 375, 750), 18); // 5 + ceil(12.5)
        // last slot of the window: still strictly above the end fee (rounded up)
        assert_eq!(decayed_fee_bps(&C, TIER_TOXIC, 749, 750), 82);
        assert_eq!(decayed_fee_bps(&C, TIER_RETAIL, 749, 750), 6);
    }

    #[test]
    fn monotone_non_increasing_and_tier_ordered() {
        for w in [1u64, 2, 7, 75, 750, 10_000] {
            let mut prev = [u16::MAX; 3];
            for e in 0..w.min(2_000) {
                let f: Vec<u16> = (0..3).map(|t| decayed_fee_bps(&C, t, e, w)).collect();
                assert!(f[0] <= f[1] && f[1] <= f[2], "tier order at {e}/{w}");
                for t in 0..3 {
                    assert!(f[t] <= prev[t] && f[t] >= C.end_bps[t] && f[t] <= C.start_bps[t]);
                    prev[t] = f[t];
                }
            }
        }
    }

    #[test]
    fn window_boundary() {
        assert_eq!(launch_phase(999, 1_000, 750), LaunchPhase::NotStarted);
        assert_eq!(launch_phase(1_000, 1_000, 750), LaunchPhase::Window { elapsed: 0 });
        assert_eq!(launch_phase(1_749, 1_000, 750), LaunchPhase::Window { elapsed: 749 });
        assert_eq!(launch_phase(1_750, 1_000, 750), LaunchPhase::After);
        assert_eq!(launch_fee_bps(&C, TIER_TOXIC, 1_750, 1_000, 750), None);
        assert_eq!(launch_fee_bps(&C, TIER_TOXIC, 1_749, 1_000, 750), Some(82));
        // no launch configured
        assert_eq!(launch_phase(5, 0, 0), LaunchPhase::After);
        assert_eq!(launch_fee_bps(&C, TIER_TOXIC, 5, 0, 0), None);
    }

    #[test]
    fn a_fresh_wallet_never_pays_less_than_standard_curve() {
        // fresh wallets resolve to STANDARD (or the default tier, which is >= STANDARD): the STANDARD curve is the floor
        for e in 0..750 {
            assert!(decayed_fee_bps(&C, TIER_STANDARD, e, 750) >= decayed_fee_bps(&C, TIER_RETAIL, e, 750));
            assert!(decayed_fee_bps(&C, TIER_STANDARD, e, 750) >= 30);
        }
    }

    #[test]
    fn curve_validation() {
        assert!(valid_launch_curve(&C));
        assert!(!valid_launch_curve(&LaunchCurve { start_bps: [30, 300, 1_001], end_bps: [5, 30, 80] }));
        assert!(!valid_launch_curve(&LaunchCurve { start_bps: [30, 300, 1_000], end_bps: [50, 30, 80] })); // retail rises & > standard end
        assert!(!valid_launch_curve(&LaunchCurve { start_bps: [400, 300, 1_000], end_bps: [5, 30, 80] })); // retail start > standard start
        assert!(!valid_launch_curve(&LaunchCurve { start_bps: [30, 20, 1_000], end_bps: [5, 30, 80] })); // standard rises
        assert!(valid_launch_curve(&LaunchCurve { start_bps: [5, 30, 80], end_bps: [5, 30, 80] })); // flat is fine
    }
}
