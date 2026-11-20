/**
 * Exports real Pump.fun launch reports from a LIVE ingest service (fed by the QuickNode Stream) to apps/web/data/real-snapshot.json,
 * so the web app can show real mainnet data when ingest is offline. Refuses fixture-mode data: the snapshot must be real.
 * Usage: INGEST_URL=http://127.0.0.1:8787 pnpm snapshot:real
 */
try { process.loadEnvFile(new URL('../.env.local', import.meta.url)); } catch { /* no local env file */ }
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection } from '@solana/web3.js';
import { fetchTokenMetadata, tokenLabel } from '@fairway/sdk';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.env.INGEST_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');

async function main() {
  const list = (await (await fetch(`${base}/check/tokens?limit=${Number(process.env.SNAPSHOT_CANDIDATES) || 300}`)).json()) as { source: string; tokens: { mint: string; topBuyers: { wallet: string }[] }[] };
  if (list.source !== 'live') throw new Error(`ingest at ${base} is in ${list.source} mode: refusing to write synthetic data as a real snapshot`);
  // the list endpoint already returns the full report per token
  const all = [...(list.tokens as unknown as Record<string, unknown>[])];
  for (const v of ['launchlab', 'meteora-dbc']) {
    const extra = (await (await fetch(`${base}/check/tokens?limit=40&venue=${v}`)).json()) as { tokens: Record<string, unknown>[] };
    for (const t of extra.tokens) if (!all.some((x) => x.mint === t.mint)) all.push(t);
  }
  // name / symbol / image from onchain token metadata (Metaplex or Token-2022) via the mainnet RPC, so the static
  // snapshot (e.g. on Vercel) shows them without an RPC; tokens without metadata keep a shortened mint
  const conn = new Connection(process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  const meta = await fetchTokenMetadata(conn, all.map((t) => t.mint as string), { imageTimeoutMs: 5_000 });
  // a good mix for the static site: every High and Medium (up to 15 each), then Low reports ranked by confidence
  // (enough early buyers), onchain name + logo, and early-buyer count; 60 tokens in total
  const SIZE = Number(process.env.SNAPSHOT_SIZE) || 60;
  const rank = (t: Record<string, unknown>) => (t.lowConfidence ? 0 : 1000) + (meta.get(t.mint as string)?.image ? 500 : meta.get(t.mint as string) ? 250 : 0) + Math.min(Number(t.earlyBuyers) || 0, 200);
  const byGrade = (g: string) => all.filter((t) => t.grade === g).sort((a, b) => rank(b) - rank(a));
  const picked = [...byGrade('High').slice(0, 15), ...byGrade('Medium').slice(0, 15)];
  // and a few from each non-Pump.fun launchpad (LetsBonk, Bags/Believe/Jupiter), so every venue is represented
  for (const v of ['launchlab', 'meteora-dbc']) picked.push(...all.filter((t) => t.venue === v && !picked.includes(t)).sort((a, b) => rank(b) - rank(a)).slice(0, 10));
  const pickedSet = new Set(picked.map((t) => t.mint));
  const low = byGrade('Low').filter((t) => !pickedSet.has(t.mint));
  const tokens = [...picked, ...low].slice(0, SIZE).sort((a, b) => Number(b.launchSlot) - Number(a.launchSlot));
  for (const t of tokens) {
    const m = meta.get(t.mint as string) ?? null;
    const l = tokenLabel(t.mint as string, m);
    Object.assign(t, { name: l.name, symbol: l.symbol, image: m?.image ?? null });
  }
  const named = tokens.filter((t) => meta.get(t.mint as string)).length;
  const wallets: Record<string, unknown> = {};
  for (const w of [...new Set(tokens.flatMap((t) => (t.topBuyers as { wallet: string }[]).map((b) => b.wallet)))].slice(0, Number(process.env.SNAPSHOT_WALLETS) || 200)) {
    const r = (await (await fetch(`${base}/check/wallet/${w}`)).json()) as { found?: boolean };
    if (r.found) wallets[w] = r;
  }
  const slotRes = await fetch(process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot' }),
  });
  const slot = ((await slotRes.json()) as { result: number }).result;
  const out = join(root, 'apps', 'web', 'data', 'real-snapshot.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ source: 'live', updatedAt: Math.floor(Date.now() / 1000), slot, tokens, wallets }) + '\n');
  const venues = tokens.reduce<Record<string, number>>((m, t) => ((m[(t.venue as string) || 'pumpfun'] = (m[(t.venue as string) || 'pumpfun'] || 0) + 1), m), {});
  console.log(`venues ${JSON.stringify(venues)}`);
  const grades = tokens.reduce<Record<string, number>>((m, t) => ((m[t.grade as string] = (m[t.grade as string] || 0) + 1), m), {});
  console.log(`grades ${JSON.stringify(grades)}; with logo: ${tokens.filter((t) => t.image).length}`);
  console.log(`wrote ${out}: ${tokens.length} tokens (${named} with onchain metadata), ${Object.keys(wallets).length} wallets, mainnet slot ${slot}`);
}
main().catch((e) => {
  console.error('snapshot failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
