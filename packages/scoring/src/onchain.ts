/**
 * Integer mirror of the program's onchain markout math (`crates/fairway-math/src/markout.rs`).
 * Bit-identical on the shared vectors in `crates/fairway-math/vectors/onchain.json` (checked by both test suites).
 *
 * Differences from the float scorer in `score.ts` are deliberate and small:
 *  - one horizon (MARKOUT_SLOTS ≈ 30 s, the primary horizon) instead of three;
 *  - integer bps truncated toward zero, each trade clamped to ±10_000 bps;
 *  - history is measured in slots (`retailMinHistorySlots`), not days.
 * Tier thresholds, the shrinkage prior K and the comparison semantics (score ≥ toxic, ≤ retail) are the same.
 */
import type { ScoringConfig } from './config';
import { DEFAULT_SCORING_CONFIG } from './config';
import type { Tier } from './types';

export const PRICE_SCALE = 1_000_000n;
export const MARKOUT_CLAMP_BPS = 10_000n;
export const SIDE_BUY = 0;
export const SIDE_SELL = 1;
export const TIER_FROM_INDEX: Tier[] = ['RETAIL', 'STANDARD', 'TOXIC'];

const clamp = (x: bigint, lo: bigint, hi: bigint) => (x < lo ? lo : x > hi ? hi : x);

/** BigInt `/` truncates toward zero, exactly like Rust's i128 `/`. */
export function onchainMarkoutBps(side: 0 | 1 | 'buy' | 'sell', execPrice: bigint, mid: bigint): bigint {
  if (execPrice <= 0n || mid <= 0n) throw new RangeError('price must be > 0');
  const s = side === 0 || side === 'buy' ? 1n : -1n;
  return clamp((s * (mid - execPrice) * 10_000n) / execPrice, -MARKOUT_CLAMP_BPS, MARKOUT_CLAMP_BPS);
}

export function execPriceE6(quoteRaw: bigint, quoteDecimals: number, baseRaw: bigint, baseDecimals: number): bigint {
  if (quoteRaw <= 0n || baseRaw <= 0n) throw new RangeError('amounts must be > 0');
  return (quoteRaw * 10n ** BigInt(baseDecimals) * PRICE_SCALE) / (baseRaw * 10n ** BigInt(quoteDecimals));
}

export function pythToPriceE6(price: bigint, expo: number): bigint {
  if (price <= 0n) throw new RangeError('price must be > 0');
  const shift = expo + 6;
  const v = shift >= 0 ? price * 10n ** BigInt(shift) : price / 10n ** BigInt(-shift);
  if (v === 0n) throw new RangeError('price rounds to zero');
  return v;
}

export type OnchainSums = { sumNotional: bigint; sumWeightedMarkout: bigint; trades: number };
export const EMPTY_SUMS: OnchainSums = { sumNotional: 0n, sumWeightedMarkout: 0n, trades: 0 };

export const accumulateOnchain = (s: OnchainSums, notional: bigint, markout: bigint): OnchainSums => ({
  sumNotional: s.sumNotional + notional,
  sumWeightedMarkout: s.sumWeightedMarkout + notional * markout,
  trades: s.trades + 1,
});

const I32_MIN = -2_147_483_648n;
const I32_MAX = 2_147_483_647n;

/** Σ(n·m) / (Σn + K), truncated toward zero (same shrinkage as `shrunkScore`). */
export function onchainScoreBps(s: OnchainSums, priorNotional: bigint): number {
  const den = s.sumNotional + priorNotional;
  if (den <= 0n) return 0;
  return Number(clamp(s.sumWeightedMarkout / den, I32_MIN, I32_MAX));
}

export type OnchainTierParams = {
  priorNotional: bigint;
  toxicBps: number;
  toxicMinTrades: number;
  retailBps: number;
  retailMinTrades: number;
  retailMinHistorySlots: bigint;
};

/** Program defaults; thresholds come from `DEFAULT_SCORING_CONFIG`, K in raw USDC units (6 decimals), 3 days in 400 ms slots. */
export function onchainParamsFrom(cfg: ScoringConfig = DEFAULT_SCORING_CONFIG, quoteDecimals = 6, slotSeconds = 0.4): OnchainTierParams {
  return {
    priorNotional: BigInt(Math.round(cfg.priorNotional * 10 ** quoteDecimals)),
    toxicBps: cfg.toxicScoreBps,
    toxicMinTrades: cfg.toxicMinTrades,
    retailBps: cfg.retailScoreBps,
    retailMinTrades: cfg.retailMinTrades,
    retailMinHistorySlots: BigInt(Math.round((cfg.retailMinHistoryDays * cfg.secondsPerDay) / slotSeconds)),
  };
}

/** Exact (cross-multiplied) threshold comparisons, like `onchain_tier` in Rust. */
export function onchainTier(s: OnchainSums, historySlots: bigint, p: OnchainTierParams): 0 | 1 | 2 {
  const den = s.sumNotional + p.priorNotional;
  if (den <= 0n || s.trades === 0) return 1;
  const w = s.sumWeightedMarkout;
  if (w >= BigInt(p.toxicBps) * den && s.trades >= p.toxicMinTrades) return 2;
  if (w <= BigInt(p.retailBps) * den && s.trades >= p.retailMinTrades && historySlots >= p.retailMinHistorySlots) return 0;
  return 1;
}

export type OnchainScoreView = {
  /** settled trades on the Fairway pool */
  tradeCount: number;
  sumNotional: bigint;
  sumWeightedMarkout: bigint;
  scoreBps: number;
  tier: Tier;
  historySlots: bigint;
  /** sumNotional ≥ onchainMinNotional and tradeCount ≥ min(toxic, retail) min trades: the program uses this tier, not the keeper's */
  verified: boolean;
};

/**
 * What `settle_markout` would have written for these swaps: one horizon (`horizonSec`, default 30 s ≈ 75 slots),
 * mid from `midAt`, prices/notionals converted to the program's integer units.
 */
export function onchainScoreFromSwaps(
  swaps: ReadonlyArray<{ ts: number; side: 'buy' | 'sell'; quoteAmount: number; execPrice: number; pool: string }>,
  midAt: (ts: number, pool: string) => number | undefined,
  p: OnchainTierParams & { onchainMinNotional: bigint },
  o: { horizonSec?: number; asOf?: number; slotSeconds?: number; quoteDecimals?: number } = {},
): OnchainScoreView {
  const h = o.horizonSec ?? 30;
  const slotSec = o.slotSeconds ?? 0.4;
  const qd = o.quoteDecimals ?? 6;
  let s = EMPTY_SUMS;
  let first = Infinity;
  let last = -Infinity;
  for (const sw of swaps) {
    const mid = midAt(sw.ts + h, sw.pool);
    if (mid === undefined || !(sw.execPrice > 0) || !(mid > 0)) continue;
    const exec = BigInt(Math.round(sw.execPrice * 1e6));
    const m = onchainMarkoutBps(sw.side, exec, BigInt(Math.round(mid * 1e6)));
    s = accumulateOnchain(s, BigInt(Math.round(Math.abs(sw.quoteAmount) * 10 ** qd)), m);
    first = Math.min(first, sw.ts);
    last = Math.max(last, sw.ts);
  }
  const end = o.asOf ?? last;
  const historySlots = s.trades > 0 ? BigInt(Math.max(0, Math.floor((end - first) / slotSec))) : 0n;
  return {
    tradeCount: s.trades,
    sumNotional: s.sumNotional,
    sumWeightedMarkout: s.sumWeightedMarkout,
    scoreBps: onchainScoreBps(s, p.priorNotional),
    tier: TIER_FROM_INDEX[onchainTier(s, historySlots, p)]!,
    historySlots,
    verified: p.onchainMinNotional > 0n && s.sumNotional >= p.onchainMinNotional && s.trades >= Math.min(p.toxicMinTrades, p.retailMinTrades),
  };
}
