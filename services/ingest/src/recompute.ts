import { makeConfig, tierTimeline as scoringTierTimeline, PoolImpliedMidPrice, scoreWallets, tradeMarkouts, type MidPriceProvider, type ScoringConfig, type Swap } from '@fairway/scoring';
import { allSwaps, maxTs, saveScores, swapsForTraders, swapsOfTrader, type Db } from './db';

/**
 * Mid-price source for markouts:
 *  - fixture mode: the simulated CEX path that generated the fixtures (ground-truth "fair" price)
 *  - live mode: pool-implied mid from the stream itself (last trade per pool), see STREAM_CONFIG.md
 */
export type MidSource = { provider: () => MidPriceProvider; name: string };

export const poolImpliedSource = (db: Db): MidSource => ({
  name: 'pool-implied',
  provider: () => new PoolImpliedMidPrice(allSwaps(db), { maxStaleSec: 600 }),
});

export type RecomputeResult = { wallets: number; tiers: Record<string, number>; ms: number; asOf: number };

/** Recompute scores for `traders` (or everyone). History length is measured up to the latest data timestamp. */
export function recompute(db: Db, mids: MidSource, traders?: string[], cfg: ScoringConfig = makeConfig()): RecomputeResult {
  const t0 = Date.now();
  const swaps = traders ? swapsForTraders(db, traders) : allSwaps(db);
  const asOf = maxTs(db);
  const scores = scoreWallets(swaps, mids.provider(), cfg, asOf);
  saveScores(db, scores);
  const tiers: Record<string, number> = {};
  for (const s of scores) tiers[s.tier] = (tiers[s.tier] ?? 0) + 1;
  return { wallets: scores.length, tiers, ms: Date.now() - t0, asOf };
}

export type TradeWithMarkout = Swap & { markouts: Record<number, number | null> };

/** Trades of one wallet with per-horizon markouts (for the score explorer). */
export function tradesWithMarkouts(db: Db, trader: string, mids: MidSource, cfg: ScoringConfig = makeConfig(), limit = 500): TradeWithMarkout[] {
  const m = mids.provider();
  return swapsOfTrader(db, trader, limit).map((s) => {
    const t = tradeMarkouts(s, m, cfg.horizons);
    const markouts: Record<number, number | null> = {};
    for (const h of cfg.horizons) markouts[h] = Number.isFinite(t.markouts[h]) ? t.markouts[h]! : null;
    return { ...s, markouts };
  });
}

/** Rolling tier timeline (see @fairway/scoring tierTimeline). */
export const tierTimeline = (trades: TradeWithMarkout[], cfg: ScoringConfig = makeConfig()) => scoringTierTimeline(trades, cfg);
