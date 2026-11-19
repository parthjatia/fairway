import type { ScoringConfig } from './config';
import type { Tier } from './types';

export type TierInput = { scoreBps: number; trades: number; historyDays: number };

/**
 * TOXIC   if score ≥ toxicScoreBps and trades ≥ toxicMinTrades
 * RETAIL  if score ≤ retailScoreBps and trades ≥ retailMinTrades and historyDays ≥ retailMinHistoryDays
 * STANDARD otherwise (and always for unknown wallets).
 */
export function assignTier(input: TierInput | undefined | null, cfg: ScoringConfig): Tier {
  if (!input || !Number.isFinite(input.scoreBps)) return 'STANDARD';
  const { scoreBps, trades, historyDays } = input;
  if (scoreBps >= cfg.toxicScoreBps && trades >= cfg.toxicMinTrades) return 'TOXIC';
  if (scoreBps <= cfg.retailScoreBps && trades >= cfg.retailMinTrades && historyDays >= cfg.retailMinHistoryDays) {
    return 'RETAIL';
  }
  return 'STANDARD';
}

/** Human-readable reason for a tier, used by the UI ("your tier and why"). */
export function explainTier(input: TierInput | undefined | null, cfg: ScoringConfig): string {
  const tier = assignTier(input, cfg);
  if (!input) return 'Unknown wallet: every new wallet starts at STANDARD, so rotating wallets never lowers the fee.';
  const s = input.scoreBps.toFixed(1);
  if (tier === 'TOXIC') {
    return `Markout ${s} bps ≥ ${cfg.toxicScoreBps} bps over ${input.trades} trades: the price consistently moves your way right after you trade (informed flow).`;
  }
  if (tier === 'RETAIL') {
    return `Markout ${s} bps ≤ ${cfg.retailScoreBps} bps over ${input.trades} trades and ${input.historyDays.toFixed(1)} days of history: uninformed flow, so LPs can safely charge you less.`;
  }
  const missing: string[] = [];
  if (input.trades < cfg.retailMinTrades) missing.push(`${cfg.retailMinTrades - input.trades} more trades`);
  if (input.historyDays < cfg.retailMinHistoryDays) missing.push(`${(cfg.retailMinHistoryDays - input.historyDays).toFixed(1)} more days of history`);
  if (input.scoreBps > cfg.retailScoreBps) missing.push(`markout ≤ ${cfg.retailScoreBps} bps (now ${s})`);
  return `Not enough evidence yet for RETAIL: needs ${missing.join(', ')}.`;
}
