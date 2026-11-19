//! Fee-tier resolution. Kept here (pure) so the security-critical rules are unit-testable
//! without a validator. The program feeds it whatever it found at the signer's score PDA.

pub const TIER_RETAIL: u8 = 0;
pub const TIER_STANDARD: u8 = 1;
pub const TIER_TOXIC: u8 = 2;
pub const NUM_TIERS: usize = 3;

/// What the program could read from the `TraderScore` PDA derived from the swap signer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScoreView {
    pub tier: u8,
    pub updated_slot: u64,
}

/// Why a tier was chosen (logged / emitted for transparency).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TierSource {
    Score,
    Missing,
    Stale,
    Invalid,
}

/// Resolve the tier to charge:
/// - no score account → `default_tier` (never below STANDARD)
/// - stale (`current_slot − updated_slot > ttl`) → STANDARD-or-default
/// - invalid tier byte or a slot in the future → STANDARD-or-default
/// - otherwise the stored tier
///
/// `default_tier` is clamped to ≥ STANDARD so that a fresh wallet can never pay less than STANDARD
/// (wallet rotation never lowers a bot's fee).
pub fn resolve_tier(score: Option<ScoreView>, current_slot: u64, ttl_slots: u64, default_tier: u8) -> (u8, TierSource) {
    let fallback = default_tier.clamp(TIER_STANDARD, TIER_TOXIC);
    match score {
        None => (fallback, TierSource::Missing),
        Some(s) if s.tier as usize >= NUM_TIERS => (fallback, TierSource::Invalid),
        Some(s) if s.updated_slot > current_slot => (fallback, TierSource::Invalid),
        Some(s) if current_slot - s.updated_slot > ttl_slots => (fallback, TierSource::Stale),
        Some(s) => (s.tier, TierSource::Score),
    }
}

/// Validate a fee schedule: RETAIL ≤ STANDARD ≤ TOXIC ≤ MAX_FEE_BPS.
pub fn valid_fee_schedule(fees: &[u16; NUM_TIERS]) -> bool {
    fees[0] <= fees[1] && fees[1] <= fees[2] && fees[2] <= crate::MAX_FEE_BPS
}
