import type { Swap, Tier, WalletScore } from '@fairway/scoring';
import type { FeeSchedule } from './config';

/**
 * Historical replay (STATIC counterfactual): re-price each recorded swap under different fee
 * schedules, holding every trade fixed. Behaviour changes (arbs trading less at higher fees,
 * retail trading more at lower fees, pool staleness) are NOT modelled here — that is what the
 * agent-based simulator is for.
 */
export type ReplaySchedule = { name: string; fees: FeeSchedule | number };

export type ReplayRow = {
  name: string;
  lpFeesUsd: number;
  feesByTier: Record<Tier, number>;
  volumeByTier: Record<Tier, number>;
  tradesByTier: Record<Tier, number>;
  /** notional-weighted average fee paid, by tier */
  avgFeeBpsByTier: Record<Tier, number>;
};

export type ReplayOutput = {
  synthetic: boolean;
  note: string;
  swaps: number;
  rows: ReplayRow[];
  retailSavingsUsd: number;
  toxicExtraFeesUsd: number;
};

export function replay(swaps: ReadonlyArray<Swap>, scores: ReadonlyArray<WalletScore>, schedules: ReplaySchedule[], synthetic = true): ReplayOutput {
  const tierOf = new Map(scores.map((s) => [s.trader, s.tier]));
  const rows = schedules.map((sch) => {
    const zero = () => ({ RETAIL: 0, STANDARD: 0, TOXIC: 0 }) as Record<Tier, number>;
    const row: ReplayRow = { name: sch.name, lpFeesUsd: 0, feesByTier: zero(), volumeByTier: zero(), tradesByTier: zero(), avgFeeBpsByTier: zero() };
    for (const s of swaps) {
      const tier = tierOf.get(s.trader) ?? 'STANDARD';
      const fee = typeof sch.fees === 'number' ? sch.fees : sch.fees[tier];
      const usd = s.quoteAmount * (fee / 10_000);
      row.lpFeesUsd += usd;
      row.feesByTier[tier] += usd;
      row.volumeByTier[tier] += s.quoteAmount;
      row.tradesByTier[tier] += 1;
    }
    for (const t of ['RETAIL', 'STANDARD', 'TOXIC'] as Tier[]) row.avgFeeBpsByTier[t] = row.volumeByTier[t] > 0 ? (row.feesByTier[t] / row.volumeByTier[t]) * 10_000 : 0;
    return row;
  });
  const flat = rows[0]!;
  const tiered = rows[1] ?? flat;
  return {
    synthetic,
    note: 'Static counterfactual: every recorded trade is held fixed and only re-priced. Behavioural responses are not modelled (see the agent-based simulation).',
    swaps: swaps.length,
    rows,
    retailSavingsUsd: flat.feesByTier.RETAIL - tiered.feesByTier.RETAIL,
    toxicExtraFeesUsd: tiered.feesByTier.TOXIC - flat.feesByTier.TOXIC,
  };
}
