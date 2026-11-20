/**
 * Seeds a LOCAL validator or DEVNET with a Fairway pool (throwaway keys only). Idempotent: re-runs skip what exists.
 *   - devnet: never airdrops; funds helper keys by transfer from .keys/deployer.json (prints the plan first)
 *   - creates SOL-like (9 dec) and USDC-like (6 dec) mints
 *   - initialize_config, create_pool, add_liquidity
 *   - funds a demo wallet and writes scores: Retail Rita (RETAIL), Arb Bot 7 (TOXIC)
 *   - writes apps/web/.env.local for live mode
 * Usage: pnpm seed:local | pnpm seed:devnet   (RPC_URL defaults to http://127.0.0.1:8899)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, sendAndConfirmTransaction, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
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
  configPda,
  scorePda,
  PROGRAM_ID,
} from '@fairway/sdk';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rpc = process.env.RPC_URL || 'http://127.0.0.1:8899';
const conn = new Connection(rpc, { commitment: 'confirmed', disableRetryOnRateLimit: false });

function key(name: string): Keypair {
  const p = join(root, '.keys', `${name}.json`);
  if (existsSync(p)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
  mkdirSync(dirname(p), { recursive: true });
  const k = Keypair.generate();
  writeFileSync(p, JSON.stringify(Array.from(k.secretKey)));
  return k;
}

const isDevnet = /devnet/.test(rpc);
const net = isDevnet ? 'devnet' : 'local';
const SOL = LAMPORTS_PER_SOL;
const exists = async (a: PublicKey) => (await conn.getAccountInfo(a)) !== null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Public devnet RPC rate-limits hard: pace sends and retry on 429 / transient errors. */
async function send(ixs: TransactionInstruction[], signers: Keypair[]) {
  for (let i = 0; ; i++) {
    try {
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: 'confirmed' });
      if (isDevnet) await sleep(1500);
      return sig;
    } catch (e) {
      if (i >= 5 || !/429|Too many|blockhash|timed out|fetch failed/i.test(String(e))) throw e;
      await sleep(3000 * (i + 1));
    }
  }
}

async function airdrop(k: Keypair, sol: number) {
  if ((await conn.getBalance(k.publicKey)) >= sol * SOL * 0.5) return;
  const sig = await conn.requestAirdrop(k.publicKey, sol * SOL);
  await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) }, 'confirmed');
}

/** Devnet funding: top each helper key up to its target by transfer from the deployer. Never requestAirdrop. */
async function fundFromDeployer(admin: Keypair, targets: { name: string; k: PublicKey; sol: number }[], budgetSol: number) {
  const plan: { name: string; to: PublicKey; lamports: number }[] = [];
  for (const t of targets) {
    const bal = await conn.getBalance(t.k);
    const need = Math.round(t.sol * SOL) - bal;
    if (need > 0) plan.push({ name: t.name, to: t.k, lamports: need });
  }
  const total = plan.reduce((a, p) => a + p.lamports, 0);
  console.log(`funding plan (from deployer ${admin.publicKey.toBase58()}, balance ${(await conn.getBalance(admin.publicKey)) / SOL} SOL):`);
  for (const p of plan) console.log(`  ${p.name.padEnd(16)} +${(p.lamports / SOL).toFixed(4)} SOL -> ${p.to.toBase58()}`);
  console.log(`  total transfers: ${(total / SOL).toFixed(4)} SOL (budget ${budgetSol} SOL)${plan.length ? '' : ' (nothing to fund)'}`);
  if (total > budgetSol * SOL) throw new Error(`funding plan ${total / SOL} SOL exceeds budget ${budgetSol} SOL`);
  if (plan.length) await send(plan.map((p) => SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: p.to, lamports: p.lamports })), [admin]);
}

async function ensureMint(admin: Keypair, name: string, decimals: number): Promise<{ mint: PublicKey; created: boolean }> {
  const kp = key(`mint-${net}-${name}`);
  if (await exists(kp.publicKey)) return { mint: kp.publicKey, created: false };
  await createMint(conn, admin, admin.publicKey, null, decimals, kp);
  return { mint: kp.publicKey, created: true };
}

/** Creates the pool + first liquidity only if the pool account is missing. Returns whether it was created. */
async function ensurePool(admin: Keypair, baseMint: PublicKey, quote: PublicKey, baseAmount: bigint, quoteAmount: bigint): Promise<boolean> {
  const addrs = poolAddresses(baseMint, quote);
  if (await exists(addrs.pool)) {
    // Resume a half-finished earlier run: pool created but no liquidity yet.
    if ((await conn.getTokenSupply(addrs.lpMint)).value.amount !== '0') { console.log(`pool exists, skipped: ${addrs.pool.toBase58()}`); return false; }
    console.log(`pool exists but empty, adding liquidity: ${addrs.pool.toBase58()}`);
    await topUpTokens(admin, admin.publicKey, baseMint, baseAmount);
    await topUpTokens(admin, admin.publicKey, quote, quoteAmount);
    await getOrCreateAssociatedTokenAccount(conn, admin, addrs.lpMint, admin.publicKey);
    await send([addLiquidityIx({ owner: admin.publicKey, baseMint, quoteMint: quote, maxBase: baseAmount, maxQuote: quoteAmount, minLp: 0n })], [admin]);
    return true;
  }
  const aBase = await getOrCreateAssociatedTokenAccount(conn, admin, baseMint, admin.publicKey);
  const aQuote = await getOrCreateAssociatedTokenAccount(conn, admin, quote, admin.publicKey);
  await mintTo(conn, admin, baseMint, aBase.address, admin, baseAmount);
  await mintTo(conn, admin, quote, aQuote.address, admin, quoteAmount);
  await send([createPoolIx({ payer: admin.publicKey, baseMint, quoteMint: quote })], [admin]);
  await getOrCreateAssociatedTokenAccount(conn, admin, addrs.lpMint, admin.publicKey);
  await send([addLiquidityIx({ owner: admin.publicKey, baseMint, quoteMint: quote, maxBase: baseAmount, maxQuote: quoteAmount, minLp: 0n })], [admin]);
  console.log(`seeded pool ${addrs.pool.toBase58()} (base ${baseMint.toBase58()})`);
  return true;
}

async function topUpTokens(admin: Keypair, owner: PublicKey, mint: PublicKey, amount: bigint) {
  const ata = await getOrCreateAssociatedTokenAccount(conn, admin, mint, owner);
  if ((await getAccount(conn, ata.address)).amount < amount / 2n) await mintTo(conn, admin, mint, ata.address, admin, amount);
}

async function main() {
  const admin = key('deployer');
  const authority = key('score-authority'); // also the keeper's signer
  const rita = key('demo-rita');
  const bot = key('demo-bot7');
  const demo = key('demo-wallet');
  if (isDevnet) {
    // Total transfers stay well under 1.5 SOL; rent for mints/pools/accounts is paid by the deployer on top.
    await fundFromDeployer(admin, [
      { name: 'score-authority', k: authority.publicKey, sol: 0.05 },
      { name: 'demo-rita', k: rita.publicKey, sol: 0.03 },
      { name: 'demo-bot7', k: bot.publicKey, sol: 0.03 },
      { name: 'demo-wallet', k: demo.publicKey, sol: 0.03 },
    ], 1.5);
  } else for (const k of [admin, authority, rita, bot, demo]) await airdrop(k, 20);

  const before = await conn.getBalance(admin.publicKey);
  const { mint: base } = await ensureMint(admin, 'base', 9);
  const { mint: quote } = await ensureMint(admin, 'quote', 6);

  const configAddr = configPda()[0];
  if (await exists(configAddr)) console.log(`config exists, skipped: ${configAddr.toBase58()}`);
  else await send([initializeConfigIx({ admin: admin.publicKey, scoreAuthority: authority.publicKey, feeBps: [30, 30, 80], scoreTtlSlots: 2_000_000 })], [admin]);

  // Pool 1: SOL-like / USDC-like, pointed at Pyth SOL/USD (override with PYTH_PRICE_ACCOUNT / PYTH_FEED_ID; on a local validator
  // clone the account from devnet, see docs/SETUP_REMAINING.md). A pool without an oracle still trades; it just builds no onchain evidence.
  if (await ensurePool(admin, base, quote, 10_000n * 10n ** 9n, 1_500_000n * 10n ** 6n)) {
    const pyth = new PublicKey(process.env.PYTH_PRICE_ACCOUNT || PYTH_SOL_USD_PRICE_ACCOUNT_DEVNET);
    const feedId = Uint8Array.from(Buffer.from(process.env.PYTH_FEED_ID || PYTH_SOL_USD_FEED_ID, 'hex'));
    await send([setPoolOracleIx({ admin: admin.publicKey, baseMint: base, quoteMint: quote, priceAccount: pyth, feedId })], [admin]);
  }
  // The protocol treasury sponsors the rent of each new wallet's score account while it holds SOL.
  const treasury = treasuryPda()[0];
  if ((await conn.getBalance(treasury)) < 0.025 * SOL) {
    await send([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: treasury, lamports: Math.round(0.05 * SOL) })], [admin]);
    console.log(`treasury ${treasury.toBase58()} funded with 0.05 SOL (sponsors ~20 score accounts)`);
  } else console.log(`treasury ${treasury.toBase58()} already funded, skipped`);

  // Pool 2: BONK-test / USDC (TEST mint, 5 decimals). No oracle: trades and charges tiers from keeper scores only.
  const { mint: bonk } = await ensureMint(admin, 'bonk', 5);
  await ensurePool(admin, bonk, quote, 50_000_000_000n * 10n ** 5n, 1_000_000n * 10n ** 6n);
  // Pool 3: a fair launch (FROG test mint, no oracle -> scored against the pool TWAP). Configured before any swap.
  const { mint: frog } = await ensureMint(admin, 'frog', 6);
  if (await ensurePool(admin, frog, quote, 800_000_000n * 10n ** 6n, 24_000n * 10n ** 6n)) {
    await send([configureLaunchIx({ authority: admin.publicKey, baseMint: frog, quoteMint: quote, launchSlot: 0, windowSlots: 750 })], [admin]);
    console.log(`launch configured: /launch/${frog.toBase58()}`);
  }

  const personas = [
    { name: 'Retail Rita', k: rita.publicKey, tier: TIER.RETAIL, scoreBps: 0, trades: 40 },
    { name: 'Arb Bot 7', k: bot.publicKey, tier: TIER.TOXIC, scoreBps: 35, trades: 900 },
  ];
  const missing = [];
  for (const p of personas) if (!(await exists(scorePda(p.k)[0]))) missing.push({ trader: p.k, tier: p.tier, scoreBps: p.scoreBps, trades: p.trades });
  if (missing.length) await send([setScoresBatchIx({ authority: authority.publicKey, entries: missing })], [authority]);
  else console.log('persona scores exist, skipped');

  for (const k of [rita, bot, demo]) {
    await topUpTokens(admin, k.publicKey, base, 100n * 10n ** 9n);
    await topUpTokens(admin, k.publicKey, quote, 20_000n * 10n ** 6n);
  }
  console.log(`deployer spent ${((before - (await conn.getBalance(admin.publicKey))) / SOL).toFixed(4)} SOL on rent/treasury this run (excl. funding transfers)`);

  const pool = (m: PublicKey, q = quote) => poolAddresses(m, q).pool.toBase58();
  const summary = {
    network: net, rpc: isDevnet ? 'https://api.devnet.solana.com' : rpc, programId: PROGRAM_ID.toBase58(),
    config: configAddr.toBase58(), treasury: treasury.toBase58(), admin: admin.publicKey.toBase58(), scoreAuthority: authority.publicKey.toBase58(),
    mints: { base: base.toBase58(), quote: quote.toBase58(), bonk: bonk.toBase58(), frog: frog.toBase58() },
    pools: { solUsdc: pool(base), bonkUsdc: pool(bonk), frogUsdc: pool(frog) },
    launches: [{ mint: frog.toBase58(), pool: pool(frog), path: `/launch/${frog.toBase58()}` }],
    personas: { 'Retail Rita': rita.publicKey.toBase58(), 'Arb Bot 7': bot.publicKey.toBase58(), 'New wallet': demo.publicKey.toBase58() },
  };
  mkdirSync(join(root, 'scripts', 'out'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'out', `${net}-seed.json`), JSON.stringify(summary, null, 2) + '\n');
  writeFileSync(join(root, 'apps', 'web', '.env.local'), `NEXT_PUBLIC_MODE=live\nNEXT_PUBLIC_RPC_URL=${rpc}\nNEXT_PUBLIC_BASE_MINT=${base.toBase58()}\nNEXT_PUBLIC_QUOTE_MINT=${quote.toBase58()}\nNEXT_PUBLIC_LAUNCH_MINT=${frog.toBase58()}\n`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Seeded (${net}). Summary: scripts/out/${net}-seed.json. Import .keys/demo-*.json into your wallet to try tiers. Wrote apps/web/.env.local`);
}
main().catch((e) => {
  console.error('seed failed (is the RPC / local validator reachable? try: pnpm demo:local):', e instanceof Error ? e.message : e);
  process.exit(1);
});
