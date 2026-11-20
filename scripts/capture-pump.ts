/**
 * Fallback for the live Stream: replays recent Solana MAINNET blocks through the SAME QuickNode Streams filter
 * (streams/pumpfun-filter.js, loaded as-is) and POSTs its output to the ingest webhook exactly like the Stream would
 * (same body `{ launchTrades, fundings }`, same x-fairway-token header).
 *
 * Usage: pnpm capture:pump [--minutes 20] [--concurrency 6] [--batch 10] [--ingest http://127.0.0.1:8787]
 * Needs MAINNET_RPC_URL (QuickNode, from .env.local) and QN_STREAM_TOKEN if ingest enforces it.
 */
try { process.loadEnvFile(new URL('../.env.local', import.meta.url)); } catch { /* no local env file */ }
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const MINUTES = Number(arg('minutes', '20'));
const CONC = Number(arg('concurrency', '6'));
const BATCH = Number(arg('batch', '10'));
const INGEST = arg('ingest', process.env.INGEST_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const RPC = process.env.MAINNET_RPC_URL;
if (!RPC) throw new Error('MAINNET_RPC_URL is not set (.env.local)');

// the exact filter source pasted into the Stream
type Out = { launchTrades?: unknown[]; fundings?: unknown[] } | null;
const filterSrc = readFileSync(join(root, 'streams', 'pumpfun-filter.js'), 'utf8');
const main = new Function(`${filterSrc}\nreturn main;`)() as (stream: { data: unknown[] }) => Out;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let id = 0;
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(RPC!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) throw new Error(`${method}: HTTP ${res.status}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }
    const j = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (j.error) {
      // skipped / missing slots are normal on Solana
      if ([-32007, -32009, -32004].includes(j.error.code)) return null as T;
      if (attempt < 3 && /rate|limit/i.test(j.error.message)) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new Error(`${method}: ${j.error.message}`);
    }
    return j.result as T;
  }
}

async function main_() {
  const tip = await rpc<number>('getSlot', [{ commitment: 'finalized' }]);
  const slots = Math.round((MINUTES * 60) / 0.4);
  const from = tip - slots + 1;
  console.log(`capturing mainnet slots ${from}..${tip} (~${MINUTES} min) via QuickNode, concurrency ${CONC}, filter batches of ${BATCH} → ${INGEST}`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.QN_STREAM_TOKEN) headers['x-fairway-token'] = process.env.QN_STREAM_TOKEN;

  const tot = { blocks: 0, skipped: 0, launchTrades: 0, fundings: 0, posts: 0, stored: 0, storedFundings: 0, filterMs: 0, bytes: 0 };
  const t0 = Date.now();
  let next = from;
  const queue: { slot: number; block: unknown }[] = [];
  const fetchOne = async (slot: number) => {
    const b = await rpc<Record<string, unknown> | null>('getBlock', [slot, { encoding: 'json', maxSupportedTransactionVersion: Number(process.env.MAX_TX_VERSION ?? 1), transactionDetails: 'full', rewards: false, commitment: 'finalized' }]);
    if (!b) {
      tot.skipped++;
      return;
    }
    queue.push({ slot, block: { ...b, slot } }); // the Stream's Block dataset includes the slot
    tot.blocks++;
  };
  const flush = async (force = false) => {
    while (queue.length >= BATCH || (force && queue.length)) {
      const part = queue.splice(0, BATCH).sort((a, b) => a.slot - b.slot);
      const f0 = Date.now();
      const out = main({ data: part.map((p) => p.block) });
      tot.filterMs += Date.now() - f0;
      if (!out) continue;
      tot.launchTrades += out.launchTrades?.length ?? 0;
      tot.fundings += out.fundings?.length ?? 0;
      const body = JSON.stringify(out);
      tot.bytes += body.length;
      const p0 = Date.now();
      const res = await fetch(`${INGEST}/streams/solana`, { method: 'POST', headers, body });
      const j = (await res.json().catch(() => ({}))) as { stored?: number; fundings?: { stored?: number }; error?: string };
      if (!res.ok) throw new Error(`ingest answered ${res.status}: ${j.error ?? ''}`);
      tot.posts++;
      tot.stored += j.stored ?? 0;
      tot.storedFundings += j.fundings?.stored ?? 0;
      if (Date.now() - p0 > 2_000) console.warn(`slow ingest response: ${Date.now() - p0} ms`);
    }
  };
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (next <= tip) {
        const s = next++;
        await fetchOne(s);
        await flush();
        if ((tot.blocks + tot.skipped) % 250 === 0) {
          const el = (Date.now() - t0) / 1000;
          console.log(`  ${tot.blocks + tot.skipped}/${slots} slots, ${el.toFixed(0)} s, ${tot.launchTrades} launch trades, ${tot.fundings} fundings, ${tot.stored} stored`);
        }
      }
    }),
  );
  await flush(true);
  console.log(JSON.stringify({ ...tot, seconds: Math.round((Date.now() - t0) / 1000), fromSlot: from, toSlot: tip }, null, 2));
}
main_().catch((e) => {
  console.error('capture failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
