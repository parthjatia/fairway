//! `configure_launch` (M16): turn a pool into a fair launch. During the window the swap fee follows a per-tier decay
//! curve (known snipers pay the most, fresh wallets a high STANDARD fee, proven humans little), and trades are scored
//! onchain against the pool's own TWAP when the token has no oracle.
use anchor_lang::{prelude::*, system_program};
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use fairway_math::launch::valid_launch_curve;

use crate::{
    constants::*,
    error::FairwayError,
    instructions::pool::pool_signer_seeds,
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

/// `launch_slot` 0 = open now; `window_slots` 0 = the Config default; `curve` None = the Config default curve;
/// `creator_share_bps` None = the Config default share of the TOXIC premium paid to the creator (50%).
pub fn handle_configure_launch(ctx: Context<ConfigureLaunch>, launch_slot: u64, window_slots: u64, curve: Option<LaunchCurveParams>, creator_share_bps: Option<u16>) -> Result<()> {
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
    let creator_share_bps = creator_share_bps.unwrap_or(cfg.launch.creator_premium_share_bps);
    require!(creator_share_bps as u32 + cfg.protocol_fee_bps as u32 <= 10_000, FairwayError::InvalidCreatorShare);
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
    p.creator_share_bps = creator_share_bps;
    emit!(LaunchConfigured { pool: p.key(), launch_slot, window_slots, start_bps: curve.start_bps, end_bps: curve.end_bps, launch_fee_lamports: fee });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimCreatorFees<'info> {
    /// anyone may crank: the destinations must be owned by the pool creator
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [POOL_SEED, pool.base_mint.as_ref(), pool.quote_mint.as_ref()], bump = pool.bump,
        has_one = base_mint, has_one = quote_mint, has_one = base_vault, has_one = quote_vault
    )]
    pub pool: Box<Account<'info, Pool>>,
    pub base_mint: Box<Account<'info, Mint>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub base_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = base_mint, constraint = creator_base.owner == pool.creator @ FairwayError::Unauthorized)]
    pub creator_base: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, constraint = creator_quote.owner == pool.creator @ FairwayError::Unauthorized)]
    pub creator_quote: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Pay the creator's accrued share of the TOXIC premium out of the vaults (it was never part of LP reserves).
pub fn handle_claim_creator_fees(ctx: Context<ClaimCreatorFees>) -> Result<()> {
    let a = &ctx.accounts;
    let (owed_base, owed_quote) = (a.pool.creator_owed_base, a.pool.creator_owed_quote);
    let seeds = pool_signer_seeds(&a.pool);
    let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
    let signer: &[&[&[u8]]] = &[&seed_refs];
    let tp = a.token_program.key();
    if owed_base > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(tp, TransferChecked { from: a.base_vault.to_account_info(), mint: a.base_mint.to_account_info(), to: a.creator_base.to_account_info(), authority: a.pool.to_account_info() }, signer),
            owed_base,
            a.base_mint.decimals,
        )?;
    }
    if owed_quote > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(tp, TransferChecked { from: a.quote_vault.to_account_info(), mint: a.quote_mint.to_account_info(), to: a.creator_quote.to_account_info(), authority: a.pool.to_account_info() }, signer),
            owed_quote,
            a.quote_mint.decimals,
        )?;
    }
    let p = &mut ctx.accounts.pool;
    p.creator_owed_base = 0;
    p.creator_owed_quote = 0;
    Ok(())
}
