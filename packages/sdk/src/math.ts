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
