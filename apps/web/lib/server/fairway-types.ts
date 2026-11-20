import type { TokenCheck } from '@fairway/scoring';

export type FwSwap = { sig: string; slot: number; ts: number | null; trader: string; side: 'buy' | 'sell'; tokens: number; quote: number; feeBps: number; tier: string };
export type FwToken = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  pool: string;
  quoteMint: string;
  quoteSymbol: string;
  quoteDecimals: number;
  reserveBase: number;
  reserveQuote: number;
  /** quote per token */
  price: number;
  liquidityQuote: number;
  createdTs: number | null;
  isLaunch: boolean;
  launch: { launchSlot: number; windowSlots: number; phase: 'not-started' | 'window' | 'after'; progressPct: number; launchTs: number | null } | null;
  swaps: number;
  check: TokenCheck;
};
export type FwData = { slot: number; updatedAt: number; tokens: FwToken[]; quotes: { mint: string; symbol: string; decimals: number }[] };

