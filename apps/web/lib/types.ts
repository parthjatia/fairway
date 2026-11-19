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

export type WalletView = {
  address: string;
  known: boolean;
  tier: Tier;
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
