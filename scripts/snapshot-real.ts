/**
 * Exports real Pump.fun launch reports from a LIVE ingest service (fed by the QuickNode Stream) to apps/web/data/real-snapshot.json,
 * so the web app can show real mainnet data when ingest is offline. Refuses fixture-mode data: the snapshot must be real.
 * Usage: INGEST_URL=http://127.0.0.1:8787 pnpm snapshot:real
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.env.INGEST_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');

async function main() {
  const list = (await (await fetch(`${base}/check/tokens?limit=50`)).json()) as { source: string; tokens: { mint: string; topBuyers: { wallet: string }[] }[] };
  if (list.source !== 'live') throw new Error(`ingest at ${base} is in ${list.source} mode: refusing to write synthetic data as a real snapshot`);
  const tokens = [];
  for (const t of list.tokens) tokens.push(await (await fetch(`${base}/check/token/${t.mint}`)).json());
  const wallets: Record<string, unknown> = {};
  for (const w of [...new Set(list.tokens.flatMap((t) => t.topBuyers.map((b) => b.wallet)))].slice(0, 200)) {
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
  console.log(`wrote ${out}: ${tokens.length} tokens, ${Object.keys(wallets).length} wallets, mainnet slot ${slot}`);
}
main().catch((e) => {
  console.error('snapshot failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
