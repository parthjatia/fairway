//! Protocol treasury: claim the protocol's share of swap fees, move treasury funds (admin only).
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::FairwayError,
    instructions::pool::pool_signer_seeds,
    state::{Config, Pool},
};

#[derive(Accounts)]
pub struct ClaimProtocolFees<'info> {
    /// anyone may crank: the destinations are fixed to treasury-owned token accounts
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [POOL_SEED, pool.base_mint.as_ref(), pool.quote_mint.as_ref()], bump = pool.bump,
        has_one = base_mint, has_one = quote_mint, has_one = base_vault, has_one = quote_vault
    )]
    pub pool: Box<Account<'info, Pool>>,
    #[account(seeds = [TREASURY_SEED], bump)]
    pub treasury: SystemAccount<'info>,
    pub base_mint: Box<Account<'info, Mint>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub base_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = base_mint, token::authority = treasury)]
    pub treasury_base: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = treasury)]
    pub treasury_quote: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_claim_protocol_fees(ctx: Context<ClaimProtocolFees>) -> Result<()> {
    let a = &ctx.accounts;
    let (owed_base, owed_quote) = (a.pool.protocol_owed_base, a.pool.protocol_owed_quote);
    let seeds = pool_signer_seeds(&a.pool);
    let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
    let signer: &[&[&[u8]]] = &[&seed_refs];
    let tp = a.token_program.key();
    if owed_base > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(tp, TransferChecked { from: a.base_vault.to_account_info(), mint: a.base_mint.to_account_info(), to: a.treasury_base.to_account_info(), authority: a.pool.to_account_info() }, signer),
            owed_base,
            a.base_mint.decimals,
        )?;
    }
    if owed_quote > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(tp, TransferChecked { from: a.quote_vault.to_account_info(), mint: a.quote_mint.to_account_info(), to: a.treasury_quote.to_account_info(), authority: a.pool.to_account_info() }, signer),
            owed_quote,
            a.quote_mint.decimals,
        )?;
    }
    let p = &mut ctx.accounts.pool;
    p.protocol_owed_base = 0;
    p.protocol_owed_quote = 0;
    Ok(())
}

#[derive(Accounts)]
pub struct TreasuryTransferTokens<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ FairwayError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(seeds = [TREASURY_SEED], bump)]
    pub treasury: SystemAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = treasury)]
    pub from: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub to: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_treasury_transfer_tokens(ctx: Context<TreasuryTransferTokens>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    let bump = [ctx.bumps.treasury];
    let seeds: &[&[u8]] = &[TREASURY_SEED, &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(a.token_program.key(), TransferChecked { from: a.from.to_account_info(), mint: a.mint.to_account_info(), to: a.to.to_account_info(), authority: a.treasury.to_account_info() }, &[seeds]),
        amount,
        a.mint.decimals,
    )
}

#[derive(Accounts)]
pub struct TreasuryWithdrawSol<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ FairwayError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TREASURY_SEED], bump)]
    pub treasury: SystemAccount<'info>,
    /// CHECK: any system account chosen by the admin
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_treasury_withdraw_sol(ctx: Context<TreasuryWithdrawSol>, lamports: u64) -> Result<()> {
    let floor = Rent::get()?.minimum_balance(0);
    let left = ctx.accounts.treasury.lamports().checked_sub(lamports).ok_or(FairwayError::TreasuryBelowFloor)?;
    // either drain it completely or leave it rent-exempt
    require!(left == 0 || left >= floor, FairwayError::TreasuryBelowFloor);
    let bump = [ctx.bumps.treasury];
    let seeds: &[&[u8]] = &[TREASURY_SEED, &bump];
    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            anchor_lang::system_program::Transfer { from: ctx.accounts.treasury.to_account_info(), to: ctx.accounts.destination.to_account_info() },
            &[seeds],
        ),
        lamports,
    )
}
