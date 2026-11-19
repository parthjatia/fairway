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
  /** share of the TOXIC PREMIUM (toxic fee above the STANDARD fee) kept by the protocol, bps (1500 = 15%); LPs keep every other fee */
  protocolFeeBps: number;
  rebate: RebateParams;
  /** launch defaults (M16) */
  launch: LaunchConfig;
};

/** Per-tier launch fee curve [RETAIL, STANDARD, TOXIC] (state.rs `LaunchCurveParams`). */
export type LaunchCurve = { startBps: [number, number, number]; endBps: [number, number, number] };
/** Program defaults: TOXIC 1000→80, STANDARD (fresh wallets) 300→30, RETAIL 30→5. */
export const DEFAULT_LAUNCH_CURVE: LaunchCurve = { startBps: [30, 300, 1_000], endBps: [5, 30, 80] };
export const DEFAULT_LAUNCH_WINDOW_SLOTS = 750n;
export const DEFAULT_TWAP_WINDOW_SLOTS = 25n;
export const DEFAULT_LAUNCH_FEE_LAMPORTS = 50_000_000n;
/** Default creator share of the TOXIC premium on launch pools (bps of the premium; 5000 = 50%). */
export const DEFAULT_CREATOR_PREMIUM_SHARE_BPS = 5_000;
export type LaunchConfig = { curve: LaunchCurve; defaultWindowSlots: bigint; twapWindowSlots: bigint; launchFeeLamports: bigint; creatorPremiumShareBps: number };
export const defaultLaunchConfig = (o: Partial<LaunchConfig> = {}): LaunchConfig => ({
  curve: DEFAULT_LAUNCH_CURVE,
  defaultWindowSlots: DEFAULT_LAUNCH_WINDOW_SLOTS,
  twapWindowSlots: DEFAULT_TWAP_WINDOW_SLOTS,
  launchFeeLamports: DEFAULT_LAUNCH_FEE_LAMPORTS,
  creatorPremiumShareBps: DEFAULT_CREATOR_PREMIUM_SHARE_BPS,
  ...o,
});
const t3n = (r: Reader): [number, number, number] => [r.u16(), r.u16(), r.u16()];
export const readLaunchCurve = (r: Reader): LaunchCurve => ({ startBps: t3n(r), endBps: t3n(r) });
export const writeLaunchCurve = (w: Writer, c: LaunchCurve): Writer => {
  c.startBps.forEach((f) => w.u16(f));
  c.endBps.forEach((f) => w.u16(f));
  return w;
};
export const readLaunchConfig = (r: Reader): LaunchConfig => ({ curve: readLaunchCurve(r), defaultWindowSlots: r.u64(), twapWindowSlots: r.u64(), launchFeeLamports: r.u64(), creatorPremiumShareBps: r.u16() });
export const writeLaunchConfig = (w: Writer, l: LaunchConfig): Writer =>
  writeLaunchCurve(w, l.curve).u64(l.defaultWindowSlots).u64(l.twapWindowSlots).u64(l.launchFeeLamports).u16(l.creatorPremiumShareBps);

/** TWAP ring buffer size (fairway_math::twap::OBS_CAP). */
export const OBS_CAP = 64;
export type PoolTwap = { lastSlot: bigint; lastPrice: bigint; cum: bigint; head: number; count: number; obsSlot: bigint[]; obsCum: bigint[] };
export type PoolLaunch = { launchSlot: bigint; windowSlots: bigint; curve: LaunchCurve; twapScoring: boolean };

/** Bot-tax rebate parameters (programs/fairway/src/state.rs `RebateParams`). */
export type RebateParams = { epochSlots: bigint; shareBps: number; floorBps: number };
export const defaultRebateParams = (o: Partial<RebateParams> = {}): RebateParams => ({ epochSlots: 9_000n, shareBps: 1_000, floorBps: 5, ...o });
export const readRebateParams = (r: Reader): RebateParams => ({ epochSlots: r.u64(), shareBps: r.u16(), floorBps: r.u16() });
export const writeRebateParams = (w: Writer, p: RebateParams): Writer => w.u64(p.epochSlots).u16(p.shareBps).u16(p.floorBps);

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
  /** bot-tax rebate bookkeeping, quote-token equivalents */
  rebate: {
    epochStartSlot: bigint;
    /** toxic premium collected this epoch */
    epochPremiumQ: bigint;
    /** RETAIL-tier volume this epoch */
    epochRetailVolQ: bigint;
    /** bps currently taken off the RETAIL fee */
    rebateBps: number;
    /** what is left of the last epoch's rebate budget */
    budgetQ: bigint;
    volumeQ: [bigint, bigint, bigint];
    premiumTotalQ: bigint;
    rebateTotalQ: bigint;
  };
  /** M16: pool creator (may configure the launch), launch params (windowSlots 0 = not a launch), price accumulator */
  creator: PublicKey;
  launch: PoolLaunch;
  twap: PoolTwap;
  /** M16 step 10: creator share of the TOXIC premium (bps; 0 on non-launch pools), accrued in the vaults (excluded from LP reserves) */
  creatorFees: { shareBps: number; owedBase: bigint; owedQuote: bigint; earnedBase: bigint; earnedQuote: bigint };
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
    rebate: readRebateParams(r),
    launch: readLaunchConfig(r),
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
    rebate: {
      epochStartSlot: r.u64(),
      epochPremiumQ: r.u64(),
      epochRetailVolQ: r.u64(),
      rebateBps: r.u16(),
      budgetQ: r.u64(),
      volumeQ: t3(),
      premiumTotalQ: r.u64(),
      rebateTotalQ: r.u64(),
    },
    creator: r.pubkey(),
    launch: { launchSlot: r.u64(), windowSlots: r.u64(), curve: readLaunchCurve(r), twapScoring: r.bool() },
    twap: (() => {
      const h = { lastSlot: r.u64(), lastPrice: r.u64(), cum: r.u128(), head: r.u16(), count: r.u16() };
      const obsSlot = Array.from({ length: OBS_CAP }, () => r.u64());
      const obsCum = Array.from({ length: OBS_CAP }, () => r.u128());
      return { ...h, obsSlot, obsCum };
    })(),
    creatorFees: { shareBps: r.u16(), owedBase: r.u64(), owedQuote: r.u64(), earnedBase: r.u64(), earnedQuote: r.u64() },
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
