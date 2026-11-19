/** Toxicity tiers. The numeric index matches the onchain `fee_bps: [u16; 3]` order. */
export type Tier = 'RETAIL' | 'STANDARD' | 'TOXIC';
export const TIERS: readonly Tier[] = ['RETAIL', 'STANDARD', 'TOXIC'] as const;
export const TIER_INDEX: Record<Tier, 0 | 1 | 2> = { RETAIL: 0, STANDARD: 1, TOXIC: 2 };
export const tierFromIndex = (i: number): Tier => TIERS[i] ?? 'STANDARD';

export type Venue = 'fairway' | 'raydium' | 'orca' | 'meteora' | 'fixture';

/** Canonical swap record shared by every package. */
export type Swap = {
  sig: string;
  slot: number;
  /** unix seconds */
  ts: number;
  pool: string;
  venue: Venue;
  /** fee payer / signer */
  trader: string;
  /** buy = trader receives BASE (e.g. SOL) */
  side: 'buy' | 'sell';
  /** UI units, positive */
  baseAmount: number;
  quoteAmount: number;
  /** quote per base, PRE-fee */
  execPrice: number;
  feeBps?: number;
  tier?: Tier;
};

export type HorizonScore = {
  horizonSec: number;
  /** shrunk notional-weighted markout, bps */
  scoreBps: number;
  /** raw (unshrunk) notional-weighted markout, bps */
  rawBps: number;
  /** trades with an available mid at t+h */
  scoredTrades: number;
  scoredNotional: number;
};

export type WalletScore = {
  trader: string;
  tier: Tier;
  /** primary-horizon shrunk score, bps */
  scoreBps: number;
  trades: number;
  totalNotional: number;
  firstSeen: number;
  lastSeen: number;
  historyDays: number;
  byHorizon: Record<number, HorizonScore>;
};
