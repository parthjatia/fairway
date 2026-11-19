//! `configure_launch` (M16): turn a pool into a fair launch. During the window the swap fee follows a per-tier decay
//! curve (known snipers pay the most, fresh wallets a high STANDARD fee, proven humans little), and trades are scored
//! onchain against the pool's own TWAP when the token has no oracle.
use anchor_lang::{prelude::*, system_program};
use fairway_math::launch::valid_launch_curve;

use crate::{
    constants::*,
    error::FairwayError,
    events::LaunchConfigured,
    state::{Config, LaunchCurveParams, Pool, PoolLaunch},
};

#[derive(Accounts)]
pub struct ConfigureLaunch<'info> {
    /// the pool's creator or the admin; pays the launch fee
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut, seeds = [POOL_SEED, pool.base_mint.as_ref(), pool.quote_mint.as_ref()], bump = pool.bump,
        constraint = (authority.key() == pool.creator || authority.key() == config.admin) @ FairwayError::Unauthorized
    )]
    pub pool: Box<Account<'info, Pool>>,
    /// CHECK: system-owned PDA ["treasury"], receives the launch fee
    #[account(mut, seeds = [TREASURY_SEED], bump)]
    pub treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// `launch_slot` 0 = open now; `window_slots` 0 = the Config default; `curve` None = the Config default curve.
pub fn handle_configure_launch(ctx: Context<ConfigureLaunch>, launch_slot: u64, window_slots: u64, curve: Option<LaunchCurveParams>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let cfg = &ctx.accounts.config;
    require!(ctx.accounts.pool.total_swaps() == 0, FairwayError::LaunchAlreadyTrading);
    let launch_slot = if launch_slot == 0 { slot } else { launch_slot };
    let window_slots = if window_slots == 0 { cfg.launch.default_window_slots } else { window_slots };
    let curve = curve.unwrap_or(cfg.launch.curve);
    require!(
        launch_slot >= slot && window_slots > 0 && window_slots <= MAX_LAUNCH_WINDOW_SLOTS && valid_launch_curve(&curve.math()),
        FairwayError::InvalidLaunchParams
    );
    let fee = cfg.launch.launch_fee_lamports;
    if fee > 0 && ctx.accounts.authority.key() != cfg.admin {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer { from: ctx.accounts.authority.to_account_info(), to: ctx.accounts.treasury.to_account_info() },
            ),
            fee,
        )?;
    }
    let p = &mut ctx.accounts.pool;
    p.launch = PoolLaunch { launch_slot, window_slots, curve, twap_scoring: true };
    emit!(LaunchConfigured { pool: p.key(), launch_slot, window_slots, start_bps: curve.start_bps, end_bps: curve.end_bps, launch_fee_lamports: fee });
    Ok(())
}
