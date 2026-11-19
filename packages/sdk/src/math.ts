/** Bit-exact TypeScript port of crates/fairway-math (bigint), for quoting in the UI and keeper. */
import { BPS_DENOM, MAX_FEE_BPS, MIN_LIQUIDITY } from './constants';

export class MathError extends Error {}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Mirrors `fairway_math::rebate::swap_rebate_bps`: rebate (bps) one RETAIL-tier swap gets (rate, floor and what is left of the budget). */
export function swapRebateBps(rateBps: number, budgetLeftQ: bigint, notionalQ: bigint, baseFeeBps: number, floorBps: number): number {
  if (rateBps <= 0 || budgetLeftQ <= 0n || notionalQ <= 0n) return 0;
  const byBudget = (budgetLeftQ * BPS_DENOM) / notionalQ;
  const headroom = BigInt(Math.max(0, baseFeeBps - floorBps));
  const r = BigInt(rateBps);
  return Number([r, byBudget, headroom].reduce((a, b) => (b < a ? b : a)));
}

export function feeOnInput(amountIn: bigint, feeBps: number): bigint {
  if (feeBps > MAX_FEE_BPS || feeBps < 0) throw new MathError('InvalidFee');
  return ceilDiv(amountIn * BigInt(feeBps), BPS_DENOM);
}

export type SwapQuote = { amountOut: bigint; fee: bigint; inAfterFee: bigint };

export function swapQuote(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: number): SwapQuote {
  if (amountIn <= 0n) throw new MathError('ZeroAmount');
  if (reserveIn <= 0n || reserveOut <= 0n) throw new MathError('ZeroReserves');
  const fee = feeOnInput(amountIn, feeBps);
  const inAfterFee = amountIn - fee;
  const amountOut = (inAfterFee * reserveOut) / (reserveIn + inAfterFee);
  if (amountOut === 0n) throw new MathError('InsufficientOutput');
  if (amountOut >= reserveOut) throw new MathError('InsufficientLiquidity');
  return { amountOut, fee, inAfterFee };
}

export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

export function initialLp(a: bigint, b: bigint): { lp: bigint; total: bigint } {
  if (a <= 0n || b <= 0n) throw new MathError('ZeroAmount');
  const total = isqrt(a * b);
  if (total <= MIN_LIQUIDITY) throw new MathError('InsufficientLiquidity');
  return { lp: total - MIN_LIQUIDITY, total };
}

export function deposit(maxA: bigint, maxB: bigint, ra: bigint, rb: bigint, supply: bigint) {
  if (maxA <= 0n || maxB <= 0n) throw new MathError('ZeroAmount');
  if (ra <= 0n || rb <= 0n || supply <= 0n) throw new MathError('ZeroReserves');
  const la = (maxA * supply) / ra;
  const lb = (maxB * supply) / rb;
  const lp = la < lb ? la : lb;
  if (lp === 0n) throw new MathError('InsufficientOutput');
  return { lp, usedA: ceilDiv(lp * ra, supply), usedB: ceilDiv(lp * rb, supply) };
}

export function withdraw(lp: bigint, ra: bigint, rb: bigint, supply: bigint): [bigint, bigint] {
  if (lp <= 0n) throw new MathError('ZeroAmount');
  if (lp > supply - MIN_LIQUIDITY) throw new MathError('InsufficientLiquidity');
  return [(lp * ra) / supply, (lp * rb) / supply];
}

export type ScoreView = { tier: number; updatedSlot: bigint };
export type TierSource = 'score' | 'onchain' | 'missing' | 'stale' | 'invalid';

/** Mirrors `resolve_tier` in the program: what tier will a swap by this wallet pay right now? */
export function resolveTier(score: ScoreView | null, currentSlot: bigint, ttlSlots: bigint, defaultTier: number): { tier: number; source: TierSource } {
  const fallback = Math.min(2, Math.max(1, defaultTier));
  if (!score) return { tier: fallback, source: 'missing' };
  if (score.tier > 2 || score.updatedSlot > currentSlot) return { tier: fallback, source: 'invalid' };
  if (currentSlot - score.updatedSlot > ttlSlots) return { tier: fallback, source: 'stale' };
  return { tier: score.tier, source: 'score' };
}

/**
 * Mirrors `resolve_blended`: once settled onchain notional ≥ `onchainMinNotional` and trades ≥ `minTrades`, the trustless onchain tier wins;
 * below that the keeper's bootstrap score applies (with TTL). Also mirrors the buffer-full rule in `swap`.
 */
export function resolveBlendedTier(
  p: { onchain?: { tier: number; sumNotional: bigint; trades: number } | null; onchainMinNotional: bigint; minTrades: number; bootstrap: ScoreView | null; pendingFull?: boolean },
  currentSlot: bigint,
  ttlSlots: bigint,
  defaultTier: number,
): { tier: number; source: TierSource } {
  let r: { tier: number; source: TierSource };
  if (p.onchain && p.onchain.tier <= 2 && p.onchainMinNotional > 0n && p.onchain.sumNotional >= p.onchainMinNotional && p.onchain.trades >= p.minTrades) r = { tier: p.onchain.tier, source: 'onchain' };
  else r = resolveTier(p.bootstrap, currentSlot, ttlSlots, defaultTier);
  if (p.pendingFull && r.tier === 0) r = { ...r, tier: 1 };
  return r;
}

// ---- M16 launch fee schedule (mirrors crates/fairway-math/src/launch.rs) ----

export type LaunchCurveLike = { startBps: readonly number[]; endBps: readonly number[] };
export type LaunchPhase = { kind: 'not-started' } | { kind: 'window'; elapsed: bigint } | { kind: 'after' };

export function launchPhase(slot: bigint, launchSlot: bigint, windowSlots: bigint): LaunchPhase {
  if (windowSlots === 0n) return { kind: 'after' };
  if (slot < launchSlot) return { kind: 'not-started' };
  const elapsed = slot - launchSlot;
  return elapsed >= windowSlots ? { kind: 'after' } : { kind: 'window', elapsed };
}

/** `end + ceil((start − end) × (window − elapsed) / window)`; elapsed 0 → start fee. */
export function decayedFeeBps(curve: LaunchCurveLike, tier: number, elapsed: bigint, windowSlots: bigint): number {
  const t = Math.min(Math.max(tier, 0), 2);
  const s = BigInt(curve.startBps[t]!);
  const e = BigInt(curve.endBps[t]!);
  if (windowSlots === 0n || elapsed >= windowSlots || s <= e) return Number(e);
  const num = (s - e) * (windowSlots - elapsed);
  return Number(e + (num + windowSlots - 1n) / windowSlots);
}

/** Launch fee at `slot`, or null when the normal tier fee applies. */
export function launchFeeBps(curve: LaunchCurveLike, tier: number, slot: bigint, launchSlot: bigint, windowSlots: bigint): number | null {
  const ph = launchPhase(slot, launchSlot, windowSlots);
  return ph.kind === 'window' ? decayedFeeBps(curve, tier, ph.elapsed, windowSlots) : null;
}

// ---- M16 pool TWAP (mirrors crates/fairway-math/src/twap.rs; read-only) ----

export type TwapLike = { lastSlot: bigint; lastPrice: bigint; cum: bigint; head: number; count: number; obsSlot: readonly bigint[]; obsCum: readonly bigint[] };

export function twapCumAt(t: TwapLike, x: bigint): bigint | null {
  const cap = t.obsSlot.length;
  if (t.count === 0) return null;
  const oldest = t.count < cap ? 0 : (t.head + 1) % cap;
  if (x < t.obsSlot[oldest]!) return null;
  if (x >= t.lastSlot) return t.cum + t.lastPrice * (x - t.lastSlot);
  let upSlot = t.lastSlot;
  let upCum = t.cum;
  for (let k = 0; k < t.count; k++) {
    const i = (t.head + cap - k) % cap;
    const s = t.obsSlot[i]!;
    const c = t.obsCum[i]!;
    if (s <= x) return upSlot === s ? c : c + ((upCum - c) * (x - s)) / (upSlot - s);
    upSlot = s;
    upCum = c;
  }
  return null;
}

/** Average pool price over [from, to), 1e12 fixed point; null if out of history. */
export function poolTwap(t: TwapLike, from: bigint, to: bigint): bigint | null {
  if (to <= from) return null;
  const a = twapCumAt(t, from);
  const b = twapCumAt(t, to);
  if (a === null || b === null || b < a) return null;
  const p = (b - a) / (to - from);
  return p > 0n ? p : null;
}
