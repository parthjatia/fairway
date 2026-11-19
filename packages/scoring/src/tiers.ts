import type { ScoringConfig } from './config';
import type { Tier } from './types';

export type TierInput = {
  /** primary-horizon score */
  scoreBps: number;
  trades: number;
  historyDays: number;
  /** optional: highest score across all horizons (for the 'all-horizons' rule) */
  maxScoreBps?: number;
};

/**
 * TOXIC   if score ≥ toxicScoreBps and trades ≥ toxicMinTrades
 * RETAIL  if score ≤ retailScoreBps and trades ≥ retailMinTrades and historyDays ≥ retailMinHistoryDays
 * STANDARD otherwise (and always for unknown wallets).
 */
export function assignTier(input: TierInput | undefined | null, cfg: ScoringConfig): Tier {
  if (!input || !Number.isFinite(input.scoreBps)) return 'STANDARD';
  const { trades, historyDays } = input;
  const allH = cfg.tierRule === 'all-horizons';
  const hi = allH && Number.isFinite(input.maxScoreBps) ? Math.max(input.scoreBps, input.maxScoreBps!) : input.scoreBps;
  if (hi >= cfg.toxicScoreBps && trades >= cfg.toxicMinTrades) return 'TOXIC';
  // RETAIL requires every horizon ≤ threshold, i.e. the max
  if (hi <= cfg.retailScoreBps && trades >= cfg.retailMinTrades && historyDays >= cfg.retailMinHistoryDays) {
    return 'RETAIL';
  }
  return 'STANDARD';
}

/** Human-readable reason for a tier, used by the UI ("your tier and why"). */
export function explainTier(input: TierInput | undefined | null, cfg: ScoringConfig): string {
  const tier = assignTier(input, cfg);
  if (!input) return 'Unknown wallet: every new wallet starts at STANDARD, so rotating wallets never lowers the fee.';
  const s = input.scoreBps.toFixed(1);
  const hi = input.maxScoreBps !== undefined && cfg.tierRule === 'all-horizons' ? Math.max(input.scoreBps, input.maxScoreBps) : input.scoreBps;
  if (tier === 'TOXIC') {
    return `Markout ${hi.toFixed(1)} bps ≥ ${cfg.toxicScoreBps} bps over ${input.trades} trades: the price consistently moves your way right after you trade (informed flow).`;
  }
  if (tier === 'RETAIL') {
    return `Markout ${s} bps ≤ ${cfg.retailScoreBps} bps over ${input.trades} trades and ${input.historyDays.toFixed(1)} days of history: uninformed flow, so LPs can safely charge you less.`;
  }
  const missing: string[] = [];
  if (input.trades < cfg.retailMinTrades) missing.push(`${cfg.retailMinTrades - input.trades} more trades`);
  if (input.historyDays < cfg.retailMinHistoryDays) missing.push(`${(cfg.retailMinHistoryDays - input.historyDays).toFixed(1)} more days of history`);
  if (hi > cfg.retailScoreBps) missing.push(`markout ≤ ${cfg.retailScoreBps} bps at every horizon (now ${hi.toFixed(1)})`);
  return `Not enough evidence yet for RETAIL: needs ${missing.join(', ')}.`;
}
