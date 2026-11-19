//! Bot-tax rebate: the toxic tier's fee above the STANDARD fee (the "premium") is partly recycled to RETAIL-tier
//! wallets as a lower fee, funded only by the premium of the PREVIOUS epoch. All integer math, floors in the pool's favour.
//!
//! Volumes and premiums are tracked in quote-token equivalents (`quote_equivalent`) so one number covers both swap directions.

use crate::{MathError, MathResult, BPS_DENOM};

/// Quote-token value of `amount` (units of the swap's INPUT token): quote-in is already quote; base-in is valued at the
/// pool's spot price `reserve_quote / reserve_base` (floor).
pub fn quote_equivalent(amount: u64, a_to_b: bool, reserve_base: u64, reserve_quote: u64) -> MathResult<u64> {
    if !a_to_b {
        return Ok(amount);
    }
    if reserve_base == 0 {
        return Err(MathError::ZeroReserves);
    }
    let v = (amount as u128).checked_mul(reserve_quote as u128).ok_or(MathError::Overflow)? / reserve_base as u128;
    u64::try_from(v).map_err(|_| MathError::Overflow)
}

/// Toxic premium of one swap: the fee charged minus what the STANDARD fee would have charged on the same input.
pub fn toxic_premium(fee_charged: u64, amount_in: u64, standard_fee_bps: u16) -> MathResult<u64> {
    Ok(fee_charged.saturating_sub(crate::fee_on_input(amount_in, standard_fee_bps)?))
}

/// What an epoch roll sets for the next epoch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct EpochRebate {
    /// bps taken off the RETAIL fee
    pub rate_bps: u16,
    /// quote-equivalent budget available to fund it in the next epoch (hard cap enforced per swap)
    pub budget_q: u64,
}

/// `budget = share × premium`; `rate = min(budget ÷ retail_volume, base_fee − floor)` (bps, floor).
/// Guarantee: `rate × retail_volume / 10_000 <= budget <= share × premium`. Zero premium or zero volume → no rebate.
pub fn epoch_rebate(premium_q: u64, retail_volume_q: u64, share_bps: u16, base_fee_bps: u16, floor_bps: u16) -> MathResult<EpochRebate> {
    if share_bps as u64 > BPS_DENOM {
        return Err(MathError::InvalidFee);
    }
    let budget = (premium_q as u128) * (share_bps as u128) / BPS_DENOM as u128;
    let headroom = base_fee_bps.saturating_sub(floor_bps) as u128;
    if budget == 0 || retail_volume_q == 0 || headroom == 0 {
        return Ok(EpochRebate::default());
    }
    let raw = budget * BPS_DENOM as u128 / retail_volume_q as u128;
    let rate = raw.min(headroom) as u16;
    if rate == 0 {
        return Ok(EpochRebate::default());
    }
    Ok(EpochRebate { rate_bps: rate, budget_q: u64::try_from(budget).map_err(|_| MathError::Overflow)? })
}

/// Rebate (bps) one RETAIL-tier swap actually gets: never more than the epoch rate, never below the fee floor, and never
/// more than what is left of the budget (`notional × rebate / 10_000 <= budget_left`).
pub fn swap_rebate_bps(rate_bps: u16, budget_left_q: u64, notional_q: u64, base_fee_bps: u16, floor_bps: u16) -> u16 {
    if rate_bps == 0 || budget_left_q == 0 || notional_q == 0 {
        return 0;
    }
    let by_budget = (budget_left_q as u128) * BPS_DENOM as u128 / notional_q as u128;
    let headroom = base_fee_bps.saturating_sub(floor_bps) as u128;
    (rate_bps as u128).min(by_budget).min(headroom) as u16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quote_equivalent_values_base_at_spot() {
        assert_eq!(quote_equivalent(500, false, 10, 1500).unwrap(), 500);
        assert_eq!(quote_equivalent(2, true, 10, 1500).unwrap(), 300);
        assert_eq!(quote_equivalent(1, true, 0, 1500), Err(MathError::ZeroReserves));
    }

    #[test]
    fn premium_is_fee_above_standard() {
        // 80 bps on 1_000_000 = 8_000; standard 30 bps = 3_000 → premium 5_000
        assert_eq!(toxic_premium(8_000, 1_000_000, 30).unwrap(), 5_000);
        assert_eq!(toxic_premium(3_000, 1_000_000, 30).unwrap(), 0);
        assert_eq!(toxic_premium(1_000, 1_000_000, 30).unwrap(), 0); // never negative
    }

    #[test]
    fn zero_premium_or_volume_means_no_rebate() {
        assert_eq!(epoch_rebate(0, 1_000_000, 1_000, 30, 5).unwrap(), EpochRebate::default());
        assert_eq!(epoch_rebate(5_000, 0, 1_000, 30, 5).unwrap(), EpochRebate::default());
        assert_eq!(epoch_rebate(5_000, 1_000_000, 0, 30, 5).unwrap(), EpochRebate::default());
    }

    #[test]
    fn rate_is_share_of_premium_over_retail_volume() {
        // premium 5_000 × 10% = 500 budget over 1_000_000 volume = 5 bps
        let r = epoch_rebate(5_000, 1_000_000, 1_000, 30, 5).unwrap();
        assert_eq!((r.rate_bps, r.budget_q), (5, 500));
    }

    #[test]
    fn rate_respects_floor() {
        // huge premium relative to volume would be 1_000 bps; floor 5 on a 30 bps fee caps it at 25
        let r = epoch_rebate(10_000_000, 1_000_000, 10_000, 30, 5).unwrap();
        assert_eq!(r.rate_bps, 25);
        // base fee at or below the floor → no rebate at all
        assert_eq!(epoch_rebate(10_000_000, 1_000_000, 10_000, 5, 5).unwrap(), EpochRebate::default());
        assert_eq!(epoch_rebate(10_000_000, 1_000_000, 10_000, 4, 5).unwrap(), EpochRebate::default());
    }

    #[test]
    fn epoch_rebate_never_exceeds_share_of_premium() {
        for premium in [1u64, 99, 5_000, 123_456_789, u64::MAX / 4] {
            for vol in [1u64, 1_000, 1_000_000, 987_654_321, u64::MAX / 4] {
                for share in [0u16, 1, 1_000, 2_500, 5_000, 10_000] {
                    let r = epoch_rebate(premium, vol, share, 30, 5).unwrap();
                    assert!((r.budget_q as u128) <= premium as u128 * share as u128 / 10_000);
                    // the rate applied to the volume that produced it never costs more than the budget
                    assert!((r.rate_bps as u128) * (vol as u128) / 10_000 <= r.budget_q as u128);
                    assert!(r.rate_bps <= 25);
                }
            }
        }
    }

    #[test]
    fn invalid_share_rejected() {
        assert_eq!(epoch_rebate(1, 1, 10_001, 30, 5), Err(MathError::InvalidFee));
    }

    #[test]
    fn swap_rebate_is_capped_by_rate_budget_and_floor() {
        assert_eq!(swap_rebate_bps(5, 1_000_000, 1_000_000, 30, 5), 5);
        // budget for only 2 bps of this trade
        assert_eq!(swap_rebate_bps(5, 200, 1_000_000, 30, 5), 2);
        // exhausted budget
        assert_eq!(swap_rebate_bps(5, 0, 1_000_000, 30, 5), 0);
        // floor
        assert_eq!(swap_rebate_bps(40, u64::MAX, 1_000_000, 30, 5), 25);
        assert_eq!(swap_rebate_bps(40, u64::MAX, 1_000_000, 5, 5), 0);
        assert_eq!(swap_rebate_bps(5, 1, 0, 30, 5), 0);
    }

    #[test]
    fn swap_rebate_never_costs_more_than_budget_left() {
        for budget in [1u64, 7, 500, 10_000, 1_000_000] {
            for notional in [1u64, 3, 999, 1_000_000, 5_000_000_000] {
                let r = swap_rebate_bps(1_000, budget, notional, 1_000, 0) as u128;
                assert!(r * notional as u128 / 10_000 <= budget as u128);
            }
        }
    }
}
