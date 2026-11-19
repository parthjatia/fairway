//! `settle_markout`: permissionless crank that turns a wallet's pending trades into a trustless onchain score.
use anchor_lang::prelude::*;
use fairway_math::markout::{accumulate, confidence_ok, markout_bps, onchain_tier, pyth_to_price_scaled, score_bps, Sums};

use crate::{
    constants::*,
    error::FairwayError,
    events::MarkoutSettled,
    state::{Config, PendingTrade, Pool, TraderScore},
};

#[derive(Accounts)]
#[instruction(trader: Pubkey)]
pub struct SettleMarkout<'info> {
    /// anyone may crank (no reward in the MVP; LPs, the keeper or the trader have the incentive)
    pub cranker: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// MUST be the PDA ["score", trader]: a crank cannot write one wallet's markout into another's score.
    #[account(
        mut, seeds = [SCORE_SEED, trader.as_ref()], bump = score.bump,
        constraint = score.trader == trader @ FairwayError::ScoreAccountMismatch
    )]
    pub score: Box<Account<'info, TraderScore>>,
    /// The pool whose pending trades are settled, and whose oracle is used.
    #[account(seeds = [POOL_SEED, pool.base_mint.as_ref(), pool.quote_mint.as_ref()], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,
    /// CHECK: validated in `read_pyth`: address = the pool's oracle, owner = Pyth receiver, discriminator, feed id,
    /// full verification, staleness and confidence.
    pub pyth_price: UncheckedAccount<'info>,
}

/// Anchor discriminator of Pyth's `PriceUpdateV2` account (sha256("account:PriceUpdateV2")[..8]).
pub const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

/// Fields we need from a Pyth `PriceUpdateV2` (pyth-solana-receiver-sdk layout).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PythPrice {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
    pub posted_slot: u64,
}

/// Parse a `PriceUpdateV2`: disc(8) write_authority(32) verification_level(1|2) PriceFeedMessage(84) posted_slot(8).
/// Only `VerificationLevel::Full` (tag 1) is accepted.
pub fn parse_price_update_v2(data: &[u8]) -> Option<PythPrice> {
    if data.len() < 8 + 32 + 1 || data[..8] != PRICE_UPDATE_V2_DISCRIMINATOR || data[40] != 1 {
        return None;
    }
    let m = &data[41..];
    if m.len() < 84 + 8 {
        return None;
    }
    let i64_at = |o: usize| i64::from_le_bytes(m[o..o + 8].try_into().unwrap());
    Some(PythPrice {
        feed_id: m[0..32].try_into().unwrap(),
        price: i64_at(32),
        conf: u64::from_le_bytes(m[40..48].try_into().unwrap()),
        expo: i32::from_le_bytes(m[48..52].try_into().unwrap()),
        publish_time: i64_at(52),
        // 60 prev_publish_time, 68 ema_price, 76 ema_conf
        posted_slot: u64::from_le_bytes(m[84..92].try_into().unwrap()),
    })
}

/// Max seconds an oracle publish_time may be ahead of the validator clock.
const MAX_FUTURE_SKEW_SECS: i64 = 10;

fn read_pyth(acc: &AccountInfo, cfg: &Config, pool: &Pool, now_ts: i64) -> Result<(u64, u64)> {
    let m = &cfg.markout;
    require!(pool.oracle_price_account != Pubkey::default(), FairwayError::OracleNotConfigured);
    require_keys_eq!(acc.key(), pool.oracle_price_account, FairwayError::OracleMismatch);
    require_keys_eq!(*acc.owner, PYTH_RECEIVER_PROGRAM, FairwayError::OracleInvalid);
    let data = acc.try_borrow_data()?;
    let p = parse_price_update_v2(&data).ok_or(error!(FairwayError::OracleInvalid))?;
    require!(p.feed_id == pool.oracle_feed_id, FairwayError::OracleInvalid);
    let age = now_ts - p.publish_time;
    require!(age >= -MAX_FUTURE_SKEW_SECS && age <= m.pyth_max_staleness_secs as i64, FairwayError::OracleStale);
    require!(confidence_ok(p.price, p.conf, m.pyth_max_conf_bps), FairwayError::OracleLowConfidence);
    let mid = pyth_to_price_scaled(p.price, p.expo).map_err(|_| error!(FairwayError::OracleInvalid))?;
    Ok((mid, p.posted_slot))
}

pub fn handle_settle_markout(ctx: Context<SettleMarkout>, trader: Pubkey) -> Result<()> {
    let clock = Clock::get()?;
    let slot = clock.slot;
    let cfg = &ctx.accounts.config;
    let m = cfg.markout;
    let pool = &ctx.accounts.pool;
    let pool_key = pool.key();
    let s = &mut ctx.accounts.score;

    // 1) drop trades nobody settled in time; find the ones whose horizon has passed
    let mut expired = 0u8;
    let mut due = false;
    for p in s.pending.iter_mut().filter(|p| p.notional != 0) {
        let age = slot.saturating_sub(p.slot);
        if age > m.max_settle_slots {
            *p = PendingTrade::default();
            expired += 1;
        } else if age >= m.markout_slots && p.pool == pool_key {
            due = true;
        }
    }
    s.dropped_trades = s.dropped_trades.saturating_add(expired as u32);
    if !due {
        msg!("fairway: nothing to settle for {} ({} expired)", trader, expired);
        if expired > 0 {
            emit!(MarkoutSettled { trader, settled: 0, expired, tier: s.onchain_tier, score_bps: s.onchain_score_bps, sum_notional: s.sum_notional, trade_count: s.trade_count, slot });
        }
        return Ok(());
    }

    // 2) one validated oracle mid for all due trades. The price must have been posted after each trade's horizon.
    let (mid, posted_slot) = read_pyth(&ctx.accounts.pyth_price.to_account_info(), cfg, pool, clock.unix_timestamp)?;
    let mut sums = Sums { sum_notional: s.sum_notional, sum_weighted_markout: s.sum_weighted_markout, trades: s.trade_count };
    let mut settled = 0u8;
    for p in s.pending.iter_mut().filter(|p| p.notional != 0) {
        let horizon = p.slot.saturating_add(m.markout_slots);
        // only this pool's trades are marked against this pool's oracle
        if p.pool != pool_key || slot < horizon || posted_slot < horizon {
            continue;
        }
        let mk = markout_bps(p.side, p.exec_price, mid).map_err(|_| error!(FairwayError::OracleInvalid))?;
        sums = accumulate(sums, p.notional, mk).map_err(|_| error!(FairwayError::Overflow))?;
        *p = PendingTrade::default();
        settled += 1;
    }

    // 3) same shrinkage + thresholds as packages/scoring
    s.sum_notional = sums.sum_notional;
    s.sum_weighted_markout = sums.sum_weighted_markout;
    s.trade_count = sums.trades;
    s.onchain_score_bps = score_bps(&sums, m.prior_notional);
    let history = if s.first_slot == 0 { 0 } else { slot.saturating_sub(s.first_slot) };
    s.onchain_tier = onchain_tier(&sums, history, &m.tier_params());
    emit!(MarkoutSettled {
        trader,
        settled,
        expired,
        tier: s.onchain_tier,
        score_bps: s.onchain_score_bps,
        sum_notional: s.sum_notional,
        trade_count: s.trade_count,
        slot
    });
    Ok(())
}
