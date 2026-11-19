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

    pub fn close_score(ctx: Context<CloseScore>) -> Result<()> {
        instructions::score::handle_close_score(ctx)
    }
}
