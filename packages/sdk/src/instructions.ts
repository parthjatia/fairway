import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { discriminator, Writer } from './borsh';
import { MAX_BATCH, PROGRAM_ID, type TierIndex } from './constants';
import { configPda, poolAddresses, scorePda, treasuryPda } from './pda';
import { writeMarkoutParams, writeRebateParams, type MarkoutParams, type RebateParams } from './accounts';

const w = (k: PublicKey, isWritable = false, isSigner = false): AccountMeta => ({ pubkey: k, isWritable, isSigner });
const ix = (programId: PublicKey, keys: AccountMeta[], name: string, args: (w: Writer) => void = () => {}) => {
  const wr = new Writer().bytes(discriminator('global', name));
  args(wr);
  return new TransactionInstruction({ programId, keys, data: Buffer.from(wr.toBytes()) });
};

export function initializeConfigIx(p: { admin: PublicKey; scoreAuthority: PublicKey; feeBps: [number, number, number]; scoreTtlSlots: bigint | number; programId?: PublicKey }) {
  const programId = p.programId ?? PROGRAM_ID;
  return ix(programId, [w(p.admin, true, true), w(configPda(programId)[0], true), w(SystemProgram.programId)], 'initialize_config', (wr) => {
    wr.pubkey(p.scoreAuthority);
    p.feeBps.forEach((f) => wr.u16(f));
    wr.u64(p.scoreTtlSlots);
  });
}

export type ConfigUpdate = {
  newAdmin?: PublicKey;
  scoreAuthority?: PublicKey;
  feeBps?: [number, number, number];
  defaultTier?: TierIndex;
  scoreTtlSlots?: bigint | number;
  markout?: MarkoutParams;
  protocolFeeBps?: number;
  rebate?: RebateParams;
};

export function updateConfigIx(p: { admin: PublicKey; update: ConfigUpdate; programId?: PublicKey }) {
  const programId = p.programId ?? PROGRAM_ID;
  const u = p.update;
  return ix(programId, [w(p.admin, false, true), w(configPda(programId)[0], true)], 'update_config', (wr) => {
    wr.option(u.newAdmin, (x, v) => x.pubkey(v));
    wr.option(u.scoreAuthority, (x, v) => x.pubkey(v));
    wr.option(u.feeBps, (x, v) => v.forEach((f) => x.u16(f)));
    wr.option(u.defaultTier, (x, v) => x.u8(v));
    wr.option(u.scoreTtlSlots, (x, v) => x.u64(v));
    wr.option(u.markout, (x, v) => writeMarkoutParams(x, v));
    wr.option(u.protocolFeeBps, (x, v) => x.u16(v));
    wr.option(u.rebate, (x, v) => writeRebateParams(x, v));
  });
}

export function createPoolIx(p: { payer: PublicKey; baseMint: PublicKey; quoteMint: PublicKey; programId?: PublicKey }) {
  const programId = p.programId ?? PROGRAM_ID;
  const a = poolAddresses(p.baseMint, p.quoteMint, programId);
  return ix(
    programId,
    [
      w(p.payer, true, true),
      w(p.baseMint),
      w(p.quoteMint),
      w(a.pool, true),
      w(a.baseVault, true),
      w(a.quoteVault, true),
      w(a.lpMint, true),
      w(TOKEN_PROGRAM_ID),
      w(SystemProgram.programId),
    ],
    'create_pool',
  );
}

type LiquidityAccounts = {
  owner: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  /** defaults to the owner's ATAs */
  ownerBase?: PublicKey;
  ownerQuote?: PublicKey;
  ownerLp?: PublicKey;
  programId?: PublicKey;
};

function liquidityKeys(p: LiquidityAccounts) {
  const programId = p.programId ?? PROGRAM_ID;
  const a = poolAddresses(p.baseMint, p.quoteMint, programId);
  return {
    programId,
    keys: [
      w(p.owner, false, true),
      w(a.pool, true),
      w(p.baseMint),
      w(p.quoteMint),
      w(a.baseVault, true),
      w(a.quoteVault, true),
      w(a.lpMint, true),
      w(p.ownerBase ?? getAssociatedTokenAddressSync(p.baseMint, p.owner), true),
      w(p.ownerQuote ?? getAssociatedTokenAddressSync(p.quoteMint, p.owner), true),
      w(p.ownerLp ?? getAssociatedTokenAddressSync(a.lpMint, p.owner), true),
      w(TOKEN_PROGRAM_ID),
    ],
  };
}

export function addLiquidityIx(p: LiquidityAccounts & { maxBase: bigint; maxQuote: bigint; minLp: bigint }) {
  const { programId, keys } = liquidityKeys(p);
  return ix(programId, keys, 'add_liquidity', (wr) => wr.u64(p.maxBase).u64(p.maxQuote).u64(p.minLp));
}

export function removeLiquidityIx(p: LiquidityAccounts & { lpAmount: bigint; minBase: bigint; minQuote: bigint }) {
  const { programId, keys } = liquidityKeys(p);
  return ix(programId, keys, 'remove_liquidity', (wr) => wr.u64(p.lpAmount).u64(p.minBase).u64(p.minQuote));
}

export type SwapParams = {
  trader: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  amountIn: bigint;
  minAmountOut: bigint;
  /** true = sell base for quote */
  aToB: boolean;
  traderBase?: PublicKey;
  traderQuote?: PublicKey;
  /** ONLY for tests: override the score account (the program rejects anything but the signer's PDA) */
  scoreAccountOverride?: PublicKey;
  programId?: PublicKey;
};

export function swapIx(p: SwapParams) {
  const programId = p.programId ?? PROGRAM_ID;
  const a = poolAddresses(p.baseMint, p.quoteMint, programId);
  return ix(
    programId,
    [
      w(p.trader, true, true),
      w(configPda(programId)[0]),
      w(a.pool, true),
      w(p.scoreAccountOverride ?? scorePda(p.trader, programId)[0], true),
      w(p.baseMint),
      w(p.quoteMint),
      w(a.baseVault, true),
      w(a.quoteVault, true),
      w(p.traderBase ?? getAssociatedTokenAddressSync(p.baseMint, p.trader), true),
      w(p.traderQuote ?? getAssociatedTokenAddressSync(p.quoteMint, p.trader), true),
      w(TOKEN_PROGRAM_ID),
      w(SystemProgram.programId),
      w(treasuryPda(programId)[0], true),
    ],
    'swap',
    (wr) => wr.u64(p.amountIn).u64(p.minAmountOut).bool(p.aToB),
  );
}

export type ScoreEntry = { trader: PublicKey; tier: TierIndex; scoreBps: number; trades: number };

export function setScoreIx(p: { authority: PublicKey; entry: ScoreEntry; programId?: PublicKey }) {
  const programId = p.programId ?? PROGRAM_ID;
  const e = p.entry;
  return ix(
    programId,
    [w(p.authority, true, true), w(configPda(programId)[0]), w(scorePda(e.trader, programId)[0], true), w(SystemProgram.programId)],
    'set_score',
    (wr) => wr.pubkey(e.trader).u8(e.tier).i32(e.scoreBps).u32(e.trades),
  );
}

export function setScoresBatchIx(p: { authority: PublicKey; entries: ScoreEntry[]; programId?: PublicKey }) {
  if (p.entries.length === 0 || p.entries.length > MAX_BATCH) throw new Error(`batch size must be 1..${MAX_BATCH}`);
  const programId = p.programId ?? PROGRAM_ID;
  return ix(
    programId,
    [
      w(p.authority, true, true),
      w(configPda(programId)[0]),
      w(SystemProgram.programId),
      ...p.entries.map((e) => w(scorePda(e.trader, programId)[0], true)),
    ],
    'set_scores_batch',
    (wr) => wr.vec(p.entries, (x, e) => x.pubkey(e.trader).u8(e.tier).i32(e.scoreBps).u32(e.trades)),
  );
}

/** Rent is refunded to whoever paid it (treasury if sponsored, else the trader). The score authority may close only accounts without onchain evidence. */
export function closeScoreIx(p: { closer: PublicKey; trader: PublicKey; /** set when the treasury sponsored this account's rent (TraderScore.sponsored) */ sponsored?: boolean; programId?: PublicKey }) {
  const programId = p.programId ?? PROGRAM_ID;
  const treasury = treasuryPda(programId)[0];
  return ix(
    programId,
    [w(p.closer, false, true), w(configPda(programId)[0]), w(treasury), w(scorePda(p.trader, programId)[0], true), w(p.sponsored ? treasury : p.trader, true)],
    'close_score',
  );
}

/** Permissionless crank: score `trader`'s pending trades on this pool against the pool's Pyth price account. */
export function settleMarkoutIx(p: { cranker: PublicKey; trader: PublicKey; baseMint: PublicKey; quoteMint: PublicKey; /** the pool's oracle (Pool.oracleCfg.priceAccount) */ pythPriceAccount: PublicKey; scoreAccountOverride?: PublicKey; programId?: PublicKey }) {
  const programId = p.programId ?? PROGRAM_ID;
  return ix(
    programId,
    [w(p.cranker, false, true), w(configPda(programId)[0]), w(p.scoreAccountOverride ?? scorePda(p.trader, programId)[0], true), w(poolAddresses(p.baseMint, p.quoteMint, programId).pool), w(p.pythPriceAccount)],
    'settle_markout',
    (wr) => wr.pubkey(p.trader),
  );
}

/** Permissionless: roll the rebate epoch (sets the RETAIL-tier rebate from the previous epoch's toxic premium; fails until the epoch has elapsed). */
export function updateRetailFeeIx(p: { cranker: PublicKey; baseMint: PublicKey; quoteMint: PublicKey; programId?: PublicKey }) {
  const programId = p.programId ?? PROGRAM_ID;
  return ix(programId, [w(p.cranker, false, true), w(configPda(programId)[0]), w(poolAddresses(p.baseMint, p.quoteMint, programId).pool, true)], 'update_retail_fee');
}

/** Permissionless: move the protocol's accrued fee share from the pool vaults into the treasury's token accounts. */
export function claimProtocolFeesIx(p: { cranker: PublicKey; baseMint: PublicKey; quoteMint: PublicKey; treasuryBase?: PublicKey; treasuryQuote?: PublicKey; programId?: PublicKey }) {
  const programId = p.programId ?? PROGRAM_ID;
  const a = poolAddresses(p.baseMint, p.quoteMint, programId);
  const treasury = treasuryPda(programId)[0];
  return ix(programId, [
    w(p.cranker, false, true),
    w(a.pool, true),
    w(treasury),
    w(p.baseMint),
    w(p.quoteMint),
    w(a.baseVault, true),
    w(a.quoteVault, true),
    w(p.treasuryBase ?? getAssociatedTokenAddressSync(p.baseMint, treasury, true), true),
    w(p.treasuryQuote ?? getAssociatedTokenAddressSync(p.quoteMint, treasury, true), true),
    w(TOKEN_PROGRAM_ID),
  ], 'claim_protocol_fees');
}

/** Admin: move tokens out of a treasury-owned token account. */
export function treasuryTransferTokensIx(p: { admin: PublicKey; mint: PublicKey; from?: PublicKey; to: PublicKey; amount: bigint; programId?: PublicKey }) {
  const programId = p.programId ?? PROGRAM_ID;
  const treasury = treasuryPda(programId)[0];
  return ix(
    programId,
    [w(p.admin, false, true), w(configPda(programId)[0]), w(treasury), w(p.mint), w(p.from ?? getAssociatedTokenAddressSync(p.mint, treasury, true), true), w(p.to, true), w(TOKEN_PROGRAM_ID)],
    'treasury_transfer_tokens',
    (wr) => wr.u64(p.amount),
  );
}

/** Admin: withdraw SOL from the treasury (it must keep its rent-exempt minimum or be emptied). */
export function treasuryWithdrawSolIx(p: { admin: PublicKey; destination: PublicKey; lamports: bigint | number; programId?: PublicKey }) {
  const programId = p.programId ?? PROGRAM_ID;
  return ix(
    programId,
    [w(p.admin, false, true), w(configPda(programId)[0]), w(treasuryPda(programId)[0], true), w(p.destination, true), w(SystemProgram.programId)],
    'treasury_withdraw_sol',
    (wr) => wr.u64(p.lamports),
  );
}

/** Admin: point a pool at its Pyth base/USD price account + feed id. `PublicKey.default` turns onchain scoring off for the pool. */
export function setPoolOracleIx(p: { admin: PublicKey; baseMint: PublicKey; quoteMint: PublicKey; priceAccount: PublicKey; feedId: Uint8Array; programId?: PublicKey }) {
  if (p.feedId.length !== 32) throw new Error('feedId must be 32 bytes');
  const programId = p.programId ?? PROGRAM_ID;
  return ix(
    programId,
    [w(p.admin, false, true), w(configPda(programId)[0]), w(poolAddresses(p.baseMint, p.quoteMint, programId).pool, true)],
    'set_pool_oracle',
    (wr) => wr.pubkey(p.priceAccount).bytes(p.feedId),
  );
}
