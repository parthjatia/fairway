/**
 * Launch trades (Pump.fun / PumpSwap via streams/pumpfun-filter.js) and cross-launch sniper scores (M16).
 * Same Postgres-compatible SQL style as db.ts.
 */
import {
  bundleTier,
  DEFAULT_BUNDLE_CONFIG,
  DEFAULT_SNIPER_CONFIG,
  detectBundles,
  scoreSnipers,
  type BundleConfig,
  type BundleReport,
  type LaunchTrade,
  type SniperConfig,
  type SniperScore,
  type Tier,
} from '@fairway/scoring';
import type { FundingRecord, LaunchTradeRecord } from '@fairway/parser';
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
CREATE TABLE IF NOT EXISTS fundings (
  sig     TEXT NOT NULL,
  wallet  TEXT NOT NULL,
  funder  TEXT NOT NULL,
  slot    BIGINT NOT NULL,
  ts      DOUBLE PRECISION NOT NULL,
  sol     DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (sig, wallet)
);
CREATE INDEX IF NOT EXISTS fundings_wallet ON fundings (wallet, slot);
CREATE TABLE IF NOT EXISTS bundle_flags (
  wallet  TEXT PRIMARY KEY,
  funder  TEXT NOT NULL,
  reason  TEXT NOT NULL,
  mint    TEXT,
  slot    BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS bundle_funders (
  funder        TEXT PRIMARY KEY,
  launches      INTEGER NOT NULL,
  wallets       INTEGER NOT NULL,
  known_bundler BOOLEAN NOT NULL
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

// ---- bundle detection (M16 step 11): fundings of brand-new wallets from the same Stream L

export function validFunding(f: any): f is FundingRecord {
  return !!f && typeof f.sig === 'string' && typeof f.wallet === 'string' && typeof f.funder === 'string' && Number.isFinite(f.slot) && Number.isFinite(f.sol) && f.sol > 0;
}

export function upsertFundings(db: Db, fundings: readonly FundingRecord[]): number {
  ensureLaunchSchema(db);
  const st = db.prepare(`INSERT INTO fundings (sig, wallet, funder, slot, ts, sol) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (sig, wallet) DO NOTHING`);
  let n = 0;
  db.transaction(() => {
    for (const f of fundings) n += st.run(f.sig, f.wallet, f.funder, f.slot, f.ts ?? 0, f.sol).changes;
  })();
  return n;
}

export function allFundings(db: Db): FundingRecord[] {
  ensureLaunchSchema(db);
  return (db.prepare('SELECT sig, wallet, funder, slot, ts, sol FROM fundings ORDER BY slot').all() as any[]).map((r) => ({ sig: r.sig, wallet: r.wallet, funder: r.funder, slot: Number(r.slot), ts: r.ts, sol: r.sol }));
}

/** Recompute bundles, flags and funder stats from all launch trades + fundings. */
export function recomputeBundles(db: Db, cfg: BundleConfig = DEFAULT_BUNDLE_CONFIG): { bundles: number; flagged: number; knownBundlers: number; report: BundleReport } {
  const report = detectBundles(allLaunchTrades(db), allFundings(db), cfg);
  const fl = db.prepare('INSERT INTO bundle_flags (wallet, funder, reason, mint, slot) VALUES (?, ?, ?, ?, ?)');
  const fu = db.prepare('INSERT INTO bundle_funders (funder, launches, wallets, known_bundler) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM bundle_flags').run();
    db.prepare('DELETE FROM bundle_funders').run();
    for (const f of report.flags) fl.run(f.wallet, f.funder, f.reason, f.mint, f.slot);
    for (const f of report.funders) fu.run(f.funder, f.launches, f.wallets, f.knownBundler ? 1 : 0);
  })();
  return { bundles: report.bundles.length, flagged: report.flags.length, knownBundlers: report.funders.filter((f) => f.knownBundler).length, report };
}

export function listBundleFlags(db: Db): { wallet: string; funder: string; reason: string; mint: string | null; slot: number; funderKnownBundler: boolean }[] {
  ensureLaunchSchema(db);
  return (
    db
      .prepare('SELECT f.wallet, f.funder, f.reason, f.mint, f.slot, COALESCE(b.known_bundler, 0) AS known FROM bundle_flags f LEFT JOIN bundle_funders b ON b.funder = f.funder ORDER BY f.slot, f.wallet')
      .all() as any[]
  ).map((r) => ({ wallet: r.wallet, funder: r.funder, reason: r.reason, mint: r.mint ?? null, slot: Number(r.slot), funderKnownBundler: !!r.known }));
}

export function listBundleFunders(db: Db): { funder: string; launches: number; wallets: number; knownBundler: boolean }[] {
  ensureLaunchSchema(db);
  return (db.prepare('SELECT * FROM bundle_funders ORDER BY launches DESC, funder').all() as any[]).map((r) => ({ funder: r.funder, launches: r.launches, wallets: r.wallets, knownBundler: !!r.known_bundler }));
}

export type Desired = { trader: string; tier: Tier; scoreBps: number; trades: number; source: 'markout' | 'launch-sniper' | 'bundle' };

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
  // bundle flags only ever RAISE a tier: at least STANDARD (no RETAIL for a bundle wallet), TOXIC when the funder is a
  // known bundler or a TOXIC sniper. A flagged fresh wallet that stays STANDARD needs no account (unknown = STANDARD).
  const toxicSnipers = new Set(listSnipers(db, { tier: 'TOXIC', limit: 100_000 }).map((s) => s.wallet));
  for (const f of listBundleFlags(db)) {
    const cur = out.get(f.wallet);
    const tier = bundleTier(cur?.tier ?? 'STANDARD', f.funderKnownBundler, toxicSnipers.has(f.funder) ? 'TOXIC' : 'STANDARD');
    if (cur ? tier === cur.tier : tier === 'STANDARD') continue;
    out.set(f.wallet, { trader: f.wallet, tier, scoreBps: cur?.scoreBps ?? 0, trades: cur?.trades ?? 0, source: 'bundle' });
  }
  return [...out.values()];
}
