//! Onchain markout scoring math (M13). Integer-only; mirrored bit-for-bit by
//! `packages/scoring/src/onchain.ts` and checked against `vectors/onchain.json` on both sides.
//!
//! Units: prices are fixed point with `PRICE_SCALE` (1e6) = quote UI units per base UI unit;
//! notionals are raw quote-token units (e.g. USDC with 6 decimals); markouts are integer bps.

use crate::{MathError, MathResult, BPS_DENOM};

pub const PRICE_SCALE: u64 = 1_000_000;
/// A single trade's markout is clamped to ±100% so one oracle glitch cannot dominate a score.
pub const MARKOUT_CLAMP_BPS: i64 = 10_000;
/// side: trader RECEIVES base
pub const SIDE_BUY: u8 = 0;
/// side: trader SELLS base
pub const SIDE_SELL: u8 = 1;

/// markout_bps = s * (mid − exec) / exec * 10_000 (s = +1 buy, −1 sell), truncated toward zero, clamped.
pub fn markout_bps(side: u8, exec_price: u64, mid: u64) -> MathResult<i64> {
    if exec_price == 0 || mid == 0 {
        return Err(MathError::ZeroAmount);
    }
    let s: i128 = if side == SIDE_BUY { 1 } else { -1 };
    let m = s * (mid as i128 - exec_price as i128) * BPS_DENOM as i128 / exec_price as i128;
    Ok(m.clamp(-(MARKOUT_CLAMP_BPS as i128), MARKOUT_CLAMP_BPS as i128) as i64)
}

fn pow10(e: u32) -> MathResult<u128> {
    10u128.checked_pow(e).ok_or(MathError::Overflow)
}

/// Pre-fee execution price (quote per base, 1e6 fixed point) from raw token amounts.
pub fn exec_price_e6(quote_raw: u64, quote_decimals: u8, base_raw: u64, base_decimals: u8) -> MathResult<u64> {
    if quote_raw == 0 || base_raw == 0 {
        return Err(MathError::ZeroAmount);
    }
    let num = (quote_raw as u128).checked_mul(pow10(base_decimals as u32)?).ok_or(MathError::Overflow)?.checked_mul(PRICE_SCALE as u128).ok_or(MathError::Overflow)?;
    let den = (base_raw as u128).checked_mul(pow10(quote_decimals as u32)?).ok_or(MathError::Overflow)?;
    let p = num / den;
    if p == 0 {
        return Err(MathError::ZeroAmount);
    }
    u64::try_from(p).map_err(|_| MathError::Overflow)
}

/// Pyth price (`price * 10^expo`) → 1e6 fixed point. Rejects non-positive prices.
pub fn pyth_to_price_e6(price: i64, expo: i32) -> MathResult<u64> {
    if price <= 0 {
        return Err(MathError::ZeroAmount);
    }
    let shift = expo + 6;
    if !(-30..=30).contains(&shift) {
        return Err(MathError::Overflow);
    }
    let p = price as u128;
    let v = if shift >= 0 { p.checked_mul(pow10(shift as u32)?).ok_or(MathError::Overflow)? } else { p / pow10((-shift) as u32)? };
    if v == 0 {
        return Err(MathError::ZeroAmount);
    }
    u64::try_from(v).map_err(|_| MathError::Overflow)
}

/// conf / price ≤ max_conf_bps / 10_000.
pub fn confidence_ok(price: i64, conf: u64, max_conf_bps: u16) -> bool {
    price > 0 && (conf as u128) * (BPS_DENOM as u128) <= (price as u128) * (max_conf_bps as u128)
}

/// Running sums that define a wallet's onchain score.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Sums {
    pub sum_notional: u64,
    pub sum_weighted_markout: i128,
    pub trades: u32,
}

pub fn accumulate(s: Sums, notional: u64, markout: i64) -> MathResult<Sums> {
    Ok(Sums {
        sum_notional: s.sum_notional.checked_add(notional).ok_or(MathError::Overflow)?,
        sum_weighted_markout: s
            .sum_weighted_markout
            .checked_add((notional as i128).checked_mul(markout as i128).ok_or(MathError::Overflow)?)
            .ok_or(MathError::Overflow)?,
        trades: s.trades.checked_add(1).ok_or(MathError::Overflow)?,
    })
}

/// Σ(n·m) / (Σn + K), truncated toward zero, saturated to i32. Same shrinkage as `shrunkScore` in packages/scoring.
pub fn score_bps(s: &Sums, prior_notional: u64) -> i32 {
    let den = s.sum_notional as i128 + prior_notional as i128;
    if den <= 0 {
        return 0;
    }
    (s.sum_weighted_markout / den).clamp(i32::MIN as i128, i32::MAX as i128) as i32
}

/// Thresholds (same names/defaults as `ScoringConfig` in packages/scoring; history in slots).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TierParams {
    pub prior_notional: u64,
    pub toxic_bps: i32,
    pub toxic_min_trades: u32,
    pub retail_bps: i32,
    pub retail_min_trades: u32,
    pub retail_min_history_slots: u64,
}

/// TOXIC if score ≥ toxic_bps and trades ≥ min; RETAIL if score ≤ retail_bps and trades ≥ min and history long enough;
/// STANDARD otherwise. Comparisons are exact (cross-multiplied), not on the truncated score.
pub fn onchain_tier(s: &Sums, history_slots: u64, p: &TierParams) -> u8 {
    let den = s.sum_notional as i128 + p.prior_notional as i128;
    if den <= 0 || s.trades == 0 {
        return crate::TIER_STANDARD;
    }
    let w = s.sum_weighted_markout;
    if w >= p.toxic_bps as i128 * den && s.trades >= p.toxic_min_trades {
        return crate::TIER_TOXIC;
    }
    if w <= p.retail_bps as i128 * den && s.trades >= p.retail_min_trades && history_slots >= p.retail_min_history_slots {
        return crate::TIER_RETAIL;
    }
    crate::TIER_STANDARD
}
