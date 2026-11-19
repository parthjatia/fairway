use anchor_lang::prelude::*;

/// Global configuration. PDA ["config"].
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// the only key allowed to write `TraderScore` accounts (the score oracle / keeper)
    pub score_authority: Pubkey,
    /// swap fee in bps per tier: [RETAIL, STANDARD, TOXIC]
    pub fee_bps: [u16; 3],
    /// tier for wallets without a (fresh) score; always >= STANDARD
    pub default_tier: u8,
    /// scores older than this many slots are ignored (→ default tier)
    pub score_ttl_slots: u64,
    pub bump: u8,
}

/// A constant-product pool. PDA ["pool", base_mint, quote_mint].
#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    /// PDA ["vault", pool, base_mint], token authority = pool
    pub base_vault: Pubkey,
    /// PDA ["vault", pool, quote_mint], token authority = pool
    pub quote_vault: Pubkey,
    /// PDA ["lp_mint", pool], mint authority = pool
    pub lp_mint: Pubkey,
    /// total LP units including the permanently locked MIN_LIQUIDITY (never minted)
    pub lp_supply: u64,
    /// cumulative fees collected per tier, in base units (base → quote swaps)
    pub fees_base: [u64; 3],
    /// cumulative fees collected per tier, in quote units (quote → base swaps)
    pub fees_quote: [u64; 3],
    /// cumulative swap count per tier
    pub swaps: [u64; 3],
    pub bump: u8,
    pub base_vault_bump: u8,
    pub quote_vault_bump: u8,
    pub lp_mint_bump: u8,
}

/// Toxicity score for one wallet. PDA ["score", trader]. Written only by the score authority.
#[account]
#[derive(InitSpace)]
pub struct TraderScore {
    pub trader: Pubkey,
    /// 0 RETAIL, 1 STANDARD, 2 TOXIC
    pub tier: u8,
    /// notional-weighted, shrunk markout in bps (informational; the tier drives the fee)
    pub score_bps: i32,
    pub trades: u32,
    pub updated_slot: u64,
    pub bump: u8,
}
