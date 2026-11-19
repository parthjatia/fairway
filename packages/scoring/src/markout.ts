import type { Swap } from './types';

/**
 * Markout of a trade in bps: s * (m − execPrice) / execPrice * 10_000,
 * s = +1 for buy, −1 for sell, m = mid at t + h.
 * Positive = price moved in the trader's favour after the trade (informed flow).
 * Uses the PRE-fee execution price: we measure information, not cost.
 */
export function markoutBps(side: Swap['side'], execPrice: number, futureMid: number): number {
  if (!(execPrice > 0) || !Number.isFinite(futureMid)) return NaN;
  const s = side === 'buy' ? 1 : -1;
  return (s * (futureMid - execPrice)) / execPrice * 10_000;
}

export const notionalOf = (swap: Pick<Swap, 'quoteAmount'>): number => Math.abs(swap.quoteAmount);
