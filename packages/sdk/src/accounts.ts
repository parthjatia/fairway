import { PublicKey } from '@solana/web3.js';
import { bytesEqual, discriminator, Reader, type Writer } from './borsh';
import { TIER_NAMES, type TierName } from './constants';

export type ConfigAccount = {
  admin: PublicKey;
  scoreAuthority: PublicKey;
  feeBps: [number, number, number];
  defaultTier: number;
  scoreTtlSlots: bigint;
  bump: number;
  markout: MarkoutParams;
  /** share of every swap fee kept by the protocol, bps of the fee (1500 = 15%) */
  protocolFeeBps: number;
};

/** Onchain markout scoring parameters (programs/fairway/src/state.rs `MarkoutParams`). */
export type MarkoutParams = {
  markoutSlots: bigint;
  maxSettleSlots: bigint;
  priorNotional: bigint;
  onchainMinNotional: bigint;
  toxicBps: number;
  toxicMinTrades: number;
  retailBps: number;
  retailMinTrades: number;
  retailMinHistorySlots: bigint;
  pythMaxStalenessSecs: bigint;
  pythMaxConfBps: number;
};

/** Program defaults (`MarkoutParams::default()`). The oracle lives on each pool (`Pool.oracle*`, `setPoolOracleIx`). */
export const defaultMarkoutParams = (o: Partial<MarkoutParams> = {}): MarkoutParams => ({
  markoutSlots: 75n,
  maxSettleSlots: 450n,
  priorNotional: 2_000_000_000n,
  onchainMinNotional: 1_000_000_000n,
  toxicBps: 10,
  toxicMinTrades: 5,
  retailBps: 3,
  retailMinTrades: 5,
  retailMinHistorySlots: 648_000n,
  pythMaxStalenessSecs: 60n,
  pythMaxConfBps: 50,
  ...o,
});

export const readMarkoutParams = (r: Reader): MarkoutParams => ({
  markoutSlots: r.u64(),
  maxSettleSlots: r.u64(),
  priorNotional: r.u64(),
  onchainMinNotional: r.u64(),
  toxicBps: r.i32(),
  toxicMinTrades: r.u32(),
  retailBps: r.i32(),
  retailMinTrades: r.u32(),
  retailMinHistorySlots: r.u64(),
  pythMaxStalenessSecs: r.u64(),
  pythMaxConfBps: r.u16(),
});

export const writeMarkoutParams = (w: Writer, m: MarkoutParams): Writer =>
  w
    .u64(m.markoutSlots)
    .u64(m.maxSettleSlots)
    .u64(m.priorNotional)
    .u64(m.onchainMinNotional)
    .i32(m.toxicBps)
    .u32(m.toxicMinTrades)
    .i32(m.retailBps)
    .u32(m.retailMinTrades)
    .u64(m.retailMinHistorySlots)
    .u64(m.pythMaxStalenessSecs)
    .u16(m.pythMaxConfBps);

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
  /** protocol fees accrued in the vaults, not yet claimed (excluded from LP reserves) */
  protocolOwedBase: bigint;
  protocolOwedQuote: bigint;
  /** cumulative protocol fees */
  protocolEarnedBase: bigint;
  protocolEarnedQuote: bigint;
  /** score accounts whose rent the treasury paid, and the lamports spent */
  sponsoredAccounts: number;
  sponsoredLamports: bigint;
  /** this pool's Pyth price account (default pubkey = no oracle: swaps are not scored onchain) and the feed id it must carry */
  oracleCfg: { priceAccount: PublicKey; feedId: Uint8Array };
};

export type PendingTrade = { pool: PublicKey; /** 1e12 fixed point */ execPrice: bigint; slot: bigint; side: 'buy' | 'sell'; notional: bigint };

export type TraderScoreAccount = {
  trader: PublicKey;
  /** keeper bootstrap tier */
  tier: number;
  tierName: TierName;
  scoreBps: number;
  trades: number;
  updatedSlot: bigint;
  bump: number;
  // onchain verified (M13)
  sumNotional: bigint;
  sumWeightedMarkout: bigint;
  tradeCount: number;
  firstSlot: bigint;
  onchainTier: number;
  onchainTierName: TierName;
  onchainScoreBps: number;
  droppedTrades: number;
  /** non-empty pending trades awaiting settle_markout */
  pending: PendingTrade[];
  /** the protocol treasury paid this account's rent */
  sponsored: boolean;
};

export const PENDING_CAP = 4;

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
    markout: readMarkoutParams(r),
    protocolFeeBps: r.u16(),
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
    protocolOwedBase: r.u64(),
    protocolOwedQuote: r.u64(),
    protocolEarnedBase: r.u64(),
    protocolEarnedQuote: r.u64(),
    sponsoredAccounts: r.u32(),
    sponsoredLamports: r.u64(),
    oracleCfg: { priceAccount: r.pubkey(), feedId: r.fixed(32) },
  };
}

export function decodeTraderScore(data: Uint8Array): TraderScoreAccount {
  const r = check(data, 'TraderScore');
  const trader = r.pubkey();
  const tier = r.u8();
  const head = { trader, tier, tierName: TIER_NAMES[tier] ?? 'STANDARD', scoreBps: r.i32(), trades: r.u32(), updatedSlot: r.u64(), bump: r.u8() };
  const sumNotional = r.u64();
  const sumWeightedMarkout = r.i128();
  const tradeCount = r.u32();
  const firstSlot = r.u64();
  const onchainTier = r.u8();
  const onchainScoreBps = r.i32();
  const droppedTrades = r.u32();
  const pending: PendingTrade[] = [];
  for (let i = 0; i < PENDING_CAP; i++) {
    const p = { pool: r.pubkey(), execPrice: r.u64(), slot: r.u64(), side: r.u8() === 0 ? ('buy' as const) : ('sell' as const), notional: r.u64() };
    if (p.notional !== 0n) pending.push(p);
  }
  const sponsored = r.bool();
  return {
    ...head,
    sumNotional,
    sumWeightedMarkout,
    tradeCount,
    firstSlot,
    onchainTier,
    onchainTierName: TIER_NAMES[onchainTier] ?? 'STANDARD',
    onchainScoreBps,
    droppedTrades,
    pending,
    sponsored,
  };
}
