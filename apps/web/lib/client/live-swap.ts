'use client';
// Live-mode helpers: read the pool / the connected wallet's effective tier and send a swap with the SDK.
import { Connection, PublicKey, Transaction, type TransactionSignature } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { FairwayClient, swapIx, type PoolAccount } from '@fairway/sdk';

export type LiveQuote = { amountOut: bigint; fee: bigint; feeBps: number; tier: number; source: string };

export async function loadLive(connection: Connection, trader: PublicKey, baseMint: PublicKey, quoteMint: PublicKey) {
  const client = new FairwayClient(connection);
  const [pool, fee] = await Promise.all([client.fetchPool(baseMint, quoteMint), client.effectiveFee(trader)]);
  return { client, pool, fee };
}

export type LivePool = Awaited<ReturnType<typeof loadLive>>['pool'];
export type { PoolAccount };

export async function sendSwap(p: {
  connection: Connection;
  trader: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  amountIn: bigint;
  minAmountOut: bigint;
  aToB: boolean;
  sendTransaction: (tx: Transaction, c: Connection) => Promise<TransactionSignature>;
}) {
  const tx = new Transaction();
  // make sure the destination ATA exists (idempotent)
  const outMint = p.aToB ? p.quoteMint : p.baseMint;
  tx.add(createAssociatedTokenAccountIdempotentInstruction(p.trader, getAssociatedTokenAddressSync(outMint, p.trader), p.trader, outMint));
  tx.add(swapIx({ trader: p.trader, baseMint: p.baseMint, quoteMint: p.quoteMint, amountIn: p.amountIn, minAmountOut: p.minAmountOut, aToB: p.aToB }));
  const sig = await p.sendTransaction(tx, p.connection);
  const latest = await p.connection.getLatestBlockhash();
  await p.connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
  return sig;
}
