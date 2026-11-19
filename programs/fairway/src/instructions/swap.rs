use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use fairway_math::{resolve_tier, swap_quote, ScoreView, TierSource};

use crate::{
    constants::*,
    error::{FairwayError, MathExt},
    events::SwapExecuted,
    instructions::pool::pool_signer_seeds,
    state::{Config, Pool, TraderScore},
};

#[derive(Accounts)]
pub struct Swap<'info> {
    /// The trader. The fee tier is looked up from the score PDA derived from THIS key.
    pub trader: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [POOL_SEED, pool.base_mint.as_ref(), pool.quote_mint.as_ref()], bump = pool.bump,
        has_one = base_mint, has_one = quote_mint, has_one = base_vault, has_one = quote_vault
    )]
    pub pool: Box<Account<'info, Pool>>,
    /// CHECK: MUST be the PDA ["score", trader]. Anchor enforces the seeds, so a bot cannot pass someone
    /// else's RETAIL score (the transaction fails with ConstraintSeeds). It may be uninitialised: a missing,
    /// stale or malformed score resolves to the default tier (>= STANDARD).
    #[account(seeds = [SCORE_SEED, trader.key().as_ref()], bump)]
    pub trader_score: UncheckedAccount<'info>,
    pub base_mint: Box<Account<'info, Mint>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub base_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = base_mint, token::authority = trader)]
    pub trader_base: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = trader)]
    pub trader_quote: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Read the score PDA if it is a valid, program-owned `TraderScore` for this trader.
fn read_score(acc: &AccountInfo, trader: &Pubkey) -> Option<ScoreView> {
    if acc.owner != &crate::ID || acc.data_len() < 8 {
        return None;
    }
    let data = acc.try_borrow_data().ok()?;
    let s = TraderScore::try_deserialize(&mut &data[..]).ok()?;
    if &s.trader != trader {
        return None;
    }
    Some(ScoreView { tier: s.tier, updated_slot: s.updated_slot })
}

pub fn handle_swap(ctx: Context<Swap>, amount_in: u64, min_amount_out: u64, a_to_b: bool) -> Result<()> {
    let a = &ctx.accounts;
    let trader = a.trader.key();
    let slot = Clock::get()?.slot;
    let (tier, source) = resolve_tier(read_score(&a.trader_score.to_account_info(), &trader), slot, a.config.score_ttl_slots, a.config.default_tier);
    let fee_bps = a.config.fee_bps[tier as usize];

    let (reserve_in, reserve_out) = if a_to_b { (a.base_vault.amount, a.quote_vault.amount) } else { (a.quote_vault.amount, a.base_vault.amount) };
    let q = swap_quote(amount_in, reserve_in, reserve_out, fee_bps).m()?;
    require!(q.amount_out >= min_amount_out, FairwayError::SlippageExceeded);

    let tp = a.token_program.key();
    let (user_in, vault_in, mint_in, dec_in) = if a_to_b {
        (a.trader_base.to_account_info(), a.base_vault.to_account_info(), a.base_mint.to_account_info(), a.base_mint.decimals)
    } else {
        (a.trader_quote.to_account_info(), a.quote_vault.to_account_info(), a.quote_mint.to_account_info(), a.quote_mint.decimals)
    };
    let (vault_out, user_out, mint_out, dec_out) = if a_to_b {
        (a.quote_vault.to_account_info(), a.trader_quote.to_account_info(), a.quote_mint.to_account_info(), a.quote_mint.decimals)
    } else {
        (a.base_vault.to_account_info(), a.trader_base.to_account_info(), a.base_mint.to_account_info(), a.base_mint.decimals)
    };
    // full amount_in (incl. fee) goes to the vault: the fee accrues to LPs
    token::transfer_checked(
        CpiContext::new(tp, TransferChecked { from: user_in, mint: mint_in, to: vault_in, authority: a.trader.to_account_info() }),
        amount_in,
        dec_in,
    )?;
    let seeds = pool_signer_seeds(&a.pool);
    let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
    let signer: &[&[&[u8]]] = &[&seed_refs];
    token::transfer_checked(
        CpiContext::new_with_signer(tp, TransferChecked { from: vault_out, mint: mint_out, to: user_out, authority: a.pool.to_account_info() }, signer),
        q.amount_out,
        dec_out,
    )?;

    let pool_key = a.pool.key();
    let p = &mut ctx.accounts.pool;
    let t = tier as usize;
    if a_to_b {
        p.fees_base[t] = p.fees_base[t].saturating_add(q.fee);
    } else {
        p.fees_quote[t] = p.fees_quote[t].saturating_add(q.fee);
    }
    p.swaps[t] = p.swaps[t].saturating_add(1);

    if source != TierSource::Score {
        msg!("fairway: tier {} ({:?})", tier, source);
    }
    emit!(SwapExecuted { trader, pool: pool_key, a_to_b, amount_in, amount_out: q.amount_out, fee_bps, tier });
    Ok(())
}
