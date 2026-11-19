import type { Tier } from '@fairway/scoring';

export type Persona = { key: 'rita' | 'new' | 'arb7' | 'sniper'; name: string; address: string; expectedTier: Tier; blurb: string };

export type WalletTrade = {
  sig: string;
  ts: number;
  pool: string;
  venue: string;
  side: 'buy' | 'sell';
  baseAmount: number;
  quoteAmount: number;
  execPrice: number;
  feeBps?: number;
  markouts: Record<string, number | null>;
};

/** What `settle_markout` has verified onchain for this wallet (M13). Big integers are serialized as numbers in UI units. */
export type OnchainScore = {
  tradeCount: number;
  /** settled notional, quote UI units (USDC) */
  notional: number;
  scoreBps: number;
  tier: Tier;
  historyDays: number;
  verified: boolean;
  /** notional needed before the onchain score overrides the keeper's bootstrap score */
  thresholdNotional: number;
  /** settled trades also required (min of the tier trade minimums) */
  minTrades: number;
  markoutSlots: number;
};

export type WalletView = {
  address: string;
  known: boolean;
  /** the tier a swap pays: onchain tier once verified, else the keeper's bootstrap tier */
  tier: Tier;
  scoreSource: 'onchain' | 'bootstrap' | 'default';
  /** keeper (offchain, cross-venue) tier */
  bootstrapTier: Tier;
  onchain: OnchainScore;
  explanation: string;
  label: string | null;
  agentClass: string | null;
  score: null | {
    scoreBps: number;
    maxScoreBps: number;
    trades: number;
    totalNotional: number;
    firstSeen: number;
    lastSeen: number;
    historyDays: number;
    byHorizon: Record<string, { horizonSec: number; scoreBps: number; rawBps: number; scoredTrades: number; scoredNotional: number }>;
  };
  trades: WalletTrade[];
  timeline: Array<{ ts: number; tier: Tier; scoreBps: number; maxScoreBps: number; trades: number }>;
  config: { horizons: number[]; primaryHorizon: number; priorNotional: number; toxicScoreBps: number; retailScoreBps: number; minTrades: number; retailMinHistoryDays: number };
  source: 'ingest' | 'in-process';
};

export type PoolView = {
  id: string;
  label: string;
  baseVault: string;
  quoteVault: string;
  reserves: { base: number; quote: number };
  price: number;
  tvlUsd: number;
  trades: number;
  uniqueTraders: number;
  volumeByTier: Record<Tier, number>;
  feesByTier: Record<Tier, number>;
  tradesByTier: Record<Tier, number>;
  daily: Array<{ day: string; RETAIL: number; STANDARD: number; TOXIC: number }>;
  recent: Array<{ sig: string; ts: number; trader: string; side: 'buy' | 'sell'; quoteAmount: number; execPrice: number; feeBps?: number; tier?: Tier; label?: string | null }>;
  source: 'ingest' | 'in-process';
};
