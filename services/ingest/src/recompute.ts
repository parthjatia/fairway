import { assignTier, makeConfig, PoolImpliedMidPrice, scoreWallets, tradeMarkouts, type MidPriceProvider, type ScoringConfig, type Swap, type WalletScore } from '@fairway/scoring';
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

/** Rolling tier timeline: the tier the wallet would have had after each of its trades. */
export function tierTimeline(trades: TradeWithMarkout[], cfg: ScoringConfig = makeConfig()): Array<{ ts: number; tier: WalletScore['tier']; scoreBps: number }> {
  const sorted = [...trades].sort((a, b) => a.ts - b.ts);
  const out: Array<{ ts: number; tier: WalletScore['tier']; scoreBps: number }> = [];
  const sums = new Map<number, { nm: number; n: number; c: number }>(cfg.horizons.map((h) => [h, { nm: 0, n: 0, c: 0 }]));
  let first = Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    first = Math.min(first, s.ts);
    for (const h of cfg.horizons) {
      const mk = s.markouts[h];
      if (mk === null || mk === undefined) continue;
      const a = sums.get(h)!;
      a.nm += s.quoteAmount * mk;
      a.n += s.quoteAmount;
      a.c += 1;
    }
    const scoreOf = (h: number) => {
      const a = sums.get(h)!;
      return a.nm / (a.n + cfg.priorNotional);
    };
    const primary = scoreOf(cfg.primaryHorizon);
    const informative = cfg.horizons.filter((h) => sums.get(h)!.c > 0).map(scoreOf);
    const maxScore = informative.length ? Math.max(...informative) : primary;
    const trades = sums.get(cfg.primaryHorizon)!.c;
    const historyDays = (s.ts - first) / cfg.secondsPerDay;
    const tier = assignTier({ scoreBps: primary, trades, historyDays, maxScoreBps: maxScore }, cfg);
    out.push({ ts: s.ts, tier, scoreBps: primary });
  }
  return out;
}
