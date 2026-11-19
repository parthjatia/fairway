import type { ScoringConfig } from './config';
import { assignTier } from './tiers';
import type { Tier } from './types';

export type TradeWithMarkouts = { ts: number; quoteAmount: number; markouts: Record<number, number | null | undefined> };
export type TimelinePoint = { ts: number; tier: Tier; scoreBps: number; maxScoreBps: number; trades: number };

/** Rolling tier timeline: the tier a wallet would have had right after each of its trades. */
export function tierTimeline(trades: ReadonlyArray<TradeWithMarkouts>, cfg: ScoringConfig): TimelinePoint[] {
  const sorted = [...trades].sort((a, b) => a.ts - b.ts);
  const sums = new Map<number, { nm: number; n: number; c: number }>(cfg.horizons.map((h) => [h, { nm: 0, n: 0, c: 0 }]));
  const out: TimelinePoint[] = [];
  let first = Infinity;
  for (const s of sorted) {
    first = Math.min(first, s.ts);
    for (const h of cfg.horizons) {
      const mk = s.markouts[h];
      if (mk === null || mk === undefined || !Number.isFinite(mk)) continue;
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
    const maxScoreBps = informative.length ? Math.max(...informative) : primary;
    const n = sums.get(cfg.primaryHorizon)!.c;
    const historyDays = (s.ts - first) / cfg.secondsPerDay;
    out.push({ ts: s.ts, tier: assignTier({ scoreBps: primary, trades: n, historyDays, maxScoreBps }, cfg), scoreBps: primary, maxScoreBps, trades: n });
  }
  return out;
}
