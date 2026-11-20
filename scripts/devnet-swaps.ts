/**
 * Sends a few REAL swaps on devnet from the seeded persona keys (RETAIL Rita, TOXIC Arb Bot 7, a new wallet), so the
 * launch feed, buyers list and fairness report have real onchain activity. Usage: RPC_URL=... pnpm --filter @fairway/scripts devnet:swaps
 */
try { process.loadEnvFile(new URL('../.env.local', import.meta.url)); } catch { /* no local env file */ }
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { swapIx } from '@fairway/sdk';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const conn = new Connection(process.env.RPC_URL || process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
const key = (n: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(root, '.keys', `${n}.json`), 'utf8'))));
const seed = JSON.parse(readFileSync(join(root, 'scripts', 'out', 'devnet-seed.json'), 'utf8'));
const quote = new PublicKey(seed.mints.quote);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buy(who: string, base: PublicKey, usdc: number) {
  const k = key(who);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(k.publicKey, getAssociatedTokenAddressSync(base, k.publicKey), k.publicKey, base),
    swapIx({ trader: k.publicKey, baseMint: base, quoteMint: quote, amountIn: BigInt(Math.round(usdc * 1e6)), minAmountOut: 0n, aToB: false }),
  );
  const sig = await sendAndConfirmTransaction(conn, tx, [k], { commitment: 'confirmed' });
  console.log(`${who} bought with ${usdc} USDC on ${base.toBase58().slice(0, 6)}: ${sig}`);
  await sleep(1500);
}

async function main() {
  const sol = new PublicKey(seed.mints.base);
  const frog = new PublicKey(seed.mints.frog);
  await buy('demo-rita', sol, 150);
  await buy('demo-bot7', sol, 2000);
  await buy('demo-wallet', sol, 300);
  await buy('demo-rita', frog, 40);
  await buy('demo-wallet', frog, 25);
}
main().catch((e) => {
  console.error('swaps failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
