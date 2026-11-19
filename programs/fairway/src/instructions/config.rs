use anchor_lang::prelude::*;
use fairway_math::{valid_fee_schedule, TIER_STANDARD, TIER_TOXIC};

use crate::{constants::*, error::FairwayError, state::{Config, MarkoutParams, RebateParams}};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

fn validate(fee_bps: &[u16; 3], default_tier: u8) -> Result<()> {
    require!(valid_fee_schedule(fee_bps), FairwayError::InvalidFeeSchedule);
    require!((TIER_STANDARD..=TIER_TOXIC).contains(&default_tier), FairwayError::InvalidDefaultTier);
    Ok(())
}

pub fn handle_initialize_config(ctx: Context<InitializeConfig>, score_authority: Pubkey, fee_bps: [u16; 3], score_ttl_slots: u64) -> Result<()> {
    validate(&fee_bps, TIER_STANDARD)?;
    let c = &mut ctx.accounts.config;
    c.admin = ctx.accounts.admin.key();
    c.score_authority = score_authority;
    c.fee_bps = fee_bps;
    c.default_tier = TIER_STANDARD;
    c.score_ttl_slots = score_ttl_slots;
    c.bump = ctx.bumps.config;
    c.markout = MarkoutParams::default();
    c.protocol_fee_bps = DEFAULT_PROTOCOL_FEE_BPS;
    c.rebate = RebateParams::default();
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ FairwayError::Unauthorized)]
    pub config: Account<'info, Config>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct ConfigUpdate {
    pub new_admin: Option<Pubkey>,
    pub score_authority: Option<Pubkey>,
    pub fee_bps: Option<[u16; 3]>,
    pub default_tier: Option<u8>,
    pub score_ttl_slots: Option<u64>,
    pub markout: Option<MarkoutParams>,
    pub protocol_fee_bps: Option<u16>,
    pub rebate: Option<RebateParams>,
}

pub fn handle_update_config(ctx: Context<UpdateConfig>, update: ConfigUpdate) -> Result<()> {
    let c = &mut ctx.accounts.config;
    let fee_bps = update.fee_bps.unwrap_or(c.fee_bps);
    let default_tier = update.default_tier.unwrap_or(c.default_tier);
    validate(&fee_bps, default_tier)?;
    c.fee_bps = fee_bps;
    c.default_tier = default_tier;
    if let Some(a) = update.new_admin {
        c.admin = a;
    }
    if let Some(s) = update.score_authority {
        c.score_authority = s;
    }
    if let Some(p) = update.protocol_fee_bps {
        require!(p <= MAX_PROTOCOL_FEE_BPS, FairwayError::InvalidProtocolFee);
        c.protocol_fee_bps = p;
    }
    if let Some(r) = update.rebate {
        require!(r.epoch_slots > 0 && r.share_bps <= 10_000 && r.floor_bps <= fairway_math::MAX_FEE_BPS, FairwayError::InvalidRebateParams);
        c.rebate = r;
    }
    if let Some(m) = update.markout {
        validate_markout(&m)?;
        c.markout = m;
    }
    if let Some(t) = update.score_ttl_slots {
        c.score_ttl_slots = t;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct SetPoolOracle<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ FairwayError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, pool.base_mint.as_ref(), pool.quote_mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, crate::state::Pool>,
}

/// Point a pool at its Pyth price account (base/USD; the quote token is assumed USD-pegged). `Pubkey::default()` turns
/// onchain scoring off for the pool.
pub fn handle_set_pool_oracle(ctx: Context<SetPoolOracle>, price_account: Pubkey, feed_id: [u8; 32]) -> Result<()> {
    let p = &mut ctx.accounts.pool;
    p.oracle_price_account = price_account;
    p.oracle_feed_id = feed_id;
    Ok(())
}

fn validate_markout(m: &MarkoutParams) -> Result<()> {
    require!(
        m.markout_slots > 0
            && m.max_settle_slots > m.markout_slots
            && m.prior_notional > 0
            && m.toxic_bps > m.retail_bps
            && m.pyth_max_conf_bps <= 10_000
            && m.pyth_max_staleness_secs > 0,
        FairwayError::InvalidMarkoutParams
    );
    Ok(())
}
