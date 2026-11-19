use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, TransferChecked};
use fairway_math::{deposit, initial_lp, withdraw};

use crate::{constants::*, error::{FairwayError, MathExt}, state::Pool};

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub base_mint: Box<Account<'info, Mint>>,
    #[account(constraint = quote_mint.key() != base_mint.key() @ FairwayError::SameMint)]
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(
        init, payer = payer, space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, base_mint.key().as_ref(), quote_mint.key().as_ref()], bump
    )]
    pub pool: Box<Account<'info, Pool>>,
    #[account(
        init, payer = payer, token::mint = base_mint, token::authority = pool,
        seeds = [VAULT_SEED, pool.key().as_ref(), base_mint.key().as_ref()], bump
    )]
    pub base_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init, payer = payer, token::mint = quote_mint, token::authority = pool,
        seeds = [VAULT_SEED, pool.key().as_ref(), quote_mint.key().as_ref()], bump
    )]
    pub quote_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init, payer = payer, mint::decimals = LP_DECIMALS, mint::authority = pool,
        seeds = [LP_MINT_SEED, pool.key().as_ref()], bump
    )]
    pub lp_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_pool(ctx: Context<CreatePool>) -> Result<()> {
    let p = &mut ctx.accounts.pool;
    p.base_mint = ctx.accounts.base_mint.key();
    p.quote_mint = ctx.accounts.quote_mint.key();
    p.base_vault = ctx.accounts.base_vault.key();
    p.quote_vault = ctx.accounts.quote_vault.key();
    p.lp_mint = ctx.accounts.lp_mint.key();
    p.lp_supply = 0;
    p.fees_base = [0; 3];
    p.fees_quote = [0; 3];
    p.swaps = [0; 3];
    p.bump = ctx.bumps.pool;
    p.base_vault_bump = ctx.bumps.base_vault;
    p.quote_vault_bump = ctx.bumps.quote_vault;
    p.lp_mint_bump = ctx.bumps.lp_mint;
    p.protocol_owed_base = 0;
    p.protocol_owed_quote = 0;
    p.protocol_earned_base = 0;
    p.protocol_earned_quote = 0;
    p.sponsored_accounts = 0;
    p.sponsored_lamports = 0;
    p.oracle_price_account = Pubkey::default();
    p.oracle_feed_id = [0u8; 32];
    Ok(())
}

/// Accounts shared by add/remove liquidity.
#[derive(Accounts)]
pub struct Liquidity<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [POOL_SEED, pool.base_mint.as_ref(), pool.quote_mint.as_ref()], bump = pool.bump,
        has_one = base_mint, has_one = quote_mint, has_one = base_vault, has_one = quote_vault, has_one = lp_mint
    )]
    pub pool: Box<Account<'info, Pool>>,
    pub base_mint: Box<Account<'info, Mint>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub base_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub lp_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::authority = owner)]
    pub owner_base: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = owner)]
    pub owner_quote: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = lp_mint, token::authority = owner)]
    pub owner_lp: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub(crate) fn pool_signer_seeds(pool: &Pool) -> [Vec<u8>; 4] {
    [POOL_SEED.to_vec(), pool.base_mint.to_bytes().to_vec(), pool.quote_mint.to_bytes().to_vec(), vec![pool.bump]]
}

pub fn handle_add_liquidity(ctx: Context<Liquidity>, max_base: u64, max_quote: u64, min_lp: u64) -> Result<()> {
    let a = &ctx.accounts;
    let (lp_out, used_base, used_quote, new_supply) = if a.pool.lp_supply == 0 {
        let (lp, total) = initial_lp(max_base, max_quote).m()?;
        (lp, max_base, max_quote, total)
    } else {
        let (rb, rq) = a.pool.lp_reserves(a.base_vault.amount, a.quote_vault.amount).ok_or(FairwayError::Overflow)?;
        let d = deposit(max_base, max_quote, rb, rq, a.pool.lp_supply).m()?;
        (d.lp, d.used_a, d.used_b, a.pool.lp_supply.checked_add(d.lp).ok_or(FairwayError::Overflow)?)
    };
    require!(lp_out >= min_lp, FairwayError::SlippageExceeded);

    let tp = a.token_program.key();
    token::transfer_checked(
        CpiContext::new(tp, TransferChecked { from: a.owner_base.to_account_info(), mint: a.base_mint.to_account_info(), to: a.base_vault.to_account_info(), authority: a.owner.to_account_info() }),
        used_base,
        a.base_mint.decimals,
    )?;
    token::transfer_checked(
        CpiContext::new(tp, TransferChecked { from: a.owner_quote.to_account_info(), mint: a.quote_mint.to_account_info(), to: a.quote_vault.to_account_info(), authority: a.owner.to_account_info() }),
        used_quote,
        a.quote_mint.decimals,
    )?;
    let seeds = pool_signer_seeds(&a.pool);
    let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
    let signer: &[&[&[u8]]] = &[&seed_refs];
    token::mint_to(
        CpiContext::new_with_signer(tp, MintTo { mint: a.lp_mint.to_account_info(), to: a.owner_lp.to_account_info(), authority: a.pool.to_account_info() }, signer),
        lp_out,
    )?;
    ctx.accounts.pool.lp_supply = new_supply;
    Ok(())
}

pub fn handle_remove_liquidity(ctx: Context<Liquidity>, lp_amount: u64, min_base: u64, min_quote: u64) -> Result<()> {
    let a = &ctx.accounts;
    let (rb, rq) = a.pool.lp_reserves(a.base_vault.amount, a.quote_vault.amount).ok_or(FairwayError::Overflow)?;
    let (out_base, out_quote) = withdraw(lp_amount, rb, rq, a.pool.lp_supply).m()?;
    require!(out_base >= min_base && out_quote >= min_quote, FairwayError::SlippageExceeded);
    let tp = a.token_program.key();
    token::burn(
        CpiContext::new(tp, Burn { mint: a.lp_mint.to_account_info(), from: a.owner_lp.to_account_info(), authority: a.owner.to_account_info() }),
        lp_amount,
    )?;
    let seeds = pool_signer_seeds(&a.pool);
    let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
    let signer: &[&[&[u8]]] = &[&seed_refs];
    if out_base > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(tp, TransferChecked { from: a.base_vault.to_account_info(), mint: a.base_mint.to_account_info(), to: a.owner_base.to_account_info(), authority: a.pool.to_account_info() }, signer),
            out_base,
            a.base_mint.decimals,
        )?;
    }
    if out_quote > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(tp, TransferChecked { from: a.quote_vault.to_account_info(), mint: a.quote_mint.to_account_info(), to: a.owner_quote.to_account_info(), authority: a.pool.to_account_info() }, signer),
            out_quote,
            a.quote_mint.decimals,
        )?;
    }
    let p = &mut ctx.accounts.pool;
    p.lp_supply = p.lp_supply.checked_sub(lp_amount).ok_or(FairwayError::Overflow)?;
    Ok(())
}
