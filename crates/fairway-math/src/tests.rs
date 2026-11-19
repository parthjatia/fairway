use super::*;

/// tiny deterministic PRNG for property-style tests (no external deps)
struct XorShift(u64);
impl XorShift {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next() % (hi - lo + 1)
    }
    /// log-uniform in [1, 2^bits)
    fn wide(&mut self, bits: u32) -> u64 {
        let b = 1 + (self.next() % bits as u64) as u32;
        let v = self.next() >> (64 - b);
        v.max(1)
    }
}

#[test]
fn fee_rounds_up() {
    assert_eq!(fee_on_input(10_000, 30).unwrap(), 30);
    assert_eq!(fee_on_input(1, 30).unwrap(), 1); // tiny trades still pay
    assert_eq!(fee_on_input(0, 30).unwrap(), 0);
    assert_eq!(fee_on_input(3_334, 30).unwrap(), 11); // 10.002 → 11
    assert_eq!(fee_on_input(u64::MAX, 1_000).unwrap(), u64::MAX / 10 + 1);
    assert_eq!(fee_on_input(100, 1_001), Err(MathError::InvalidFee));
}

#[test]
fn swap_known_values() {
    // 1,000,000 / 1,000,000 pool, 10,000 in at 30 bps → fee 30, after 9,970 → out floor(9970e6/1,009,970) = 9871
    let q = swap_quote(10_000, 1_000_000, 1_000_000, 30).unwrap();
    assert_eq!(q.fee, 30);
    assert_eq!(q.in_after_fee, 9_970);
    assert_eq!(q.amount_out, 9_871);
    // lower fee → more out
    let q5 = swap_quote(10_000, 1_000_000, 1_000_000, 5).unwrap();
    let q80 = swap_quote(10_000, 1_000_000, 1_000_000, 80).unwrap();
    assert!(q5.amount_out > q.amount_out && q.amount_out > q80.amount_out);
}

#[test]
fn swap_errors() {
    assert_eq!(swap_quote(0, 10, 10, 30), Err(MathError::ZeroAmount));
    assert_eq!(swap_quote(10, 0, 10, 30), Err(MathError::ZeroReserves));
    assert_eq!(swap_quote(1, 1_000_000, 1_000, 30), Err(MathError::InsufficientOutput));
    assert_eq!(swap_quote(10, 10, 10, 1_001), Err(MathError::InvalidFee));
}

#[test]
fn no_overflow_at_extremes() {
    let q = swap_quote(u64::MAX / 2, u64::MAX / 2, u64::MAX, 30).unwrap();
    assert!(q.amount_out < u64::MAX);
    let q = swap_quote(u64::MAX, 1, u64::MAX, 0).unwrap();
    assert!(q.amount_out < u64::MAX);
    assert!(initial_lp(u64::MAX, u64::MAX).is_ok());
    assert_eq!(initial_lp(u64::MAX, u64::MAX).unwrap().1, u64::MAX);
    assert!(deposit(u64::MAX, u64::MAX, u64::MAX, u64::MAX, u64::MAX).is_ok());
}

#[test]
fn prop_k_never_decreases_and_pool_favoured() {
    let mut r = XorShift(0x9E37_79B9_7F4A_7C15);
    let mut checked = 0;
    for _ in 0..200_000 {
        let rin = r.wide(60);
        let rout = r.wide(60);
        let amt = r.wide(60);
        let fee = r.range(0, 1_000) as u16;
        if let Ok(q) = swap_quote(amt, rin, rout, fee) {
            let k0 = rin as u128 * rout as u128;
            let k1 = (rin as u128 + amt as u128) * (rout - q.amount_out) as u128;
            assert!(k1 >= k0, "k decreased: {rin} {rout} {amt} {fee}");
            // no-fee curve output is an upper bound (rounding favours the pool)
            let ideal = (q.in_after_fee as u128 * rout as u128) / (rin as u128 + q.in_after_fee as u128);
            assert!(q.amount_out as u128 <= ideal);
            assert!(q.fee + q.in_after_fee == amt);
            checked += 1;
        }
    }
    assert!(checked > 50_000);
}

#[test]
fn prop_round_trip_never_profits() {
    let mut r = XorShift(42);
    for _ in 0..100_000 {
        let ra = r.range(1_000, 1u64 << 50);
        let rb = r.range(1_000, 1u64 << 50);
        let amt = r.range(1, ra);
        let fee = r.range(0, 100) as u16;
        let Ok(q1) = swap_quote(amt, ra, rb, fee) else { continue };
        let Ok(q2) = swap_quote(q1.amount_out, rb - q1.amount_out, ra + amt, fee) else { continue };
        assert!(q2.amount_out <= amt, "round trip profit: {ra} {rb} {amt} {fee}");
    }
}

#[test]
fn isqrt_exact() {
    for n in [0u128, 1, 2, 3, 4, 15, 16, 17, 1 << 64, u64::MAX as u128 * u64::MAX as u128, u128::MAX] {
        let s = isqrt(n);
        assert!(s * s <= n);
        assert!((s + 1).checked_mul(s + 1).map_or(true, |v| v > n));
    }
    let mut r = XorShift(7);
    for _ in 0..50_000 {
        let n = (r.next() as u128) << (r.next() % 64) | r.next() as u128;
        let s = isqrt(n);
        assert!(s * s <= n && (s + 1).checked_mul(s + 1).map_or(true, |v| v > n));
    }
}

#[test]
fn first_deposit_edge_cases() {
    // sqrt(1000*1000) = 1000 = MIN_LIQUIDITY → rejected (depositor would get 0)
    assert_eq!(initial_lp(1_000, 1_000), Err(MathError::InsufficientLiquidity));
    assert_eq!(initial_lp(0, 5), Err(MathError::ZeroAmount));
    let (user, total) = initial_lp(1_001 * 1_001, 1).unwrap();
    assert_eq!(total, 1_001);
    assert_eq!(user, 1);
    let (user, total) = initial_lp(10_000_000_000_000, 1_500_000_000_000).unwrap();
    assert_eq!(total, isqrt(10_000_000_000_000u128 * 1_500_000_000_000) as u64);
    assert_eq!(user, total - MIN_LIQUIDITY);
    // locked liquidity can never be withdrawn
    assert_eq!(withdraw(total, 10, 10, total), Err(MathError::InsufficientLiquidity));
    assert!(withdraw(user, 10_000_000_000_000, 1_500_000_000_000, total).is_ok());
}

#[test]
fn deposit_is_proportional_and_pool_favoured() {
    let d = deposit(1_000, 5_000, 10_000, 20_000, 14_142).unwrap();
    // limited by a: 1000*14142/10000 = 1414
    assert_eq!(d.lp, 1_414);
    assert_eq!(d.used_a, 1_000); // ceil(1414*10000/14142) = 999.86 → 1000
    assert_eq!(d.used_b, 2_000); // ceil(1414*20000/14142) = 1999.7 → 2000
    let mut r = XorShift(99);
    for _ in 0..100_000 {
        let ra = r.range(1, 1u64 << 50);
        let rb = r.range(1, 1u64 << 50);
        let s = r.range(MIN_LIQUIDITY + 1, 1u64 << 50);
        let a = r.range(1, 1u64 << 50);
        let b = r.range(1, 1u64 << 50);
        let Ok(d) = deposit(a, b, ra, rb, s) else { continue };
        assert!(d.used_a <= a && d.used_b <= b);
        // value per LP never decreases: (R+used)/(S+lp) ≥ R/S
        assert!((ra as u128 + d.used_a as u128) * s as u128 >= ra as u128 * (s as u128 + d.lp as u128));
        assert!((rb as u128 + d.used_b as u128) * s as u128 >= rb as u128 * (s as u128 + d.lp as u128));
    }
}

#[test]
fn remove_liquidity_proportional() {
    let (a, b) = withdraw(2_500, 10_000, 40_000, 10_000).unwrap();
    assert_eq!((a, b), (2_500, 10_000));
    let (a, b) = withdraw(1, 10, 10, 3_000).unwrap();
    assert_eq!((a, b), (0, 0)); // dust rounds down to the pool
    let mut r = XorShift(5);
    for _ in 0..100_000 {
        let s = r.range(MIN_LIQUIDITY + 1, 1u64 << 60);
        let lp = r.range(1, s - MIN_LIQUIDITY);
        let ra = r.wide(62);
        let rb = r.wide(62);
        let (a, b) = withdraw(lp, ra, rb, s).unwrap();
        assert!(a as u128 * s as u128 <= lp as u128 * ra as u128);
        assert!(b as u128 * s as u128 <= lp as u128 * rb as u128);
    }
}

#[test]
fn tier_resolution() {
    let s = |tier, updated_slot| Some(ScoreView { tier, updated_slot });
    assert_eq!(resolve_tier(None, 100, 50, TIER_STANDARD), (TIER_STANDARD, TierSource::Missing));
    assert_eq!(resolve_tier(s(TIER_RETAIL, 90), 100, 50, TIER_STANDARD), (TIER_RETAIL, TierSource::Score));
    assert_eq!(resolve_tier(s(TIER_TOXIC, 90), 100, 50, TIER_STANDARD), (TIER_TOXIC, TierSource::Score));
    // exactly at ttl is still fresh; one past is stale
    assert_eq!(resolve_tier(s(TIER_RETAIL, 50), 100, 50, TIER_STANDARD).1, TierSource::Score);
    assert_eq!(resolve_tier(s(TIER_RETAIL, 49), 100, 50, TIER_STANDARD), (TIER_STANDARD, TierSource::Stale));
    assert_eq!(resolve_tier(s(7, 99), 100, 50, TIER_STANDARD), (TIER_STANDARD, TierSource::Invalid));
    assert_eq!(resolve_tier(s(TIER_RETAIL, 200), 100, 50, TIER_STANDARD), (TIER_STANDARD, TierSource::Invalid));
    // a misconfigured RETAIL default is clamped: fresh wallets never pay less than STANDARD
    assert_eq!(resolve_tier(None, 100, 50, TIER_RETAIL).0, TIER_STANDARD);
    assert_eq!(resolve_tier(None, 100, 50, TIER_TOXIC).0, TIER_TOXIC);
}

#[test]
fn fee_schedule_validation() {
    assert!(valid_fee_schedule(&[5, 30, 80]));
    assert!(valid_fee_schedule(&[30, 30, 30]));
    assert!(!valid_fee_schedule(&[40, 30, 80]));
    assert!(!valid_fee_schedule(&[5, 90, 80]));
    assert!(!valid_fee_schedule(&[5, 30, 1_001]));
}
