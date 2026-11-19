//! Fairway math: constant-product swap with the fee taken on input, proportional LP shares,
//! and fee-tier resolution. Integer-only (u64 amounts, u128 intermediates, checked arithmetic),
//! every rounding decision favours the pool.
#![forbid(unsafe_code)]

pub mod tier;
pub use tier::*;

/// Basis-point denominator.
pub const BPS_DENOM: u64 = 10_000;
/// LP units permanently locked by the first deposit (Uniswap v2 style), so the pool can never be
/// fully drained and share price manipulation via a tiny first deposit is uneconomic.
pub const MIN_LIQUIDITY: u64 = 1_000;
/// Hard cap on any fee (10%).
pub const MAX_FEE_BPS: u16 = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    Overflow,
    ZeroAmount,
    ZeroReserves,
    InvalidFee,
    InsufficientLiquidity,
    InsufficientOutput,
}

pub type MathResult<T> = Result<T, MathError>;

/// Result of a swap quote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SwapQuote {
    /// tokens the trader receives
    pub amount_out: u64,
    /// fee charged on the input (stays in the pool → LPs)
    pub fee: u64,
    /// input that moves along the curve
    pub in_after_fee: u64,
}

/// Fee on input, rounded UP (pool-favourable).
pub fn fee_on_input(amount_in: u64, fee_bps: u16) -> MathResult<u64> {
    if fee_bps > MAX_FEE_BPS {
        return Err(MathError::InvalidFee);
    }
    let num = (amount_in as u128).checked_mul(fee_bps as u128).ok_or(MathError::Overflow)?;
    let fee = num.div_ceil(BPS_DENOM as u128);
    u64::try_from(fee).map_err(|_| MathError::Overflow)
}

/// Constant-product swap with fee on input:
/// `out = floor(in_after_fee * reserve_out / (reserve_in + in_after_fee))`.
pub fn swap_quote(amount_in: u64, reserve_in: u64, reserve_out: u64, fee_bps: u16) -> MathResult<SwapQuote> {
    if amount_in == 0 {
        return Err(MathError::ZeroAmount);
    }
    if reserve_in == 0 || reserve_out == 0 {
        return Err(MathError::ZeroReserves);
    }
    let fee = fee_on_input(amount_in, fee_bps)?;
    let in_after_fee = amount_in.checked_sub(fee).ok_or(MathError::Overflow)?;
    let num = (in_after_fee as u128).checked_mul(reserve_out as u128).ok_or(MathError::Overflow)?;
    let den = (reserve_in as u128).checked_add(in_after_fee as u128).ok_or(MathError::Overflow)?;
    let out = num / den; // floor → pool-favourable
    let amount_out = u64::try_from(out).map_err(|_| MathError::Overflow)?;
    if amount_out == 0 {
        return Err(MathError::InsufficientOutput);
    }
    if amount_out >= reserve_out {
        return Err(MathError::InsufficientLiquidity);
    }
    Ok(SwapQuote { amount_out, fee, in_after_fee })
}

/// Integer square root (floor) for u128.
pub fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    // Newton's method from a power-of-two upper bound
    let mut x = 1u128 << (128 - n.leading_zeros()).div_ceil(2);
    loop {
        let y = (x + n / x) >> 1;
        if y >= x {
            return x;
        }
        x = y;
    }
}

/// First deposit: total LP = floor(sqrt(a·b)); `MIN_LIQUIDITY` of it is locked forever.
/// Returns (lp_to_depositor, new_total_supply_including_locked).
pub fn initial_lp(amount_a: u64, amount_b: u64) -> MathResult<(u64, u64)> {
    if amount_a == 0 || amount_b == 0 {
        return Err(MathError::ZeroAmount);
    }
    let product = (amount_a as u128).checked_mul(amount_b as u128).ok_or(MathError::Overflow)?;
    let total = u64::try_from(isqrt(product)).map_err(|_| MathError::Overflow)?;
    if total <= MIN_LIQUIDITY {
        return Err(MathError::InsufficientLiquidity);
    }
    Ok((total - MIN_LIQUIDITY, total))
}

/// Result of a proportional deposit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Deposit {
    pub lp: u64,
    pub used_a: u64,
    pub used_b: u64,
}

fn mul_div_floor(a: u64, b: u64, c: u64) -> MathResult<u64> {
    if c == 0 {
        return Err(MathError::ZeroReserves);
    }
    let v = (a as u128).checked_mul(b as u128).ok_or(MathError::Overflow)? / c as u128;
    u64::try_from(v).map_err(|_| MathError::Overflow)
}

fn mul_div_ceil(a: u64, b: u64, c: u64) -> MathResult<u64> {
    if c == 0 {
        return Err(MathError::ZeroReserves);
    }
    let v = (a as u128).checked_mul(b as u128).ok_or(MathError::Overflow)?.div_ceil(c as u128);
    u64::try_from(v).map_err(|_| MathError::Overflow)
}

/// Subsequent deposit: LP minted = min(a·S/Ra, b·S/Rb) (floor); the depositor pays
/// ceil(lp·R/S) of each token (pool-favourable), never more than offered.
pub fn deposit(max_a: u64, max_b: u64, reserve_a: u64, reserve_b: u64, supply: u64) -> MathResult<Deposit> {
    if max_a == 0 || max_b == 0 {
        return Err(MathError::ZeroAmount);
    }
    if reserve_a == 0 || reserve_b == 0 || supply == 0 {
        return Err(MathError::ZeroReserves);
    }
    let lp = mul_div_floor(max_a, supply, reserve_a)?.min(mul_div_floor(max_b, supply, reserve_b)?);
    if lp == 0 {
        return Err(MathError::InsufficientOutput);
    }
    let used_a = mul_div_ceil(lp, reserve_a, supply)?;
    let used_b = mul_div_ceil(lp, reserve_b, supply)?;
    debug_assert!(used_a <= max_a && used_b <= max_b);
    Ok(Deposit { lp, used_a, used_b })
}

/// Withdrawal: floor(lp·R/S) of each reserve (pool-favourable).
pub fn withdraw(lp: u64, reserve_a: u64, reserve_b: u64, supply: u64) -> MathResult<(u64, u64)> {
    if lp == 0 {
        return Err(MathError::ZeroAmount);
    }
    if lp > supply.saturating_sub(MIN_LIQUIDITY) {
        return Err(MathError::InsufficientLiquidity);
    }
    Ok((mul_div_floor(lp, reserve_a, supply)?, mul_div_floor(lp, reserve_b, supply)?))
}

#[cfg(test)]
mod tests;
