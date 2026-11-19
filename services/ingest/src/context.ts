import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureMids } from '@fairway/fixtures';
import { loadDataset } from '@fairway/fixtures/node';
import { toParserPools, type ParserPool } from '@fairway/parser';
import { countSwaps, openDb, upsertSwaps, type Db } from './db';
import { poolImpliedSource, recompute, type MidSource } from './recompute';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export type IngestContext = {
  db: Db;
  pools: ParserPool[];
  mids: MidSource;
  mode: 'fixture' | 'live';
  labels: Record<string, string>;
  token?: string;
};

export type ContextEnv = {
  DATA_MODE?: string;
  INGEST_DB_PATH?: string;
  QN_STREAM_TOKEN?: string;
  POOLS_CONFIG?: string;
};

export function loadPoolsConfig(path: string): ParserPool[] {
  if (!existsSync(path)) return [];
  const j = JSON.parse(readFileSync(path, 'utf8')) as { pools: Array<ParserPool & { label?: string }> };
  return j.pools.filter((p) => !p.baseVault.startsWith('<')).map(({ label: _l, ...p }) => p);
}

/**
 * Build the service context. DATA_MODE=fixture (default) seeds the DB from the synthetic fixtures at boot
 * and uses the simulated CEX path for markouts, so everything works offline.
 */
export function createContext(env: ContextEnv = process.env): IngestContext {
  const mode = env.DATA_MODE === 'live' ? 'live' : 'fixture';
  const dbPath = env.INGEST_DB_PATH || join(REPO_ROOT, 'services', 'ingest', 'data', mode === 'fixture' ? 'fixture.db' : 'fairway.db');
  const db = openDb(dbPath);
  const livePools = loadPoolsConfig(env.POOLS_CONFIG || join(REPO_ROOT, 'streams', 'pools.config.json'));
  if (mode === 'live') {
    return { db, pools: livePools, mids: poolImpliedSource(db), mode, labels: {}, token: env.QN_STREAM_TOKEN || undefined };
  }
  const ds = loadDataset();
  const mids: MidSource = { name: 'fixture-cex', provider: () => fixtureMids(ds.cex) };
  if (countSwaps(db) === 0) {
    upsertSwaps(db, ds.swaps);
    recompute(db, mids);
  }
  const labels: Record<string, string> = {};
  for (const p of ds.meta.personas) labels[p.address] = p.name;
  return { db, pools: [...toParserPools(ds.meta.pools), ...livePools], mids, mode, labels, token: env.QN_STREAM_TOKEN || undefined };
}
