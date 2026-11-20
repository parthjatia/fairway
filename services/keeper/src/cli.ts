/**
 * Fairway keeper: scores DB → batched `set_scores_batch` transactions.
 *   KEEPER_MODE=dry-run (default)  logs exact intended instructions to services/keeper/out/ and updates a local mirror
 *   KEEPER_MODE=local              local validator (RPC_URL default http://127.0.0.1:8899)
 *   KEEPER_MODE=devnet             needs RPC_URL and KEEPER_KEYPAIR
 * Flags: --watch <seconds>  re-run periodically
 */
try { process.loadEnvFile(new URL('../../../.env.local', import.meta.url)); } catch { /* no local env file */ }
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createContext, desiredScores, REPO_ROOT } from '@fairway/ingest';
import { PROGRAM_ID } from '@fairway/sdk';
import { runKeeper } from './keeper';
import { DryRunSender, RpcSender } from './senders';
import { MirrorStore, RpcStore } from './stores';

const mode = (process.env.KEEPER_MODE || 'dry-run') as 'dry-run' | 'local' | 'devnet';
const OUT = join(REPO_ROOT, 'services', 'keeper', 'out');
const programId = process.env.FAIRWAY_PROGRAM_ID ? new PublicKey(process.env.FAIRWAY_PROGRAM_ID) : PROGRAM_ID;
const opts = {
  batchSize: Number(process.env.KEEPER_BATCH_SIZE || 8),
  maxTps: Number(process.env.KEEPER_MAX_TPS || 4),
  retries: Number(process.env.KEEPER_RETRIES || 3),
  backoffMs: Number(process.env.KEEPER_BACKOFF_MS || 500),
};

function loadKeypair(path: string): Keypair {
  const p = path.startsWith('/') ? path : join(REPO_ROOT, path);
  if (!existsSync(p)) throw new Error(`KEEPER_KEYPAIR not found at ${p}. Generate a throwaway one: solana-keygen new -o .keys/score-authority.json`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
}

async function once() {
  const ctx = createContext(process.env);
  // markout scores + launch-sniper TOXIC (M16)
  const desired = desiredScores(ctx.db).map(({ source: _s, ...d }) => d);
  if (mode === 'dry-run') {
    const store = new MirrorStore(join(OUT, 'mirror.json'));
    let authority: PublicKey;
    try {
      authority = loadKeypair(process.env.KEEPER_KEYPAIR || '.keys/score-authority.json').publicKey;
    } catch {
      authority = new PublicKey('11111111111111111111111111111111'); // dry-run doesn't sign
    }
    const sender = new DryRunSender(OUT, authority, programId);
    const rep = await runKeeper(desired, store, sender, { ...opts, maxTps: 1000 });
    store.apply(rep.batches.filter((b) => !b.error).flatMap((b) => b.items));
    store.advance(10n);
    store.save();
    console.log(`dry-run: ${rep.updates} updates in ${rep.batches.length} batches → ${rep.batches.length ? sender.file : '(nothing to do)'}; mirror has ${store.size} scores`);
    return rep;
  }
  const rpcUrl = process.env.RPC_URL || (mode === 'local' ? 'http://127.0.0.1:8899' : process.env.DEVNET_RPC_URL || '');
  if (!rpcUrl) throw new Error('KEEPER_MODE=devnet needs RPC_URL or DEVNET_RPC_URL (e.g. your QuickNode devnet endpoint)');
  const connection = new Connection(rpcUrl, 'confirmed');
  const authority = loadKeypair(process.env.KEEPER_KEYPAIR || '.keys/score-authority.json');
  const rep = await runKeeper(desired, new RpcStore(connection, programId), new RpcSender(connection, authority, programId), opts);
  console.log(`${mode}: ${rep.updates} updates, ${rep.batches.length - rep.failed} batches ok, ${rep.failed} failed`);
  return rep;
}

const watchIdx = process.argv.indexOf('--watch');
const every = watchIdx >= 0 ? Number(process.argv[watchIdx + 1] || 30) : 0;
const loop = async () => {
  try {
    const rep = await once();
    if (!every) process.exit(rep.failed ? 1 : 0);
  } catch (e) {
    console.error(`keeper error: ${(e as Error).message}`);
    if (!every) process.exit(1);
  }
  if (every) setTimeout(loop, every * 1000);
};
void loop();
