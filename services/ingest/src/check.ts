/**
 * Fairway Check (M18) on the ingest DB: token and wallet fairness reports from the stored launch trades, the stored
 * cross-launch sniper scores and the stored bundle flags (so a request never re-scores the whole history).
 */
import { buildTokenCheck, checkWallet, DEFAULT_CHECK_CONFIG, emptyTokenCheck, launchSlotOf, type CheckConfig, type LaunchTrade, type SniperScore, type TokenCheck, type WalletCheck } from '@fairway/scoring';
import type { Db } from './db';
import { ensureLaunchSchema, getSniper } from './launches';

type Row = { sig: string; slot: number; mint: string; trader: string; kind: LaunchTrade['kind']; token_amount: number; sol_amount: number; price: number };
const toTrade = (r: Row): LaunchTrade => ({ sig: r.sig, slot: Number(r.slot), mint: r.mint, trader: r.trader, kind: r.kind, tokenAmount: r.token_amount, solAmount: r.sol_amount, price: r.price });
const COLS = 'sig, slot, mint, trader, kind, token_amount, sol_amount, price';

function chunks<T>(xs: readonly T[], n = 400): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function tradesOfMint(db: Db, mint: string): LaunchTrade[] {
  ensureLaunchSchema(db);
  return (db.prepare(`SELECT ${COLS} FROM launch_trades WHERE mint = ? ORDER BY slot`).all(mint) as Row[]).map(toTrade);
}

/** wallets (of `wallets`) that are TOXIC by the stored scores or funded by a known bundler */
function labelsOf(db: Db, wallets: readonly string[]): { snipers: Map<string, SniperScore>; bundled: Set<string> } {
  const snipers = new Map<string, SniperScore>();
  const bundled = new Set<string>();
  for (const part of chunks(wallets)) {
    const q = part.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT * FROM sniper_scores WHERE wallet IN (${q})`).all(...part) as any[]) {
      snipers.set(r.wallet, { wallet: r.wallet, tier: r.tier, scoreBps: r.score_bps, launches: r.launches, earlyBuys: r.early_buys, notionalSol: r.notional_sol, meanEntrySlot: r.mean_entry_slot });
    }
    for (const r of db.prepare(`SELECT f.wallet FROM bundle_flags f JOIN bundle_funders b ON b.funder = f.funder WHERE b.known_bundler = 1 AND f.wallet IN (${q})`).all(...part) as any[]) bundled.add(r.wallet);
  }
  return { snipers, bundled };
}

/** Where a token launched: Pump.fun / PumpSwap are one family; LaunchLab (LetsBonk) and Meteora DBC (Bags, Jupiter Studio, Believe) are their own. */
export type LaunchVenue = 'pumpfun' | 'launchlab' | 'meteora-dbc';
export function venueOfMint(db: Db, mint: string): LaunchVenue | null {
  const r = db.prepare("SELECT venue FROM launch_trades WHERE mint = ? ORDER BY (kind = 'create') DESC, slot LIMIT 1").get(mint) as { venue: string } | undefined;
  if (!r) return null;
  return r.venue === 'launchlab' || r.venue === 'meteora-dbc' ? r.venue : 'pumpfun';
}

export function checkTokenFromDb(db: Db, mint: string, cfg: CheckConfig = DEFAULT_CHECK_CONFIG): TokenCheck & { venue?: LaunchVenue } {
  const base = checkTokenCore(db, mint, cfg);
  const venue = venueOfMint(db, mint);
  return venue ? { ...base, venue } : base;
}

function checkTokenCore(db: Db, mint: string, cfg: CheckConfig): TokenCheck {
  const trades = tradesOfMint(db, mint);
  const launchSlot = launchSlotOf(trades, mint);
  if (launchSlot === null) return emptyTokenCheck(mint, cfg);
  const wallets = [...new Set(trades.filter((t) => t.kind === 'buy' && t.slot - launchSlot <= cfg.earlyWindowSlots).map((t) => t.trader))];
  const { snipers, bundled } = labelsOf(db, wallets);
  const history = new Set<string>();
  for (const part of chunks(wallets)) {
    const q = part.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT DISTINCT trader FROM launch_trades WHERE mint != ? AND slot < ? AND trader IN (${q})`).all(mint, launchSlot, ...part) as any[]) history.add(r.trader);
  }
  return buildTokenCheck(
    {
      mint,
      launchSlot,
      trades: trades.filter((t) => t.kind !== 'create').map((t) => ({ wallet: t.trader, slot: t.slot, kind: t.kind as 'buy' | 'sell', tokens: t.tokenAmount, sol: t.solAmount })),
      tierOf: (w) => (snipers.get(w)?.tier === 'TOXIC' || bundled.has(w) ? 'TOXIC' : 'STANDARD'),
      bundleOf: (w) => bundled.has(w),
      hadHistory: (w) => history.has(w),
    },
    cfg,
  );
}

/** Trades behind a wallet's rating, per venue: launchpads (launch_trades) and normal DEX swaps (Raydium SOL-USDC markouts). */
export function venuesOfWallet(db: Db, wallet: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of db.prepare("SELECT venue, COUNT(*) AS n FROM launch_trades WHERE trader = ? AND kind != 'create' GROUP BY venue").all(wallet) as { venue: string; n: number }[]) {
    const v = r.venue === 'launchlab' || r.venue === 'meteora-dbc' ? r.venue : 'pumpfun';
    out[v] = (out[v] || 0) + Number(r.n);
  }
  try {
    for (const r of db.prepare('SELECT venue, COUNT(*) AS n FROM swaps WHERE trader = ? GROUP BY venue').all(wallet) as { venue: string; n: number }[]) out[r.venue] = (out[r.venue] || 0) + Number(r.n);
  } catch {
    /* swaps table not created yet */
  }
  return out;
}

export function checkWalletFromDb(db: Db, wallet: string): WalletCheck & { venues: Record<string, number> } {
  return { ...checkWalletCore(db, wallet), venues: venuesOfWallet(db, wallet) };
}

function checkWalletCore(db: Db, wallet: string): WalletCheck {
  ensureLaunchSchema(db);
  const mints = (db.prepare("SELECT DISTINCT mint FROM launch_trades WHERE trader = ? AND kind != 'create'").all(wallet) as any[]).map((r) => r.mint as string);
  const trades: LaunchTrade[] = [];
  for (const part of chunks(mints)) {
    const q = part.map(() => '?').join(',');
    trades.push(...(db.prepare(`SELECT ${COLS} FROM launch_trades WHERE mint IN (${q}) ORDER BY slot`).all(...part) as Row[]).map(toTrade));
  }
  const { bundled } = labelsOf(db, [wallet]);
  const s = getSniper(db, wallet);
  return checkWallet(trades, wallet, { snipers: new Map(s ? [[wallet, s]] : []), bundled });
}

/** The most recent launches with their grade: example chips and the /check index. */
export function listTokenChecks(db: Db, limit = 12, cfg: CheckConfig = DEFAULT_CHECK_CONFIG, venue?: string): TokenCheck[] {
  ensureLaunchSchema(db);
  // real launches first: the Pump.fun, LaunchLab or Meteora DBC create was captured (PumpSwap "create" is a new pool for an existing token) and the early window has fully elapsed (so the report is complete),
  // newest first; then any other mints (e.g. tokens created before the capture began) to fill the list
  const tip = (db.prepare('SELECT MAX(slot) AS s FROM launch_trades').get() as { s: number | null }).s ?? 0;
  const venues = venue === 'launchlab' || venue === 'meteora-dbc' || venue === 'pumpfun' ? [venue] : ['pumpfun', 'launchlab', 'meteora-dbc'];
  const launched = (
    db.prepare(`SELECT mint, MIN(slot) AS launch FROM launch_trades WHERE kind = 'create' AND venue IN (${venues.map(() => '?').join(',')}) GROUP BY mint HAVING launch <= ? ORDER BY launch DESC LIMIT ?`).all(...venues, tip - cfg.earlyWindowSlots, limit) as any[]
  ).map((r) => r.mint as string);
  const rest =
    launched.length < limit && !venue
      ? (db.prepare('SELECT mint, MIN(slot) AS launch FROM launch_trades GROUP BY mint ORDER BY launch DESC LIMIT ?').all(limit * 4) as any[]).map((r) => r.mint as string).filter((m) => !launched.includes(m))
      : [];
  return [...launched, ...rest].slice(0, limit).map((m) => checkTokenFromDb(db, m, cfg));
}
