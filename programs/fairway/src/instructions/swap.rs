use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use fairway_math::{
    markout::{exec_price_scaled, SIDE_BUY, SIDE_SELL},
    fee_on_input,
    protocol_share,
    rebate::{quote_equivalent, swap_rebate_bps, toxic_premium},
    resolve_blended, swap_quote, OnchainView, ScoreView, TierSource, TIER_RETAIL, TIER_STANDARD, TIER_TOXIC,
};

use crate::{
    constants::*,
    error::{FairwayError, MathExt},
    events::SwapExecuted,
    instructions::pool::pool_signer_seeds,
    instructions::score::{ensure_score_account, load_score, store_score},
    state::{Config, PendingTrade, Pool},
};

#[derive(Accounts)]
pub struct Swap<'info> {
    /// The trader. The fee tier is looked up from the score PDA derived from THIS key.
    /// Mutable because it pays rent for its score PDA on the first swap.
    #[account(mut)]
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
    /// stale or malformed score resolves to the default tier (>= STANDARD). Created on the first swap (payer = trader)
    /// so the trade can be queued for onchain markout scoring.
    #[account(mut, seeds = [SCORE_SEED, trader.key().as_ref()], bump)]
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
    pub system_program: Program<'info, System>,
    /// Protocol treasury: sponsors the rent of a trader's first score account when it holds enough SOL.
    /// CHECK: system-owned PDA ["treasury"]; may be empty (then the trader pays)
    #[account(mut, seeds = [TREASURY_SEED], bump)]
    pub treasury: SystemAccount<'info>,
}

/// What the swap needs from the signer's score PDA.
struct ScoreRead {
    bootstrap: Option<ScoreView>,
    onchain: Option<OnchainView>,
    pending_full: bool,
}


fn read_score(acc: &AccountInfo, trader: &Pubkey) -> ScoreRead {
    match load_score(acc) {
        Some(s) if &s.trader == trader => ScoreRead {
            bootstrap: Some(ScoreView { tier: s.tier, updated_slot: s.updated_slot }),
            onchain: Some(OnchainView { tier: s.onchain_tier, sum_notional: s.sum_notional, trades: s.trade_count }),
            pending_full: s.pending_full(),
        },
        _ => ScoreRead { bootstrap: None, onchain: None, pending_full: false },
    }
}

pub fn handle_swap(ctx: Context<Swap>, amount_in: u64, min_amount_out: u64, a_to_b: bool) -> Result<()> {
    let a = &ctx.accounts;
    let trader = a.trader.key();
    let slot = Clock::get()?.slot;
    let sr = read_score(&a.trader_score.to_account_info(), &trader);
    let m = &a.config.markout;
    let (mut tier, source) =
        resolve_blended(sr.onchain, m.onchain_min_notional, m.min_trades(), sr.bootstrap, slot, a.config.score_ttl_slots, a.config.default_tier);
    // If this trade cannot be queued for scoring (buffer full), it gets no RETAIL discount: otherwise a wallet could
    // keep its buffer full to hide trades from the onchain score while still paying the low fee.
    let scored = a.pool.oracle_price_account != Pubkey::default();
    if scored && sr.pending_full && tier == TIER_RETAIL {
        tier = TIER_STANDARD;
    }
    // pricing uses LP reserves only: unclaimed protocol fees sit in the vaults but do not move the curve
    let (rb, rq) = a.pool.lp_reserves(a.base_vault.amount, a.quote_vault.amount).ok_or(FairwayError::Overflow)?;
    let notional_q = quote_equivalent(amount_in, a_to_b, rb, rq).m()?;
    // bot-tax rebate: only the RETAIL tier, never below the floor, never beyond what is left of the epoch's budget
    let base_fee_bps = a.config.fee_bps[tier as usize];
    let rebate_bps = if tier == TIER_RETAIL {
        swap_rebate_bps(a.pool.rebate_bps, a.pool.rebate_budget_q, notional_q, base_fee_bps, a.config.rebate.floor_bps)
    } else {
        0
    };
    let fee_bps = base_fee_bps - rebate_bps;
    let (reserve_in, reserve_out) = if a_to_b { (rb, rq) } else { (rq, rb) };
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
    // protocol revenue = a share of the toxic PREMIUM only (the fee above what STANDARD would have paid): LPs keep all other fees
    let premium_in = if tier == TIER_TOXIC { toxic_premium(q.fee, amount_in, a.config.fee_bps[TIER_STANDARD as usize]).m()? } else { 0 };
    let cut = protocol_share(premium_in, a.config.protocol_fee_bps).m()?;
    let premium_q = quote_equivalent(premium_in, a_to_b, rb, rq).m()?;
    let rebate_q = if rebate_bps > 0 {
        quote_equivalent(fee_on_input(amount_in, base_fee_bps).m()?.saturating_sub(q.fee), a_to_b, rb, rq).m()?
    } else {
        0
    };
    let p = &mut ctx.accounts.pool;
    let t = tier as usize;
    p.volume_q[t] = p.volume_q[t].saturating_add(notional_q);
    if tier == TIER_RETAIL {
        p.epoch_retail_vol_q = p.epoch_retail_vol_q.saturating_add(notional_q);
        p.rebate_budget_q = p.rebate_budget_q.saturating_sub(rebate_q);
        p.rebate_total_q = p.rebate_total_q.saturating_add(rebate_q);
    }
    p.epoch_premium_q = p.epoch_premium_q.saturating_add(premium_q);
    p.premium_total_q = p.premium_total_q.saturating_add(premium_q);
    if a_to_b {
        p.fees_base[t] = p.fees_base[t].saturating_add(q.fee);
        p.protocol_owed_base = p.protocol_owed_base.checked_add(cut).ok_or(FairwayError::Overflow)?;
        p.protocol_earned_base = p.protocol_earned_base.saturating_add(cut);
    } else {
        p.fees_quote[t] = p.fees_quote[t].saturating_add(q.fee);
        p.protocol_owed_quote = p.protocol_owed_quote.checked_add(cut).ok_or(FairwayError::Overflow)?;
        p.protocol_earned_quote = p.protocol_earned_quote.saturating_add(cut);
    }
    p.swaps[t] = p.swaps[t].saturating_add(1);

    if source != TierSource::Score {
        msg!("fairway: tier {} ({:?})", tier, source);
    }

    // ---- queue the trade for trustless markout scoring (settle_markout), if this pool has an oracle
    if !scored {
        emit!(SwapExecuted { trader, pool: pool_key, a_to_b, amount_in, amount_out: q.amount_out, fee_bps, tier });
        return Ok(());
    }
    let (side, quote_leg, base_leg) = if a_to_b { (SIDE_SELL, q.amount_out, q.in_after_fee) } else { (SIDE_BUY, q.in_after_fee, q.amount_out) };
    let (bd, qd) = (ctx.accounts.base_mint.decimals, ctx.accounts.quote_mint.decimals);
    let score_info = ctx.accounts.trader_score.to_account_info();
    let payer = ctx.accounts.trader.to_account_info();
    let treasury_info = ctx.accounts.treasury.to_account_info();
    let sponsored = ensure_score_account(&score_info, &trader, ctx.bumps.trader_score, &payer, Some((&treasury_info, ctx.bumps.treasury)))?;
    if sponsored > 0 {
        let p = &mut ctx.accounts.pool;
        p.sponsored_accounts = p.sponsored_accounts.saturating_add(1);
        p.sponsored_lamports = p.sponsored_lamports.saturating_add(sponsored);
    }
    let mut ts = load_score(&score_info).ok_or(error!(FairwayError::ScoreAccountMismatch))?;
    require_keys_eq!(ts.trader, trader, FairwayError::ScoreAccountMismatch);
    match (exec_price_scaled(quote_leg, qd, base_leg, bd), ts.pending.iter_mut().find(|p| p.notional == 0)) {
        (Ok(exec_price), Some(free)) => {
            *free = PendingTrade { pool: pool_key, exec_price, slot, side, notional: quote_leg };
            if ts.first_slot == 0 {
                ts.first_slot = slot.max(1);
            }
        }
        _ => ts.dropped_trades = ts.dropped_trades.saturating_add(1),
    }
    store_score(&score_info, &ts)?;
    emit!(SwapExecuted { trader, pool: pool_key, a_to_b, amount_in, amount_out: q.amount_out, fee_bps, tier });
    Ok(())
}
