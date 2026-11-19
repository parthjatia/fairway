//! Fairway: a constant-product AMM where the swap fee depends on the signer's toxicity tier,
//! read from a `TraderScore` PDA written by a score oracle. Bots pay more, humans pay less.
#![allow(unexpected_cfgs)]

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("8jo3xry2rp9rQHwPCyh8c9Qwnw2HHa5JvAUiXHo2XPXk");

#[program]
pub mod fairway {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, score_authority: Pubkey, fee_bps: [u16; 3], score_ttl_slots: u64) -> Result<()> {
        instructions::config::handle_initialize_config(ctx, score_authority, fee_bps, score_ttl_slots)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, update: ConfigUpdate) -> Result<()> {
        instructions::config::handle_update_config(ctx, update)
    }

    pub fn create_pool(ctx: Context<CreatePool>) -> Result<()> {
        instructions::pool::handle_create_pool(ctx)
    }

    pub fn add_liquidity(ctx: Context<Liquidity>, max_base: u64, max_quote: u64, min_lp: u64) -> Result<()> {
        instructions::pool::handle_add_liquidity(ctx, max_base, max_quote, min_lp)
    }

    pub fn remove_liquidity(ctx: Context<Liquidity>, lp_amount: u64, min_base: u64, min_quote: u64) -> Result<()> {
        instructions::pool::handle_remove_liquidity(ctx, lp_amount, min_base, min_quote)
    }

    pub fn swap(ctx: Context<Swap>, amount_in: u64, min_amount_out: u64, a_to_b: bool) -> Result<()> {
        instructions::swap::handle_swap(ctx, amount_in, min_amount_out, a_to_b)
    }

    pub fn set_score(ctx: Context<SetScore>, trader: Pubkey, tier: u8, score_bps: i32, trades: u32) -> Result<()> {
        instructions::score::handle_set_score(ctx, trader, tier, score_bps, trades)
    }

    pub fn set_scores_batch<'info>(ctx: Context<'info, SetScoresBatch<'info>>, entries: Vec<ScoreEntry>) -> Result<()> {
        instructions::score::handle_set_scores_batch(ctx, entries)
    }

    pub fn set_pool_oracle(ctx: Context<SetPoolOracle>, price_account: Pubkey, feed_id: [u8; 32]) -> Result<()> {
        instructions::config::handle_set_pool_oracle(ctx, price_account, feed_id)
    }

    /// Permissionless: score the signer-recorded pending trades of `trader` against the Pyth mid.
    pub fn settle_markout(ctx: Context<SettleMarkout>, trader: Pubkey) -> Result<()> {
        instructions::settle::handle_settle_markout(ctx, trader)
    }

    /// Permissionless: move the protocol's accrued share of swap fees into the treasury's token accounts.
    pub fn claim_protocol_fees(ctx: Context<ClaimProtocolFees>) -> Result<()> {
        instructions::treasury::handle_claim_protocol_fees(ctx)
    }

    pub fn treasury_transfer_tokens(ctx: Context<TreasuryTransferTokens>, amount: u64) -> Result<()> {
        instructions::treasury::handle_treasury_transfer_tokens(ctx, amount)
    }

    pub fn treasury_withdraw_sol(ctx: Context<TreasuryWithdrawSol>, lamports: u64) -> Result<()> {
        instructions::treasury::handle_treasury_withdraw_sol(ctx, lamports)
    }

    /// Permissionless: roll the rebate epoch. Sets the RETAIL-tier rebate for the next epoch from the toxic premium and
    /// RETAIL volume counters of the epoch that just ended.
    pub fn update_retail_fee(ctx: Context<UpdateRetailFee>) -> Result<()> {
        instructions::rebate::handle_update_retail_fee(ctx)
    }

    /// Make the pool a fair launch: trading opens at `launch_slot` (0 = now) and, for `window_slots` (0 = default), the fee
    /// follows the per-tier decay curve (None = the Config default). Creator or admin, before the first swap.
    pub fn configure_launch(ctx: Context<ConfigureLaunch>, launch_slot: u64, window_slots: u64, curve: Option<LaunchCurveParams>) -> Result<()> {
        instructions::launch::handle_configure_launch(ctx, launch_slot, window_slots, curve)
    }

    pub fn close_score(ctx: Context<CloseScore>) -> Result<()> {
        instructions::score::handle_close_score(ctx)
    }
}
