'use client';
// Live mode (local validator / devnet): create a token, its Fairway pool and its launch with the SDK, then read it back.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, type TransactionSignature } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { addLiquidityIx, configureLaunchIx, createPoolIx, FairwayClient, parseSwapEvents, poolAddresses, type PoolAccount } from '@fairway/sdk';

type Send = (tx: Transaction, c: Connection, opts?: { signers?: Keypair[] }) => Promise<TransactionSignature>;

const TOKEN_DECIMALS = 6;

async function confirm(connection: Connection, sig: string) {
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
}

/**
 * Three transactions, all signed by the connected wallet (it pays and becomes the pool creator):
 *  1. create the mint (6 decimals) and mint the whole supply to the creator;
 *  2. create the Fairway pool, add the starting liquidity (needs that much quote token in the wallet),
 *  3. configure_launch: trading opens now, window in slots, the program's default fee curve. A non-admin creator pays the
 *     launch fee (Config.launch.launch_fee_lamports) to the treasury.
 * Token name/symbol are not written onchain (no Metaplex metadata in this prototype).
 */
export async function createLaunchLive(p: {
  connection: Connection;
  creator: PublicKey;
  quoteMint: PublicKey;
  supply: number;
  poolPct: number;
  liquidityQuote: number;
  quoteDecimals: number;
  windowSlots: number;
  sendTransaction: Send;
}) {
  const mint = Keypair.generate();
  const supplyRaw = BigInt(Math.floor(p.supply)) * 10n ** BigInt(TOKEN_DECIMALS);
  const poolRaw = (supplyRaw * BigInt(Math.round(p.poolPct * 100))) / 10_000n;
  const quoteRaw = BigInt(Math.floor(p.liquidityQuote * 10 ** p.quoteDecimals));
  const creatorAta = getAssociatedTokenAddressSync(mint.publicKey, p.creator);
  const tx1 = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: p.creator, newAccountPubkey: mint.publicKey, space: MINT_SIZE, lamports: await getMinimumBalanceForRentExemptMint(p.connection), programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mint.publicKey, TOKEN_DECIMALS, p.creator, null),
    createAssociatedTokenAccountIdempotentInstruction(p.creator, creatorAta, p.creator, mint.publicKey),
    createMintToInstruction(mint.publicKey, creatorAta, p.creator, supplyRaw),
  );
  await confirm(p.connection, await p.sendTransaction(tx1, p.connection, { signers: [mint] }));
  const a = poolAddresses(mint.publicKey, p.quoteMint);
  const tx2 = new Transaction().add(
    createPoolIx({ payer: p.creator, baseMint: mint.publicKey, quoteMint: p.quoteMint }),
    createAssociatedTokenAccountIdempotentInstruction(p.creator, getAssociatedTokenAddressSync(a.lpMint, p.creator), p.creator, a.lpMint),
    addLiquidityIx({ owner: p.creator, baseMint: mint.publicKey, quoteMint: p.quoteMint, maxBase: poolRaw, maxQuote: quoteRaw, minLp: 0n }),
  );
  await confirm(p.connection, await p.sendTransaction(tx2, p.connection));
  const tx3 = new Transaction().add(configureLaunchIx({ authority: p.creator, baseMint: mint.publicKey, quoteMint: p.quoteMint, launchSlot: 0, windowSlots: p.windowSlots }));
  await confirm(p.connection, await p.sendTransaction(tx3, p.connection));
  return mint.publicKey;
}

export type LiveLaunch = {
  pool: (PoolAccount & { address: PublicKey; reserveBase: bigint; reserveQuote: bigint }) | null;
  slot: bigint;
  swaps: { sig: string; trader: string; aToB: boolean; amountIn: bigint; amountOut: bigint; feeBps: number; tier: number }[];
};

/** Pool state + the last swaps (SwapExecuted events parsed from the pool's recent transactions). */
export async function loadLiveLaunch(connection: Connection, baseMint: PublicKey, quoteMint: PublicKey, limit = 50): Promise<LiveLaunch> {
  const client = new FairwayClient(connection);
  const [pool, slot] = await Promise.all([client.fetchPool(baseMint, quoteMint), connection.getSlot('confirmed')]);
  const swaps: LiveLaunch['swaps'] = [];
  if (pool) {
    const sigs = await connection.getSignaturesForAddress(pool.address, { limit }, 'confirmed');
    const txs = await connection.getTransactions(
      sigs.map((s) => s.signature),
      { maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
    );
    txs.forEach((tx, i) => {
      for (const e of parseSwapEvents(tx?.meta?.logMessages ?? [])) {
        swaps.push({ sig: sigs[i]!.signature, trader: e.trader.toBase58(), aToB: e.aToB, amountIn: e.amountIn, amountOut: e.amountOut, feeBps: e.feeBps, tier: e.tier });
      }
    });
  }
  return { pool, slot: BigInt(slot), swaps };
}
