/**
 * Seeds a LOCAL validator with a Fairway pool (throwaway keys only).
 *   - creates SOL-like (9 dec) and USDC-like (6 dec) mints
 *   - initialize_config, create_pool, add_liquidity
 *   - funds a demo wallet and writes scores: Retail Rita (RETAIL), Arb Bot 7 (TOXIC)
 *   - writes apps/web/.env.local for live mode
 * Usage: pnpm seed:local   (RPC_URL defaults to http://127.0.0.1:8899)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, sendAndConfirmTransaction, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import {
  addLiquidityIx,
  createPoolIx,
  initializeConfigIx,
  poolAddresses,
  PYTH_SOL_USD_FEED_ID,
  PYTH_SOL_USD_PRICE_ACCOUNT_DEVNET,
  setScoresBatchIx,
  TIER,
  setPoolOracleIx,
  treasuryPda,
  configureLaunchIx,
} from '@fairway/sdk';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rpc = process.env.RPC_URL || 'http://127.0.0.1:8899';
const conn = new Connection(rpc, 'confirmed');

function key(name: string): Keypair {
  const p = join(root, '.keys', `${name}.json`);
  if (existsSync(p)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
  mkdirSync(dirname(p), { recursive: true });
  const k = Keypair.generate();
  writeFileSync(p, JSON.stringify(Array.from(k.secretKey)));
  return k;
}
async function airdrop(k: Keypair, sol: number) {
  if ((await conn.getBalance(k.publicKey)) >= sol * LAMPORTS_PER_SOL * 0.5) return;
  const sig = await conn.requestAirdrop(k.publicKey, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) }, 'confirmed');
}
const send = (ixs: TransactionInstruction[], signers: Keypair[]) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: 'confirmed' });

async function createPoolAndSeed(baseMint: PublicKey, quote: PublicKey, baseAmount: bigint, quoteAmount: bigint) {
  const admin = key('deployer');
  const aBase = await getOrCreateAssociatedTokenAccount(conn, admin, baseMint, admin.publicKey);
  const aQuote = await getOrCreateAssociatedTokenAccount(conn, admin, quote, admin.publicKey);
  await mintTo(conn, admin, baseMint, aBase.address, admin, baseAmount);
  await mintTo(conn, admin, quote, aQuote.address, admin, quoteAmount);
  await send([createPoolIx({ payer: admin.publicKey, baseMint, quoteMint: quote })], [admin]);
  await getOrCreateAssociatedTokenAccount(conn, admin, poolAddresses(baseMint, quote).lpMint, admin.publicKey);
  await send([addLiquidityIx({ owner: admin.publicKey, baseMint, quoteMint: quote, maxBase: baseAmount, maxQuote: quoteAmount, minLp: 0n })], [admin]);
  console.log(`seeded pool ${poolAddresses(baseMint, quote).pool.toBase58()} (base ${baseMint.toBase58()})`);
}

async function main() {
  const admin = key('deployer');
  const authority = key('score-authority');
  const rita = key('demo-rita');
  const bot = key('demo-bot7');
  const demo = key('demo-wallet');
  for (const k of [admin, authority, rita, bot, demo]) await airdrop(k, 20);

  const base = await createMint(conn, admin, admin.publicKey, null, 9);
  const quote = await createMint(conn, admin, admin.publicKey, null, 6);
  const adminBase = await getOrCreateAssociatedTokenAccount(conn, admin, base, admin.publicKey);
  const adminQuote = await getOrCreateAssociatedTokenAccount(conn, admin, quote, admin.publicKey);
  await mintTo(conn, admin, base, adminBase.address, admin, 10_000n * 10n ** 9n);
  await mintTo(conn, admin, quote, adminQuote.address, admin, 1_500_000n * 10n ** 6n);

  await send([initializeConfigIx({ admin: admin.publicKey, scoreAuthority: authority.publicKey, feeBps: [30, 30, 80], scoreTtlSlots: 2_000_000 })], [admin]).catch((e) => console.warn('config:', String(e).split('\n')[0]));
  await send([createPoolIx({ payer: admin.publicKey, baseMint: base, quoteMint: quote })], [admin]);
  // Onchain markout scoring is per pool: point this pool at Pyth SOL/USD (override with PYTH_PRICE_ACCOUNT / PYTH_FEED_ID; on a
  // local validator clone the account from devnet, see docs/SETUP_REMAINING.md). The account was verified 2026-11-19.
  // A pool without an oracle still trades; it just does not build onchain evidence.
  const pyth = new PublicKey(process.env.PYTH_PRICE_ACCOUNT || PYTH_SOL_USD_PRICE_ACCOUNT_DEVNET);
  const feedId = Uint8Array.from(Buffer.from(process.env.PYTH_FEED_ID || PYTH_SOL_USD_FEED_ID, 'hex'));
  await send([setPoolOracleIx({ admin: admin.publicKey, baseMint: base, quoteMint: quote, priceAccount: pyth, feedId })], [admin]);
  // The protocol treasury sponsors the rent of each new wallet's score account while it holds SOL (the trader pays otherwise).
  const treasury = treasuryPda()[0];
  await send([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: treasury, lamports: Math.round(0.05 * LAMPORTS_PER_SOL) })], [admin]);
  console.log(`treasury ${treasury.toBase58()} funded with 0.05 SOL (sponsors ~20 score accounts)`);
  await getOrCreateAssociatedTokenAccount(conn, admin, poolAddresses(base, quote).lpMint, admin.publicKey); // LP token account must exist
  await send([addLiquidityIx({ owner: admin.publicKey, baseMint: base, quoteMint: quote, maxBase: 10_000n * 10n ** 9n, maxQuote: 1_500_000n * 10n ** 6n, minLp: 0n })], [admin]);
  // Second pool: BONK-test / USDC (a TEST mint, 5 decimals, $0.00002). No Pyth feed exists for a test mint, so this pool has no
  // oracle: it trades and charges tiers from keeper scores, but builds no onchain evidence.
  const bonk = await createMint(conn, admin, admin.publicKey, null, 5);
  await createPoolAndSeed(bonk, quote, 50_000_000_000n * 10n ** 5n, 1_000_000n * 10n ** 6n);
  // Third pool: a fair launch (FROG test mint, 6 decimals, no oracle → scored against the pool TWAP). Configured before any
  // swap; trading opens now, default 750-slot window and fee curve. The admin creates it, so no launch fee is charged.
  const frog = await createMint(conn, admin, admin.publicKey, null, 6);
  await createPoolAndSeed(frog, quote, 800_000_000n * 10n ** 6n, 24_000n * 10n ** 6n);
  await send([configureLaunchIx({ authority: admin.publicKey, baseMint: frog, quoteMint: quote, launchSlot: 0, windowSlots: 750 })], [admin]);
  console.log(`launch configured: /launch/${frog.toBase58()}`);
  await send(
    [setScoresBatchIx({ authority: authority.publicKey, entries: [
      { trader: rita.publicKey, tier: TIER.RETAIL, scoreBps: 0, trades: 40 },
      { trader: bot.publicKey, tier: TIER.TOXIC, scoreBps: 35, trades: 900 },
    ] })],
    [authority],
  );
  // fund demo traders with tokens so swaps work
  for (const k of [rita, bot, demo]) {
    const b = await getOrCreateAssociatedTokenAccount(conn, admin, base, k.publicKey);
    const q = await getOrCreateAssociatedTokenAccount(conn, admin, quote, k.publicKey);
    await mintTo(conn, admin, base, b.address, admin, 100n * 10n ** 9n);
    await mintTo(conn, admin, quote, q.address, admin, 20_000n * 10n ** 6n);
  }
  writeFileSync(join(root, 'apps', 'web', '.env.local'), `NEXT_PUBLIC_MODE=live\nNEXT_PUBLIC_RPC_URL=${rpc}\nNEXT_PUBLIC_BASE_MINT=${base.toBase58()}\nNEXT_PUBLIC_QUOTE_MINT=${quote.toBase58()}\nNEXT_PUBLIC_LAUNCH_MINT=${frog.toBase58()}\n`);
  console.log(JSON.stringify({ base: base.toBase58(), quote: quote.toBase58(), launch: frog.toBase58(), rita: rita.publicKey.toBase58(), bot7: bot.publicKey.toBase58(), demo: demo.publicKey.toBase58() }, null, 2));
  console.log('Seeded. Import .keys/demo-*.json into your wallet (solana-keygen pubkey) to try tiers. Wrote apps/web/.env.local');
}
main().catch((e) => {
  console.error('seed failed (is the local validator running? try: pnpm demo:local):', e instanceof Error ? e.message : e);
  process.exit(1);
});
