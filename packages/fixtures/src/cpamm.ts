/**
 * Float constant-product helpers used by the fixture generator and simulator.
 * Fee is charged on the input and kept OUTSIDE the reserves (tracked as LP fee revenue),
 * so reserves follow x·y = k exactly on the after-fee input.
 */
export type Reserves = { base: number; quote: number };

export const poolPrice = (r: Reserves): number => r.quote / r.base;

/** out = in_after_fee * R_out / (R_in + in_after_fee) */
export const cpOut = (inAfterFee: number, rIn: number, rOut: number): number => (inAfterFee * rOut) / (rIn + inAfterFee);

/**
 * Optimal arbitrage against an external price `cex` for a trader paying `feeBps`.
 * Returns the after-fee input needed to move the pool to the no-arb boundary, or null if none.
 *  - pool cheap (p < cex(1−f)): buy base with quote until p' = cex(1−f)
 *  - pool rich  (p > cex/(1−f)): sell base until p' = cex/(1−f)
 */
export function arbTrade(r: Reserves, cex: number, feeBps: number): { side: 'buy' | 'sell'; inAfterFee: number } | null {
  const f = feeBps / 10_000;
  const p = poolPrice(r);
  const k = r.base * r.quote;
  if (p < cex * (1 - f)) {
    const target = cex * (1 - f);
    const quoteAfter = Math.sqrt(k * target);
    return { side: 'buy', inAfterFee: quoteAfter - r.quote };
  }
  if (p > cex / (1 - f)) {
    const target = cex / (1 - f);
    const baseAfter = Math.sqrt(k / target);
    return { side: 'sell', inAfterFee: baseAfter - r.base };
  }
  return null;
}
