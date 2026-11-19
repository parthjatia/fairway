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
    /// onchain markout scoring + oracle parameters (M13)
    pub markout: MarkoutParams,
    /// share of every swap fee that goes to the protocol treasury, in bps of the fee (1500 = 15%)
    pub protocol_fee_bps: u16,
    /// bot-tax rebate parameters (M15)
    pub rebate: RebateParams,
}

/// Bot-tax rebate: RETAIL-tier wallets pay `fee_bps[RETAIL] − rebate`, funded by a share of the PREVIOUS epoch's toxic premium
/// (toxic fee above the STANDARD fee). `update_retail_fee` (permissionless) rolls the epoch.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct RebateParams {
    /// an epoch lasts this many slots (9_000 ≈ 1 hour at 400 ms)
    pub epoch_slots: u64,
    /// share of the toxic premium recycled to retail, bps of the premium (1000 = 10%); 0 turns the rebate off
    pub share_bps: u16,
    /// the rebated retail fee never goes below this
    pub floor_bps: u16,
}

impl Default for RebateParams {
    fn default() -> Self {
        Self { epoch_slots: 9_000, share_bps: 1_000, floor_bps: 5 }
    }
}


/// Parameters of the trustless onchain markout score. Defaults mirror `DEFAULT_SCORING_CONFIG` in packages/scoring.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct MarkoutParams {
    /// a pending trade becomes settleable this many slots after it executed (~30 s at 400 ms)
    pub markout_slots: u64,
    /// pending trades older than this are dropped unscored (nobody cranked in time)
    pub max_settle_slots: u64,
    /// Bayesian prior K in raw quote units
    pub prior_notional: u64,
    /// once settled onchain notional reaches this (and `min_trades()` settled trades), the onchain tier overrides the keeper's bootstrap score
    pub onchain_min_notional: u64,
    pub toxic_bps: i32,
    pub toxic_min_trades: u32,
    pub retail_bps: i32,
    pub retail_min_trades: u32,
    pub retail_min_history_slots: u64,
    pub pyth_max_staleness_secs: u64,
    pub pyth_max_conf_bps: u16,
}

impl Default for MarkoutParams {
    fn default() -> Self {
        Self {
            markout_slots: 75,
            max_settle_slots: 450,
            prior_notional: 2_000_000_000,
            onchain_min_notional: 1_000_000_000,
            toxic_bps: 10,
            toxic_min_trades: 5,
            retail_bps: 3,
            retail_min_trades: 5,
            retail_min_history_slots: 648_000,
            pyth_max_staleness_secs: 60,
            pyth_max_conf_bps: 50,
        }
    }
}

impl MarkoutParams {
    /// settled trades needed before the onchain tier overrides the keeper (the smaller tier trade minimum)
    pub fn min_trades(&self) -> u32 {
        self.toxic_min_trades.min(self.retail_min_trades)
    }
    pub fn tier_params(&self) -> fairway_math::markout::TierParams {
        fairway_math::markout::TierParams {
            prior_notional: self.prior_notional,
            toxic_bps: self.toxic_bps,
            toxic_min_trades: self.toxic_min_trades,
            retail_bps: self.retail_bps,
            retail_min_trades: self.retail_min_trades,
            retail_min_history_slots: self.retail_min_history_slots,
        }
    }
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
    /// protocol fees accrued in the vaults and not yet claimed (excluded from the reserves used for pricing / LP shares)
    pub protocol_owed_base: u64,
    pub protocol_owed_quote: u64,
    /// cumulative protocol fees (claimed or not)
    pub protocol_earned_base: u64,
    pub protocol_earned_quote: u64,
    /// score accounts whose rent the protocol treasury paid on a trader's first swap here, and the lamports it spent
    pub sponsored_accounts: u32,
    pub sponsored_lamports: u64,
    /// Pyth `PriceUpdateV2` account for THIS pool's base/USD price. The default pubkey means "no oracle": swaps on this
    /// pool are not queued for onchain scoring (they build no onchain evidence and cannot hit the full-buffer cap).
    pub oracle_price_account: Pubkey,
    /// the feed id that account must carry
    pub oracle_feed_id: [u8; 32],
    // ---- bot-tax rebate bookkeeping (M15). All amounts are quote-token equivalents (base valued at the pool's spot price).
    /// slot the current epoch started (set at pool creation, then by `update_retail_fee`)
    pub epoch_start_slot: u64,
    /// toxic premium collected this epoch: fee charged above the STANDARD fee, TOXIC tier
    pub epoch_premium_q: u64,
    /// RETAIL-tier swap volume this epoch (the volume the rebate is spread over)
    pub epoch_retail_vol_q: u64,
    /// rebate applied to RETAIL-tier fees right now, bps (from the last epoch roll)
    pub rebate_bps: u16,
    /// what is left of the previous epoch's rebate budget: a swap never gets rebate beyond this
    pub rebate_budget_q: u64,
    /// cumulative swap volume per tier
    pub volume_q: [u64; 3],
    /// lifetime toxic premium and lifetime rebate handed out
    pub premium_total_q: u64,
    pub rebate_total_q: u64,
}

impl Pool {
    /// reserves that belong to LPs and price the curve: vault balance minus unclaimed protocol fees
    pub fn lp_reserves(&self, base_vault_amount: u64, quote_vault_amount: u64) -> Option<(u64, u64)> {
        Some((base_vault_amount.checked_sub(self.protocol_owed_base)?, quote_vault_amount.checked_sub(self.protocol_owed_quote)?))
    }
}

/// A swap waiting for its markout horizon (ring buffer entry; `notional == 0` = empty).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq, InitSpace)]
pub struct PendingTrade {
    /// the pool it was traded on: settled only against that pool's oracle
    pub pool: Pubkey,
    /// pre-fee execution price, quote per base, 1e12 fixed point (`fairway_math::markout::PRICE_SCALE`)
    pub exec_price: u64,
    pub slot: u64,
    /// 0 = buy (trader received base), 1 = sell
    pub side: u8,
    /// quote-token amount excluding the fee, raw units
    pub notional: u64,
}

pub const PENDING_CAP: usize = 4;

/// Toxicity score for one wallet. PDA ["score", trader].
///
/// Two independent sources feed the fee tier (see `fairway_math::resolve_blended`):
/// * bootstrap: `tier/score_bps/trades/updated_slot`, written ONLY by the score authority (keeper, offchain history);
/// * onchain: `sum_*`, `onchain_*`, written ONLY by the program (`swap` appends, `settle_markout` scores).
#[account]
#[derive(InitSpace)]
pub struct TraderScore {
    pub trader: Pubkey,
    /// bootstrap tier from the keeper: 0 RETAIL, 1 STANDARD, 2 TOXIC
    pub tier: u8,
    /// bootstrap score (informational; the tier drives the fee)
    pub score_bps: i32,
    pub trades: u32,
    pub updated_slot: u64,
    pub bump: u8,
    // ---- onchain verified (M13)
    /// Σ notional of settled trades (raw quote units)
    pub sum_notional: u64,
    /// Σ notional × markout_bps of settled trades
    pub sum_weighted_markout: i128,
    /// settled trades
    pub trade_count: u32,
    /// slot of the first recorded trade (history length for RETAIL)
    pub first_slot: u64,
    pub onchain_tier: u8,
    pub onchain_score_bps: i32,
    /// trades not scored: buffer was full at swap time, or expired before anyone settled them
    pub dropped_trades: u32,
    pub pending: [PendingTrade; PENDING_CAP],
    /// the treasury paid this account's rent, so closing it refunds the treasury
    pub sponsored: bool,
}

impl TraderScore {
    pub fn new(trader: Pubkey, bump: u8) -> Self {
        Self {
            trader,
            tier: fairway_math::TIER_STANDARD,
            score_bps: 0,
            trades: 0,
            updated_slot: 0,
            bump,
            sum_notional: 0,
            sum_weighted_markout: 0,
            trade_count: 0,
            first_slot: 0,
            onchain_tier: fairway_math::TIER_STANDARD,
            onchain_score_bps: 0,
            dropped_trades: 0,
            pending: [PendingTrade::default(); PENDING_CAP],
            sponsored: false,
        }
    }
    pub fn pending_full(&self) -> bool {
        self.pending.iter().all(|p| p.notional != 0)
    }
}
