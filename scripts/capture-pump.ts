/**
 * Fallback for the live Stream: replays recent Solana MAINNET blocks through the SAME QuickNode Streams filter
 * (streams/launch-filter.js and streams/filter.js, loaded as-is) and POSTs its output to the ingest webhook exactly like the Stream would
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
const loadFilter = <T>(file: string) => new Function(`${readFileSync(join(root, 'streams', file), 'utf8')}\nreturn main;`)() as (stream: { data: unknown[] }) => T;
const main = loadFilter<Out>('launch-filter.js'); // Pump.fun, PumpSwap, LaunchLab, Meteora DBC + fundings
const swapMain = loadFilter<{ swaps?: unknown[] } | null>('filter.js'); // Raydium SOL-USDC swaps (wallet markouts from normal DEX trading)
const LL = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';
const DBC = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
/** census of the instruction each launchpad program logs first, to verify create names on real blocks */
const instr: Record<string, Record<string, number>> = { launchlab: {}, 'meteora-dbc': {} };
const perVenue: Record<string, number> = {};
let fatal: string | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let id = 0;
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(RPC!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    if (res.status === 402 || res.status === 403) {
      fatal = `HTTP ${res.status} from the QuickNode endpoint (credit or plan limit)`;
      return null as T;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) throw new Error(`${method}: HTTP ${res.status}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }
    const j = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (j.error) {
      // skipped / missing slots are normal on Solana
      if ([-32007, -32009, -32004].includes(j.error.code)) return null as T;
      if (/credit|quota|exceed|plan|upgrade/i.test(j.error.message)) {
        fatal = `QuickNode: ${j.error.message}`;
        return null as T;
      }
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

  const tot = { swaps: 0, storedSwaps: 0, blocks: 0, skipped: 0, launchTrades: 0, fundings: 0, posts: 0, stored: 0, storedFundings: 0, filterMs: 0, bytes: 0 };
  const t0 = Date.now();
  let next = from;
  const queue: { slot: number; block: unknown }[] = [];
  const fetchOne = async (slot: number) => {
    const b = await rpc<Record<string, unknown> | null>('getBlock', [slot, { encoding: 'json', maxSupportedTransactionVersion: Number(process.env.MAX_TX_VERSION ?? 1), transactionDetails: 'full', rewards: false, commitment: 'finalized' }]);
    if (!b) {
      tot.skipped++;
      return;
    }
    for (const tx of (b.transactions as any[]) || []) {
      const lg: string[] = tx.meta?.logMessages || [];
      for (const [venue, id] of [['launchlab', LL], ['meteora-dbc', DBC]] as const)
        for (let i = 0; i < lg.length - 1; i++)
          if (lg[i]!.startsWith(`Program ${id} invoke`) && lg[i + 1]!.startsWith('Program log: Instruction: ')) {
            const n = lg[i + 1]!.slice(26);
            instr[venue]![n] = (instr[venue]![n] || 0) + 1;
          }
    }
    queue.push({ slot, block: { ...b, slot } }); // the Stream's Block dataset includes the slot
    tot.blocks++;
  };
  const flush = async (force = false) => {
    while (queue.length >= BATCH || (force && queue.length)) {
      const part = queue.splice(0, BATCH).sort((a, b) => a.slot - b.slot);
      const f0 = Date.now();
      const data = part.map((p) => p.block);
      const out = main({ data });
      const sw = swapMain({ data });
      tot.filterMs += Date.now() - f0;
      if (sw && sw.swaps && sw.swaps.length) {
        tot.swaps += sw.swaps.length;
        const r = await fetch(`${INGEST}/streams/solana`, { method: 'POST', headers, body: JSON.stringify(sw) });
        const jj = (await r.json().catch(() => ({}))) as { stored?: number };
        if (r.ok) tot.storedSwaps += jj.stored ?? 0;
      }
      if (!out) continue;
      for (const t of (out.launchTrades || []) as { venue: string; kind: string }[]) perVenue[`${t.venue}/${t.kind}`] = (perVenue[`${t.venue}/${t.kind}`] || 0) + 1;
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
      while (next <= tip && !fatal) {
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
  if (fatal) console.warn(`stopped early, cleanly: ${fatal}`);
  console.log(JSON.stringify({ perVenue, launchpadInstructions: instr, stoppedEarly: fatal, ...tot, seconds: Math.round((Date.now() - t0) / 1000), fromSlot: from, toSlot: tip }, null, 2));
}
main_().catch((e) => {
  console.error('capture failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
