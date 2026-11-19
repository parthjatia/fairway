import type { PublicKey } from '@solana/web3.js';
import { bytesEqual, discriminator, Reader } from './borsh';
import { TIER_NAMES, type TierName } from './constants';

export type ConfigAccount = {
  admin: PublicKey;
  scoreAuthority: PublicKey;
  feeBps: [number, number, number];
  defaultTier: number;
  scoreTtlSlots: bigint;
  bump: number;
};

export type PoolAccount = {
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  lpMint: PublicKey;
  lpSupply: bigint;
  feesBase: [bigint, bigint, bigint];
  feesQuote: [bigint, bigint, bigint];
  swaps: [bigint, bigint, bigint];
  bump: number;
  baseVaultBump: number;
  quoteVaultBump: number;
  lpMintBump: number;
};

export type TraderScoreAccount = {
  trader: PublicKey;
  tier: number;
  tierName: TierName;
  scoreBps: number;
  trades: number;
  updatedSlot: bigint;
  bump: number;
};

export class AccountDecodeError extends Error {}

const check = (data: Uint8Array, name: string) => {
  if (data.length < 8 || !bytesEqual(data.slice(0, 8), discriminator('account', name))) throw new AccountDecodeError(`not a ${name} account`);
  return new Reader(data).skip(8);
};

export function decodeConfig(data: Uint8Array): ConfigAccount {
  const r = check(data, 'Config');
  return {
    admin: r.pubkey(),
    scoreAuthority: r.pubkey(),
    feeBps: [r.u16(), r.u16(), r.u16()],
    defaultTier: r.u8(),
    scoreTtlSlots: r.u64(),
    bump: r.u8(),
  };
}

export function decodePool(data: Uint8Array): PoolAccount {
  const r = check(data, 'Pool');
  const t3 = (): [bigint, bigint, bigint] => [r.u64(), r.u64(), r.u64()];
  return {
    baseMint: r.pubkey(),
    quoteMint: r.pubkey(),
    baseVault: r.pubkey(),
    quoteVault: r.pubkey(),
    lpMint: r.pubkey(),
    lpSupply: r.u64(),
    feesBase: t3(),
    feesQuote: t3(),
    swaps: t3(),
    bump: r.u8(),
    baseVaultBump: r.u8(),
    quoteVaultBump: r.u8(),
    lpMintBump: r.u8(),
  };
}

export function decodeTraderScore(data: Uint8Array): TraderScoreAccount {
  const r = check(data, 'TraderScore');
  const trader = r.pubkey();
  const tier = r.u8();
  return { trader, tier, tierName: TIER_NAMES[tier] ?? 'STANDARD', scoreBps: r.i32(), trades: r.u32(), updatedSlot: r.u64(), bump: r.u8() };
}
