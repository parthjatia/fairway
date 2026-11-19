import { PublicKey } from '@solana/web3.js';

/** Program id (local + devnet use the same keypair; see Anchor.toml). Override with NEXT_PUBLIC_PROGRAM_ID / FAIRWAY_PROGRAM_ID. */
export const DEFAULT_PROGRAM_ID = '8jo3xry2rp9rQHwPCyh8c9Qwnw2HHa5JvAUiXHo2XPXk';

const envId = typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_PROGRAM_ID || process.env?.FAIRWAY_PROGRAM_ID : undefined;
export const PROGRAM_ID = new PublicKey(envId || DEFAULT_PROGRAM_ID);

export const SEEDS = {
  config: 'config',
  pool: 'pool',
  vault: 'vault',
  lpMint: 'lp_mint',
  score: 'score',
} as const;

export const TIER = { RETAIL: 0, STANDARD: 1, TOXIC: 2 } as const;
export type TierIndex = 0 | 1 | 2;
export const TIER_NAMES = ['RETAIL', 'STANDARD', 'TOXIC'] as const;
export type TierName = (typeof TIER_NAMES)[number];

export const BPS_DENOM = 10_000n;
export const MIN_LIQUIDITY = 1_000n;
export const MAX_FEE_BPS = 1_000;
export const MAX_BATCH = 10;
export const LP_DECIMALS = 6;
