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
    let space = 8 + TraderScore::INIT_SPACE;
    for (e, acc) in entries.iter().zip(ctx.remaining_accounts.iter()) {
        require!((e.tier as usize) < NUM_TIERS, FairwayError::InvalidTier);
        let (pda, bump) = Pubkey::find_program_address(&[SCORE_SEED, e.trader.as_ref()], &crate::ID);
        require_keys_eq!(acc.key(), pda, FairwayError::ScoreAccountMismatch);
        require!(acc.is_writable, FairwayError::BadBatch);
        if acc.owner == &system_program::ID && acc.data_len() == 0 {
            // create the PDA (fund rent from the authority)
            let lamports = Rent::get()?.minimum_balance(space);
            let seeds: &[&[u8]] = &[SCORE_SEED, e.trader.as_ref(), &[bump]];
            let needed = lamports.saturating_sub(acc.lamports());
            if needed > 0 {
                system_program::transfer(
                    CpiContext::new(system_program::ID, system_program::Transfer { from: ctx.accounts.authority.to_account_info(), to: acc.clone() }),
                    needed,
                )?;
            }
            system_program::allocate(CpiContext::new_with_signer(system_program::ID, system_program::Allocate { account_to_allocate: acc.clone() }, &[seeds]), space as u64)?;
            system_program::assign(CpiContext::new_with_signer(system_program::ID, system_program::Assign { account_to_assign: acc.clone() }, &[seeds]), &crate::ID)?;
        } else {
            require!(acc.owner == &crate::ID, FairwayError::ScoreAccountMismatch);
        }
        let s = TraderScore { trader: e.trader, tier: e.tier, score_bps: e.score_bps, trades: e.trades, updated_slot: slot, bump };
        let mut data = acc.try_borrow_mut_data()?;
        let mut cursor: &mut [u8] = &mut data[..];
        s.try_serialize(&mut cursor)?;
        emit!(ScoreUpdated { trader: e.trader, tier: e.tier, score_bps: e.score_bps, trades: e.trades, slot });
    }
    Ok(())
}

#[derive(Accounts)]
pub struct CloseScore<'info> {
    /// the score authority or the trader themself
    pub closer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut, seeds = [SCORE_SEED, score.trader.as_ref()], bump = score.bump,
        constraint = closer.key() == config.score_authority || closer.key() == score.trader @ FairwayError::CannotClose,
        close = rent_receiver
    )]
    pub score: Account<'info, TraderScore>,
    /// CHECK: rent goes back to the score authority, who paid for the account
    #[account(mut, address = config.score_authority)]
    pub rent_receiver: UncheckedAccount<'info>,
}

pub fn handle_close_score(_ctx: Context<CloseScore>) -> Result<()> {
    // Closing never helps a bot: without a score account the swap falls back to the default tier (>= STANDARD).
    Ok(())
}
