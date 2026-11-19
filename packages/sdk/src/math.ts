/** Bit-exact TypeScript port of crates/fairway-math (bigint), for quoting in the UI and keeper. */
import { BPS_DENOM, MAX_FEE_BPS, MIN_LIQUIDITY } from './constants';

export class MathError extends Error {}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

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
export type TierSource = 'score' | 'missing' | 'stale' | 'invalid';

/** Mirrors `resolve_tier` in the program: what tier will a swap by this wallet pay right now? */
export function resolveTier(score: ScoreView | null, currentSlot: bigint, ttlSlots: bigint, defaultTier: number): { tier: number; source: TierSource } {
  const fallback = Math.min(2, Math.max(1, defaultTier));
  if (!score) return { tier: fallback, source: 'missing' };
  if (score.tier > 2 || score.updatedSlot > currentSlot) return { tier: fallback, source: 'invalid' };
  if (currentSlot - score.updatedSlot > ttlSlots) return { tier: fallback, source: 'stale' };
  return { tier: score.tier, source: 'score' };
}
