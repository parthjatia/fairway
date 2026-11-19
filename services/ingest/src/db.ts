/**
 * Storage layer. SQLite via better-sqlite3; the SQL is kept Postgres-compatible
 * (standard types, ON CONFLICT upserts, no SQLite-only functions) so it can move to Postgres as-is.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Swap, Tier, WalletScore } from '@fairway/scoring';

export type Db = Database.Database;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS swaps (
  sig           TEXT NOT NULL,
  pool          TEXT NOT NULL,
  slot          BIGINT NOT NULL,
  ts            DOUBLE PRECISION NOT NULL,
  venue         TEXT NOT NULL,
  trader        TEXT NOT NULL,
  side          TEXT NOT NULL,
  base_amount   DOUBLE PRECISION NOT NULL,
  quote_amount  DOUBLE PRECISION NOT NULL,
  exec_price    DOUBLE PRECISION NOT NULL,
  fee_bps       INTEGER,
  tier          TEXT,
  source        TEXT,
  ingested_at   DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (sig, pool)
);
CREATE INDEX IF NOT EXISTS swaps_trader ON swaps (trader, ts);
CREATE INDEX IF NOT EXISTS swaps_pool ON swaps (pool, ts);

CREATE TABLE IF NOT EXISTS wallet_scores (
  trader          TEXT PRIMARY KEY,
  tier            TEXT NOT NULL,
  score_bps       DOUBLE PRECISION NOT NULL,
  max_score_bps   DOUBLE PRECISION NOT NULL,
  trades          INTEGER NOT NULL,
  total_notional  DOUBLE PRECISION NOT NULL,
  first_seen      DOUBLE PRECISION NOT NULL,
  last_seen       DOUBLE PRECISION NOT NULL,
  history_days    DOUBLE PRECISION NOT NULL,
  by_horizon      TEXT NOT NULL,
  updated_at      DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS wallet_scores_tier ON wallet_scores (tier);

CREATE TABLE IF NOT EXISTS deliveries (
  id           INTEGER PRIMARY KEY,
  received_at  DOUBLE PRECISION NOT NULL,
  kind         TEXT NOT NULL,
  received     INTEGER NOT NULL,
  stored       INTEGER NOT NULL
);
`;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

type SwapRow = {
  sig: string;
  pool: string;
  slot: number;
  ts: number;
  venue: Swap['venue'];
  trader: string;
  side: Swap['side'];
  base_amount: number;
  quote_amount: number;
  exec_price: number;
  fee_bps: number | null;
  tier: Tier | null;
  source: string | null;
};

const rowToSwap = (r: SwapRow): Swap & { source?: string } => ({
  sig: r.sig,
  slot: r.slot,
  ts: r.ts,
  pool: r.pool,
  venue: r.venue,
  trader: r.trader,
  side: r.side,
  baseAmount: r.base_amount,
  quoteAmount: r.quote_amount,
  execPrice: r.exec_price,
  ...(r.fee_bps !== null ? { feeBps: r.fee_bps } : {}),
  ...(r.tier ? { tier: r.tier } : {}),
  ...(r.source ? { source: r.source } : {}),
});

const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Basic shape validation of an incoming record (defence against malformed payloads). */
export function validSwap(s: any): s is Swap {
  return (
    s &&
    typeof s.sig === 'string' &&
    typeof s.pool === 'string' &&
    typeof s.trader === 'string' &&
    (s.side === 'buy' || s.side === 'sell') &&
    isFiniteNum(s.slot) &&
    isFiniteNum(s.ts) &&
    isFiniteNum(s.baseAmount) &&
    s.baseAmount > 0 &&
    isFiniteNum(s.quoteAmount) &&
    s.quoteAmount > 0 &&
    isFiniteNum(s.execPrice) &&
    s.execPrice > 0
  );
}

/** Idempotent insert on (sig, pool). Returns the number of NEW rows and the affected traders. */
export function upsertSwaps(db: Db, swaps: ReadonlyArray<Swap & { source?: string }>): { stored: number; traders: string[] } {
  const stmt = db.prepare(`
    INSERT INTO swaps (sig, pool, slot, ts, venue, trader, side, base_amount, quote_amount, exec_price, fee_bps, tier, source, ingested_at)
    VALUES (@sig, @pool, @slot, @ts, @venue, @trader, @side, @baseAmount, @quoteAmount, @execPrice, @feeBps, @tier, @source, @now)
    ON CONFLICT (sig, pool) DO NOTHING`);
  const now = Date.now() / 1000;
  const traders = new Set<string>();
  let stored = 0;
  db.transaction(() => {
    for (const s of swaps) {
      const r = stmt.run({ ...s, feeBps: s.feeBps ?? null, tier: s.tier ?? null, source: s.source ?? null, venue: s.venue ?? 'fixture', now });
      if (r.changes > 0) {
        stored++;
        traders.add(s.trader);
      }
    }
  })();
  return { stored, traders: [...traders] };
}

export const countSwaps = (db: Db): number => (db.prepare('SELECT COUNT(*) AS n FROM swaps').get() as { n: number }).n;

export function allSwaps(db: Db): Array<Swap & { source?: string }> {
  return (db.prepare('SELECT * FROM swaps ORDER BY slot, sig').all() as SwapRow[]).map(rowToSwap);
}

export function swapsForTraders(db: Db, traders: string[]): Swap[] {
  if (!traders.length) return [];
  const out: Swap[] = [];
  const stmt = db.prepare('SELECT * FROM swaps WHERE trader = ? ORDER BY ts');
  for (const t of traders) for (const r of stmt.all(t) as SwapRow[]) out.push(rowToSwap(r));
  return out;
}

export function swapsOfTrader(db: Db, trader: string, limit = 500): Swap[] {
  return (db.prepare('SELECT * FROM swaps WHERE trader = ? ORDER BY ts DESC LIMIT ?').all(trader, limit) as SwapRow[]).map(rowToSwap);
}

export function swapsOfPool(db: Db, pool: string): Swap[] {
  return (db.prepare('SELECT * FROM swaps WHERE pool = ? ORDER BY ts').all(pool) as SwapRow[]).map(rowToSwap);
}

export const maxTs = (db: Db): number => (db.prepare('SELECT MAX(ts) AS t FROM swaps').get() as { t: number | null }).t ?? 0;

export function saveScores(db: Db, scores: WalletScore[]): void {
  const stmt = db.prepare(`
    INSERT INTO wallet_scores (trader, tier, score_bps, max_score_bps, trades, total_notional, first_seen, last_seen, history_days, by_horizon, updated_at)
    VALUES (@trader, @tier, @scoreBps, @maxScoreBps, @trades, @totalNotional, @firstSeen, @lastSeen, @historyDays, @byHorizon, @now)
    ON CONFLICT (trader) DO UPDATE SET
      tier = excluded.tier, score_bps = excluded.score_bps, max_score_bps = excluded.max_score_bps, trades = excluded.trades,
      total_notional = excluded.total_notional, first_seen = excluded.first_seen, last_seen = excluded.last_seen,
      history_days = excluded.history_days, by_horizon = excluded.by_horizon, updated_at = excluded.updated_at`);
  const now = Date.now() / 1000;
  db.transaction(() => {
    for (const s of scores) stmt.run({ ...s, byHorizon: JSON.stringify(s.byHorizon), now });
  })();
}

type ScoreRow = {
  trader: string;
  tier: Tier;
  score_bps: number;
  max_score_bps: number;
  trades: number;
  total_notional: number;
  first_seen: number;
  last_seen: number;
  history_days: number;
  by_horizon: string;
  updated_at: number;
};

const rowToScore = (r: ScoreRow): WalletScore & { updatedAt: number } => ({
  trader: r.trader,
  tier: r.tier,
  scoreBps: r.score_bps,
  maxScoreBps: r.max_score_bps,
  trades: r.trades,
  totalNotional: r.total_notional,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
  historyDays: r.history_days,
  byHorizon: JSON.parse(r.by_horizon),
  updatedAt: r.updated_at,
});

export function getScore(db: Db, trader: string): (WalletScore & { updatedAt: number }) | null {
  const r = db.prepare('SELECT * FROM wallet_scores WHERE trader = ?').get(trader) as ScoreRow | undefined;
  return r ? rowToScore(r) : null;
}

export function listScores(db: Db, opts: { tier?: Tier; limit?: number; offset?: number } = {}): Array<WalletScore & { updatedAt: number }> {
  const limit = Math.min(opts.limit ?? 100, 10_000);
  const offset = opts.offset ?? 0;
  const rows = opts.tier
    ? db.prepare('SELECT * FROM wallet_scores WHERE tier = ? ORDER BY total_notional DESC LIMIT ? OFFSET ?').all(opts.tier, limit, offset)
    : db.prepare('SELECT * FROM wallet_scores ORDER BY total_notional DESC LIMIT ? OFFSET ?').all(limit, offset);
  return (rows as ScoreRow[]).map(rowToScore);
}

export function tierCounts(db: Db): Record<Tier, number> {
  const out: Record<Tier, number> = { RETAIL: 0, STANDARD: 0, TOXIC: 0 };
  for (const r of db.prepare('SELECT tier, COUNT(*) AS n FROM wallet_scores GROUP BY tier').all() as Array<{ tier: Tier; n: number }>) out[r.tier] = r.n;
  return out;
}

export function logDelivery(db: Db, kind: string, received: number, stored: number): void {
  db.prepare('INSERT INTO deliveries (received_at, kind, received, stored) VALUES (?, ?, ?, ?)').run(Date.now() / 1000, kind, received, stored);
}

export function lastDeliveries(db: Db, n = 10): Array<{ received_at: number; kind: string; received: number; stored: number }> {
  return db.prepare('SELECT received_at, kind, received, stored FROM deliveries ORDER BY id DESC LIMIT ?').all(n) as never;
}
