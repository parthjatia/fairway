use anchor_lang::{prelude::*, system_program};
use fairway_math::NUM_TIERS;

use crate::{constants::*, error::FairwayError, events::ScoreUpdated, state::{Config, TraderScore}};

#[derive(Accounts)]
#[instruction(trader: Pubkey)]
pub struct SetScore<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = config.score_authority == authority.key() @ FairwayError::NotScoreAuthority)]
    pub config: Account<'info, Config>,
    #[account(init_if_needed, payer = authority, space = 8 + TraderScore::INIT_SPACE, seeds = [SCORE_SEED, trader.as_ref()], bump)]
    pub score: Account<'info, TraderScore>,
    pub system_program: Program<'info, System>,
}

pub fn handle_set_score(ctx: Context<SetScore>, trader: Pubkey, tier: u8, score_bps: i32, trades: u32) -> Result<()> {
    require!((tier as usize) < NUM_TIERS, FairwayError::InvalidTier);
    let slot = Clock::get()?.slot;
    let s = &mut ctx.accounts.score;
    if s.trader == Pubkey::default() {
        // fresh account: initialise the onchain fields to their neutral defaults
        **s = TraderScore::new(trader, ctx.bumps.score);
    }
    s.trader = trader;
    s.tier = tier;
    s.score_bps = score_bps;
    s.trades = trades;
    s.updated_slot = slot;
    s.bump = ctx.bumps.score;
    emit!(ScoreUpdated { trader, tier, score_bps, trades, slot });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoreEntry {
    pub trader: Pubkey,
    pub tier: u8,
    pub score_bps: i32,
    pub trades: u32,
}

#[derive(Accounts)]
pub struct SetScoresBatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = config.score_authority == authority.key() @ FairwayError::NotScoreAuthority)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
    // remaining_accounts: one writable score PDA ["score", entry.trader] per entry, same order
}

pub fn handle_set_scores_batch<'info>(ctx: Context<'info, SetScoresBatch<'info>>, entries: Vec<ScoreEntry>) -> Result<()> {
    require!(!entries.is_empty() && entries.len() <= MAX_BATCH, FairwayError::BadBatch);
    require!(ctx.remaining_accounts.len() == entries.len(), FairwayError::BadBatch);
    let slot = Clock::get()?.slot;
    for (e, acc) in entries.iter().zip(ctx.remaining_accounts.iter()) {
        require!((e.tier as usize) < NUM_TIERS, FairwayError::InvalidTier);
        let (pda, bump) = Pubkey::find_program_address(&[SCORE_SEED, e.trader.as_ref()], &crate::ID);
        require_keys_eq!(acc.key(), pda, FairwayError::ScoreAccountMismatch);
        require!(acc.is_writable, FairwayError::BadBatch);
        let authority = ctx.accounts.authority.to_account_info();
        ensure_score_account(acc, &e.trader, bump, &authority, None)?;
        // keep the program-written onchain fields; only the bootstrap fields come from the keeper
        let mut s = load_score(acc).unwrap_or_else(|| TraderScore::new(e.trader, bump));
        s.tier = e.tier;
        s.score_bps = e.score_bps;
        s.trades = e.trades;
        s.updated_slot = slot;
        store_score(acc, &s)?;
        emit!(ScoreUpdated { trader: e.trader, tier: e.tier, score_bps: e.score_bps, trades: e.trades, slot });
    }
    Ok(())
}

/// Create the score PDA if it does not exist yet; otherwise require it to be program-owned.
///
/// Rent: if a `sponsor` (the protocol treasury, a program-owned PDA) can pay the rent and stay rent-exempt itself, it
/// pays (lamports moved directly) and the account is marked `sponsored`. Otherwise `payer` (the trader / keeper) pays.
/// Returns the lamports the sponsor paid (0 = not sponsored, or the account already existed).
pub(crate) fn ensure_score_account<'info>(
    acc: &AccountInfo<'info>,
    trader: &Pubkey,
    bump: u8,
    payer: &AccountInfo<'info>,
    sponsor: Option<(&AccountInfo<'info>, u8)>,
) -> Result<u64> {
    let mut sponsored_lamports = 0u64;
    if acc.owner == &system_program::ID && acc.data_len() == 0 {
        let space = 8 + TraderScore::INIT_SPACE;
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(space);
        let seeds: &[&[u8]] = &[SCORE_SEED, trader.as_ref(), &[bump]];
        let mut needed = lamports.saturating_sub(acc.lamports());
        if needed > 0 {
            if let Some((t, t_bump)) = sponsor {
                // the treasury is a system-owned PDA: it pays through a signed system transfer, and must stay rent-exempt
                let floor = rent.minimum_balance(0);
                if t.owner == &system_program::ID && t.data_len() == 0 && t.lamports() >= floor.saturating_add(needed) {
                    let t_seeds: &[&[u8]] = &[TREASURY_SEED, &[t_bump]];
                    system_program::transfer(
                        CpiContext::new_with_signer(system_program::ID, system_program::Transfer { from: t.clone(), to: acc.clone() }, &[t_seeds]),
                        needed,
                    )?;
                    sponsored_lamports = needed;
                    needed = 0;
                }
            }
        }
        if needed > 0 {
            system_program::transfer(CpiContext::new(system_program::ID, system_program::Transfer { from: payer.clone(), to: acc.clone() }), needed)?;
        }
        system_program::allocate(CpiContext::new_with_signer(system_program::ID, system_program::Allocate { account_to_allocate: acc.clone() }, &[seeds]), space as u64)?;
        system_program::assign(CpiContext::new_with_signer(system_program::ID, system_program::Assign { account_to_assign: acc.clone() }, &[seeds]), &crate::ID)?;
        // fresh zeroed data is not a valid TraderScore yet: write neutral defaults
        let mut fresh = TraderScore::new(*trader, bump);
        fresh.sponsored = sponsored_lamports > 0;
        store_score(acc, &fresh)?;
    } else {
        require!(acc.owner == &crate::ID, FairwayError::ScoreAccountMismatch);
    }
    Ok(sponsored_lamports)
}

/// Read a program-owned `TraderScore`, if the account holds one.
pub(crate) fn load_score(acc: &AccountInfo) -> Option<TraderScore> {
    if acc.owner != &crate::ID || acc.data_len() < 8 {
        return None;
    }
    let data = acc.try_borrow_data().ok()?;
    TraderScore::try_deserialize(&mut &data[..]).ok()
}

pub(crate) fn store_score(acc: &AccountInfo, s: &TraderScore) -> Result<()> {
    let mut data = acc.try_borrow_mut_data()?;
    let mut cursor: &mut [u8] = &mut data[..];
    s.try_serialize(&mut cursor)?;
    Ok(())
}

#[derive(Accounts)]
pub struct CloseScore<'info> {
    /// the trader themself, or the score authority (only while the account holds no onchain evidence)
    pub closer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [TREASURY_SEED], bump)]
    pub treasury: SystemAccount<'info>,
    #[account(
        mut, seeds = [SCORE_SEED, score.trader.as_ref()], bump = score.bump,
        constraint = closer.key() == score.trader
            || (closer.key() == config.score_authority && score.sum_notional == 0 && score.pending.iter().all(|p| p.notional == 0))
            @ FairwayError::CannotClose,
        close = rent_receiver
    )]
    pub score: Account<'info, TraderScore>,
    /// CHECK: rent goes back to whoever paid it: the treasury if it sponsored the account, else the trader
    #[account(mut, constraint = rent_receiver.key() == if score.sponsored { treasury.key() } else { score.trader } @ FairwayError::CannotClose)]
    pub rent_receiver: UncheckedAccount<'info>,
}

pub fn handle_close_score(_ctx: Context<CloseScore>) -> Result<()> {
    // Closing never helps a bot: without a score account the swap falls back to the default tier (>= STANDARD).
    // The authority cannot close an account with onchain evidence, so it cannot wipe a verified score and then
    // overwrite it with a bootstrap tier.
    Ok(())
}
