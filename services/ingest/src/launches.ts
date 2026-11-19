/**
 * Launch trades (Pump.fun / PumpSwap via streams/pumpfun-filter.js) and cross-launch sniper scores (M16).
 * Same Postgres-compatible SQL style as db.ts.
 */
import { DEFAULT_SNIPER_CONFIG, scoreSnipers, type LaunchTrade, type SniperConfig, type SniperScore, type Tier } from '@fairway/scoring';
import type { LaunchTradeRecord } from '@fairway/parser';
import { listScores, type Db } from './db';

export const LAUNCH_SCHEMA = `
CREATE TABLE IF NOT EXISTS launch_trades (
  sig           TEXT NOT NULL,
  mint          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  slot          BIGINT NOT NULL,
  ts            DOUBLE PRECISION NOT NULL,
  venue         TEXT NOT NULL,
  trader        TEXT NOT NULL,
  token_amount  DOUBLE PRECISION NOT NULL,
  sol_amount    DOUBLE PRECISION NOT NULL,
  price         DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (sig, mint, kind)
);
CREATE INDEX IF NOT EXISTS launch_trades_mint ON launch_trades (mint, slot);
CREATE TABLE IF NOT EXISTS sniper_scores (
  wallet          TEXT PRIMARY KEY,
  tier            TEXT NOT NULL,
  score_bps       DOUBLE PRECISION NOT NULL,
  launches        INTEGER NOT NULL,
  early_buys      INTEGER NOT NULL,
  notional_sol    DOUBLE PRECISION NOT NULL,
  mean_entry_slot DOUBLE PRECISION NOT NULL
);
`;

const ready = new WeakSet<Db>();
export function ensureLaunchSchema(db: Db): void {
  if (ready.has(db)) return;
  db.exec(LAUNCH_SCHEMA);
  ready.add(db);
}

export function validLaunchTrade(t: any): t is LaunchTradeRecord {
  return (
    !!t &&
    typeof t.sig === 'string' &&
    typeof t.mint === 'string' &&
    typeof t.trader === 'string' &&
    (t.kind === 'create' || t.kind === 'buy' || t.kind === 'sell') &&
    Number.isFinite(t.slot) &&
    Number.isFinite(t.solAmount) &&
    Number.isFinite(t.tokenAmount) &&
    Number.isFinite(t.price)
  );
}

export function upsertLaunchTrades(db: Db, trades: readonly LaunchTradeRecord[]): number {
  ensureLaunchSchema(db);
  const st = db.prepare(
    `INSERT INTO launch_trades (sig, mint, kind, slot, ts, venue, trader, token_amount, sol_amount, price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (sig, mint, kind) DO NOTHING`,
  );
  let n = 0;
  db.transaction(() => {
    for (const t of trades) n += st.run(t.sig, t.mint, t.kind, t.slot, t.ts ?? 0, t.venue, t.trader, t.tokenAmount, t.solAmount, t.price).changes;
  })();
  return n;
}

export function allLaunchTrades(db: Db): LaunchTrade[] {
  ensureLaunchSchema(db);
  return (db.prepare('SELECT sig, slot, mint, trader, kind, token_amount, sol_amount, price FROM launch_trades ORDER BY slot').all() as any[]).map((r) => ({
    sig: r.sig,
    slot: Number(r.slot),
    mint: r.mint,
    trader: r.trader,
    kind: r.kind,
    tokenAmount: r.token_amount,
    solAmount: r.sol_amount,
    price: r.price,
  }));
}

/** Recompute all sniper scores (cheap: launch trades are few compared with swaps). */
export function recomputeSnipers(db: Db, cfg: SniperConfig = DEFAULT_SNIPER_CONFIG): { wallets: number; toxic: number } {
  const scores = scoreSnipers(allLaunchTrades(db), cfg);
  const st = db.prepare(
    `INSERT INTO sniper_scores (wallet, tier, score_bps, launches, early_buys, notional_sol, mean_entry_slot) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (wallet) DO UPDATE SET tier = excluded.tier, score_bps = excluded.score_bps, launches = excluded.launches,
       early_buys = excluded.early_buys, notional_sol = excluded.notional_sol, mean_entry_slot = excluded.mean_entry_slot`,
  );
  db.transaction(() => {
    db.prepare('DELETE FROM sniper_scores').run();
    for (const s of scores) st.run(s.wallet, s.tier, s.scoreBps, s.launches, s.earlyBuys, s.notionalSol, s.meanEntrySlot);
  })();
  return { wallets: scores.length, toxic: scores.filter((s) => s.tier === 'TOXIC').length };
}

export function listSnipers(db: Db, opts: { tier?: Tier; limit?: number } = {}): SniperScore[] {
  ensureLaunchSchema(db);
  const rows = (opts.tier
    ? db.prepare('SELECT * FROM sniper_scores WHERE tier = ? ORDER BY score_bps DESC LIMIT ?').all(opts.tier, opts.limit ?? 500)
    : db.prepare('SELECT * FROM sniper_scores ORDER BY score_bps DESC LIMIT ?').all(opts.limit ?? 500)) as any[];
  return rows.map((r) => ({ wallet: r.wallet, tier: r.tier, scoreBps: r.score_bps, launches: r.launches, earlyBuys: r.early_buys, notionalSol: r.notional_sol, meanEntrySlot: r.mean_entry_slot }));
}

export function getSniper(db: Db, wallet: string): SniperScore | null {
  ensureLaunchSchema(db);
  const r = db.prepare('SELECT * FROM sniper_scores WHERE wallet = ?').get(wallet) as any;
  return r ? { wallet: r.wallet, tier: r.tier, scoreBps: r.score_bps, launches: r.launches, earlyBuys: r.early_buys, notionalSol: r.notional_sol, meanEntrySlot: r.mean_entry_slot } : null;
}

export type Desired = { trader: string; tier: Tier; scoreBps: number; trades: number; source: 'markout' | 'launch-sniper' };

/**
 * What the keeper should write: markout scores, with launch-sniper TOXIC taking precedence (a wallet that repeatedly
 * snipes launches pays the sniper fee even if its liquid-pair flow looks retail). score_bps is clamped to i32 range.
 */
export function desiredScores(db: Db): Desired[] {
  const out = new Map<string, Desired>();
  for (const s of listScores(db, { limit: 100_000 })) out.set(s.trader, { trader: s.trader, tier: s.tier, scoreBps: s.scoreBps, trades: s.trades, source: 'markout' });
  for (const s of listSnipers(db, { tier: 'TOXIC', limit: 100_000 })) {
    out.set(s.wallet, { trader: s.wallet, tier: 'TOXIC', scoreBps: Math.min(2_000_000_000, Math.round(s.scoreBps)), trades: s.earlyBuys, source: 'launch-sniper' });
  }
  return [...out.values()];
}
