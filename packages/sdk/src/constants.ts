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

/** Pyth Solana Receiver program (owner of PriceUpdateV2 accounts; same id on mainnet + devnet). */
export const PYTH_RECEIVER_PROGRAM_ID = 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ';
/** Pyth SOL/USD feed id (Hermes). */
export const PYTH_SOL_USD_FEED_ID = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
/**
 * Pyth-sponsored SOL/USD PriceUpdateV2 account (shard 0). TODO(human): verify on devnet before deploy — see docs/SETUP_REMAINING.md.
 */
export const PYTH_SOL_USD_PRICE_ACCOUNT_DEVNET = '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE';
/** Default MARKOUT_SLOTS (≈30 s at 400 ms slots). */
export const DEFAULT_MARKOUT_SLOTS = 75n;
