use anchor_lang::prelude::*;
use fairway_math::{rebate::epoch_rebate, TIER_RETAIL};

use crate::{
    constants::*,
    error::{FairwayError, MathExt},
    events::RetailFeeUpdated,
    state::{Config, Pool},
};

#[derive(Accounts)]
pub struct UpdateRetailFee<'info> {
    /// anyone can crank; pays only the transaction fee
    pub cranker: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [POOL_SEED, pool.base_mint.as_ref(), pool.quote_mint.as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,
}

/// Roll the epoch: `rebate = min(share × epoch toxic premium ÷ epoch RETAIL volume, retail fee − floor)`, funded ONLY by the
/// premium just collected. The same amount is a hard budget the swap handler enforces next epoch, so the rebate handed out can
/// never exceed `share × premium` (up to one token unit of rounding per swap), whatever the next epoch's volume turns out to be.
pub fn handle_update_retail_fee(ctx: Context<UpdateRetailFee>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let c = &ctx.accounts.config;
    let p = &mut ctx.accounts.pool;
    require!(slot >= p.epoch_start_slot.saturating_add(c.rebate.epoch_slots), FairwayError::EpochNotElapsed);
    let base = c.fee_bps[TIER_RETAIL as usize];
    let r = epoch_rebate(p.epoch_premium_q, p.epoch_retail_vol_q, c.rebate.share_bps, base, c.rebate.floor_bps).m()?;
    emit!(RetailFeeUpdated {
        pool: p.key(),
        epoch_start_slot: p.epoch_start_slot,
        slot,
        premium_q: p.epoch_premium_q,
        retail_volume_q: p.epoch_retail_vol_q,
        rebate_bps: r.rate_bps,
        budget_q: r.budget_q,
        retail_fee_bps: base.saturating_sub(r.rate_bps),
    });
    p.rebate_bps = r.rate_bps;
    p.rebate_budget_q = r.budget_q;
    p.epoch_start_slot = slot;
    p.epoch_premium_q = 0;
    p.epoch_retail_vol_q = 0;
    Ok(())
}
