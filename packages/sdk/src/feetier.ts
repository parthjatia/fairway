/**
 * Composable fee-tier read: "what tier would this wallet pay on Fairway right now?"
 *
 * Any Solana DEX, aggregator or wallet can call `getFeeTier(connection, wallet)` (one `getMultipleAccounts`-style
 * read of two PDAs) to price flow by a wallet's measured toxicity, or run `feeTierFromAccounts` on accounts it has
 * already fetched. It mirrors the program's `resolve_blended` exactly (see README: "Any Solana DEX can read Fairway scores").
 */
import { Connection, PublicKey, type Commitment } from '@solana/web3.js';
import { decodeConfig, decodeTraderScore, PENDING_CAP, type ConfigAccount, type PoolAccount, type TraderScoreAccount } from './accounts';
import { PROGRAM_ID, TIER_NAMES, type TierName } from './constants';
import { launchPhase, decayedFeeBps, resolveBlendedTier, swapRebateBps, type TierSource } from './math';
import { configPda, scorePda } from './pda';

export type FeeTier = {
  wallet: PublicKey;
  /** 0 RETAIL, 1 STANDARD, 2 TOXIC */
  tier: 0 | 1 | 2;
  tierName: TierName;
  /** the swap fee (bps) this wallet pays on Fairway with the current Config */
  feeBps: number;
  /** bps of bot-tax rebate included in `feeBps` (RETAIL tier only; a swap may get less once the epoch budget runs low) */
  rebateBps: number;
  /** why: 'onchain' = verified by the program from the wallet's own Fairway trades; 'score' = keeper bootstrap; else a STANDARD fallback */
  source: TierSource;
  /** true when the tier comes from the trustless onchain score (settle_markout), not from the keeper */
  verified: boolean;
  /** onchain markout score (bps, shrunk) and the evidence behind it; null if the wallet has no score account */
  onchain: { scoreBps: number; settledTrades: number; settledNotional: bigint } | null;
  /** keeper bootstrap score (bps); null if none */
  bootstrapScoreBps: number | null;
  /** the wallet has no score account: it pays the STANDARD default, like every new wallet */
  isNew: boolean;
  /** set when `pool` is inside its launch window: `feeBps` is the decayed launch fee for this tier */
  launch: { elapsedSlots: bigint; windowSlots: bigint } | null;
};

/** Pure: same result as the program for these two accounts at `currentSlot`. */
export function feeTierFromAccounts(wallet: PublicKey, config: ConfigAccount, score: TraderScoreAccount | null, currentSlot: bigint, pool?: PoolAccount | null, notionalQ?: bigint): FeeTier {
  const m = config.markout;
  const r = resolveBlendedTier(
    {
      onchain: score ? { tier: score.onchainTier, sumNotional: score.sumNotional, trades: score.tradeCount } : null,
      onchainMinNotional: m.onchainMinNotional,
      minTrades: Math.min(m.toxicMinTrades, m.retailMinTrades),
      bootstrap: score ? { tier: score.tier, updatedSlot: score.updatedSlot } : null,
      // a wallet with a full pending buffer cannot be scored for its next trade: no RETAIL discount
      pendingFull: !!score && score.pending.length >= PENDING_CAP,
    },
    currentSlot,
    config.scoreTtlSlots,
    config.defaultTier,
  );
  const tier = r.tier as 0 | 1 | 2;
  // launch window (M16): fee = f(tier, slots since launch), no rebate
  const launch = pool?.launch; // optional: callers may pass a partial pool (rebate fields only)
  const ph = launch ? launchPhase(currentSlot, launch.launchSlot, launch.windowSlots) : ({ kind: 'after' } as const);
  const inWindow = ph.kind === 'window' && !!launch;
  const baseFee = ph.kind === 'window' && launch ? decayedFeeBps(launch.curve, tier, ph.elapsed, launch.windowSlots) : config.feeBps[tier];
  // bot-tax rebate: RETAIL tier only. Without a notional the epoch rate is shown (an upper bound for this swap).
  const rebateBps =
    tier === 0 && pool && !inWindow ? swapRebateBps(pool.rebate.rebateBps, pool.rebate.budgetQ, notionalQ ?? pool.rebate.budgetQ * 10_000n, baseFee, config.rebate.floorBps) : 0;
  return {
    wallet,
    tier,
    tierName: TIER_NAMES[tier],
    feeBps: baseFee - rebateBps,
    rebateBps,
    source: r.source,
    verified: r.source === 'onchain',
    onchain: score ? { scoreBps: score.onchainScoreBps, settledTrades: score.tradeCount, settledNotional: score.sumNotional } : null,
    bootstrapScoreBps: score ? score.scoreBps : null,
    isNew: !score,
    launch: ph.kind === 'window' && launch ? { elapsedSlots: ph.elapsed, windowSlots: launch.windowSlots } : null,
  };
}

/** Read Config + the wallet's TraderScore PDA and resolve the tier. Throws if Fairway's Config does not exist on this cluster. */
export async function getFeeTier(
  connection: Connection,
  wallet: PublicKey,
  opts: { programId?: PublicKey; commitment?: Commitment } = {},
): Promise<FeeTier> {
  const programId = opts.programId ?? PROGRAM_ID;
  const [cfgInfo, scoreInfo, slot] = await Promise.all([
    connection.getAccountInfo(configPda(programId)[0], opts.commitment),
    connection.getAccountInfo(scorePda(wallet, programId)[0], opts.commitment),
    connection.getSlot(opts.commitment),
  ]);
  if (!cfgInfo) throw new Error(`Fairway config not found for program ${programId.toBase58()}`);
  let score: TraderScoreAccount | null = null;
  if (scoreInfo && scoreInfo.owner.equals(programId)) {
    try {
      score = decodeTraderScore(scoreInfo.data);
    } catch {
      score = null; // malformed → treated like a missing score (STANDARD), as in the program
    }
  }
  return feeTierFromAccounts(wallet, decodeConfig(cfgInfo.data), score, BigInt(slot));
}
