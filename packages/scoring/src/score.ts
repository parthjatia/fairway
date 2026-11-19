import type { ScoringConfig } from './config';
import { DEFAULT_SCORING_CONFIG } from './config';
import { markoutBps, notionalOf } from './markout';
import type { MidPriceProvider } from './midprice';
import { assignTier } from './tiers';
import type { HorizonScore, Swap, WalletScore } from './types';

export type TradeMarkout = {
  sig: string;
  ts: number;
  side: Swap['side'];
  notional: number;
  execPrice: number;
  /** horizon (s) → markout bps, NaN if no mid available */
  markouts: Record<number, number>;
};

/** Markouts of one swap at every configured horizon. */
export function tradeMarkouts(swap: Swap, mids: MidPriceProvider, horizons: number[]): TradeMarkout {
  const markouts: Record<number, number> = {};
  for (const h of horizons) {
    const m = mids.midAt(swap.ts + h, swap.pool);
    markouts[h] = m === undefined ? NaN : markoutBps(swap.side, swap.execPrice, m);
  }
  return { sig: swap.sig, ts: swap.ts, side: swap.side, notional: notionalOf(swap), execPrice: swap.execPrice, markouts };
}

/** Bayesian-shrunk weighted mean: Σ(n·m) / (Σn + K). */
export const shrunkScore = (sumNotionalMarkout: number, sumNotional: number, prior: number): number =>
  sumNotional + prior <= 0 ? 0 : sumNotionalMarkout / (sumNotional + prior);

/** Accumulates a wallet's markouts; usable incrementally (ingest) or in batch. */
export class WalletAccumulator {
  trades = 0;
  totalNotional = 0;
  firstSeen = Infinity;
  lastSeen = -Infinity;
  private readonly sums = new Map<number, { nm: number; n: number; count: number }>();

  constructor(readonly trader: string, readonly cfg: ScoringConfig = DEFAULT_SCORING_CONFIG) {
    for (const h of cfg.horizons) this.sums.set(h, { nm: 0, n: 0, count: 0 });
  }

  add(t: TradeMarkout): void {
    this.trades += 1;
    this.totalNotional += t.notional;
    this.firstSeen = Math.min(this.firstSeen, t.ts);
    this.lastSeen = Math.max(this.lastSeen, t.ts);
    for (const h of this.cfg.horizons) {
      const m = t.markouts[h];
      if (m === undefined || !Number.isFinite(m)) continue;
      const s = this.sums.get(h)!;
      s.nm += t.notional * m;
      s.n += t.notional;
      s.count += 1;
    }
  }

  /** @param asOf unix seconds used for history length (defaults to last trade time) */
  result(asOf?: number): WalletScore {
    const byHorizon: Record<number, HorizonScore> = {};
    for (const h of this.cfg.horizons) {
      const s = this.sums.get(h)!;
      byHorizon[h] = {
        horizonSec: h,
        scoreBps: shrunkScore(s.nm, s.n, this.cfg.priorNotional),
        rawBps: s.n > 0 ? s.nm / s.n : 0,
        scoredTrades: s.count,
        scoredNotional: s.n,
      };
    }
    const primary = byHorizon[this.cfg.primaryHorizon];
    const scoreBps = primary ? primary.scoreBps : 0;
    const end = asOf ?? this.lastSeen;
    const historyDays = this.trades > 0 ? Math.max(0, (end - this.firstSeen) / this.cfg.secondsPerDay) : 0;
    // tier uses trades that actually have a markout at the primary horizon
    const scoredTrades = primary ? primary.scoredTrades : 0;
    // horizons with no scored trades carry no evidence
    const informative = Object.values(byHorizon).filter((h) => h.scoredTrades > 0).map((h) => h.scoreBps);
    const maxScoreBps = informative.length ? Math.max(...informative) : undefined;
    const tier = this.trades === 0 ? 'STANDARD' : assignTier({ scoreBps, trades: scoredTrades, historyDays, maxScoreBps }, this.cfg);
    return {
      trader: this.trader,
      tier,
      scoreBps,
      trades: this.trades,
      totalNotional: this.totalNotional,
      firstSeen: this.trades > 0 ? this.firstSeen : 0,
      lastSeen: this.trades > 0 ? this.lastSeen : 0,
      historyDays,
      maxScoreBps: maxScoreBps ?? scoreBps,
      byHorizon,
    };
  }
}

/** Score every wallet in `swaps`. Deterministic: output sorted by trader. */
export function scoreWallets(
  swaps: ReadonlyArray<Swap>,
  mids: MidPriceProvider,
  cfg: ScoringConfig = DEFAULT_SCORING_CONFIG,
  asOf?: number,
): WalletScore[] {
  const acc = new Map<string, WalletAccumulator>();
  for (const s of swaps) {
    let a = acc.get(s.trader);
    if (!a) acc.set(s.trader, (a = new WalletAccumulator(s.trader, cfg)));
    a.add(tradeMarkouts(s, mids, cfg.horizons));
  }
  return [...acc.values()].map((a) => a.result(asOf)).sort((x, y) => (x.trader < y.trader ? -1 : x.trader > y.trader ? 1 : 0));
}

export function scoreWallet(
  trader: string,
  swaps: ReadonlyArray<Swap>,
  mids: MidPriceProvider,
  cfg: ScoringConfig = DEFAULT_SCORING_CONFIG,
  asOf?: number,
): WalletScore {
  const a = new WalletAccumulator(trader, cfg);
  for (const s of swaps) if (s.trader === trader) a.add(tradeMarkouts(s, mids, cfg.horizons));
  return a.result(asOf);
}

/** Values written onchain by `set_score` (integers only). */
export function toOnchainScore(ws: Pick<WalletScore, 'tier' | 'scoreBps' | 'trades'>): { tier: 0 | 1 | 2; scoreBps: number; trades: number } {
  const tier = ws.tier === 'RETAIL' ? 0 : ws.tier === 'TOXIC' ? 2 : 1;
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  return { tier, scoreBps: Math.round(clamp(ws.scoreBps, -2_147_483_648, 2_147_483_647)), trades: clamp(ws.trades, 0, 4_294_967_295) };
}
