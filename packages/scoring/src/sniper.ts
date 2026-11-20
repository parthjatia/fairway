/**
 * Cross-launch sniper scoring (M16): bootstraps TOXIC scores from Pump.fun / PumpSwap history extracted by QuickNode Streams.
 *
 * For every launch (token mint):
 *   launch slot = the Create record's slot (or the first trade seen, if the create was not captured)
 *   early buy   = a buy within `earlyWindowSlots` of the launch slot (default 25 slots ≈ 10 s)
 *   markout     = (mid(t + h) − exec) / exec in bps, mid = the launch's own last trade price at or before t + h
 *                 (pool-implied: memecoins have no oracle); h = 75 slots ≈ 30 s, the same horizon as the onchain score
 * Per wallet, over all launches: score = Σ(notional × markout) / (Σ notional + K) with K = 5 SOL of prior notional
 * (the same Bayesian shrinkage as the main scorer). TOXIC when the wallet sniped ≥ `minLaunches` different launches AND
 * score ≥ `toxicBps`. Launch history never grants RETAIL (that needs ordinary uninformed history), so the output is
 * TOXIC or STANDARD. One lucky early buy is never enough: it needs repetition across launches.
 */
import type { Tier } from './types';

export type LaunchTrade = { sig: string; slot: number; mint: string; trader: string; kind: 'create' | 'buy' | 'sell'; tokenAmount: number; solAmount: number; price: number };

export type SniperConfig = {
  earlyWindowSlots: number;
  horizonSlots: number;
  /** prior notional K, in SOL */
  priorSol: number;
  minLaunches: number;
  toxicBps: number;
  /** per-trade markout clamp (±), bps */
  clampBps: number;
};

export const DEFAULT_SNIPER_CONFIG: SniperConfig = { earlyWindowSlots: 25, horizonSlots: 75, priorSol: 5, minLaunches: 3, toxicBps: 500, clampBps: 10_000 };

export type SniperScore = {
  wallet: string;
  tier: Extract<Tier, 'TOXIC' | 'STANDARD'>;
  scoreBps: number;
  /** distinct launches with an early buy */
  launches: number;
  earlyBuys: number;
  notionalSol: number;
  /** mean slots after launch of the wallet's early buys */
  meanEntrySlot: number;
};

/** Last trade price of `mint` at or before `slot` (trades sorted by slot). */
function midAt(path: { slot: number; price: number }[], slot: number): number | null {
  let lo = 0;
  let hi = path.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (path[m]!.slot <= slot) {
      ans = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return ans >= 0 ? path[ans]!.price : null;
}

export type EarlyMarkout = { wallet: string; mint: string; slot: number; offsetSlots: number; solAmount: number; markoutBps: number };

/** Markout of every early buy (within `earlyWindowSlots` of the launch), in launch order. The one place this is computed. */
export function earlyBuyMarkouts(trades: readonly LaunchTrade[], cfg: SniperConfig = DEFAULT_SNIPER_CONFIG): EarlyMarkout[] {
  const byMint = new Map<string, LaunchTrade[]>();
  for (const t of trades) {
    const l = byMint.get(t.mint) ?? [];
    l.push(t);
    byMint.set(t.mint, l);
  }
  const out: EarlyMarkout[] = [];
  for (const [mint, ts] of byMint) {
    ts.sort((a, b) => a.slot - b.slot);
    const create = ts.find((t) => t.kind === 'create');
    const launchSlot = create ? create.slot : ts[0]!.slot;
    const path = ts.filter((t) => t.kind !== 'create' && t.price > 0).map((t) => ({ slot: t.slot, price: t.price }));
    for (const t of ts) {
      if (t.kind !== 'buy' || t.slot - launchSlot > cfg.earlyWindowSlots || !(t.price > 0)) continue;
      const mid = midAt(path, t.slot + cfg.horizonSlots);
      if (mid === null) continue;
      const markoutBps = Math.max(-cfg.clampBps, Math.min(cfg.clampBps, ((mid - t.price) / t.price) * 10_000));
      out.push({ wallet: t.trader, mint, slot: t.slot, offsetSlots: t.slot - launchSlot, solAmount: t.solAmount, markoutBps });
    }
  }
  return out;
}

export function scoreSnipers(trades: readonly LaunchTrade[], cfg: SniperConfig = DEFAULT_SNIPER_CONFIG): SniperScore[] {
  type Acc = { w: number; n: number; launches: Set<string>; buys: number; entry: number };
  const acc = new Map<string, Acc>();
  for (const m of earlyBuyMarkouts(trades, cfg)) {
    const a = acc.get(m.wallet) ?? { w: 0, n: 0, launches: new Set<string>(), buys: 0, entry: 0 };
    a.w += m.solAmount * m.markoutBps;
    a.n += m.solAmount;
    a.launches.add(m.mint);
    a.buys += 1;
    a.entry += m.offsetSlots;
    acc.set(m.wallet, a);
  }
  const out: SniperScore[] = [];
  for (const [wallet, a] of acc) {
    const scoreBps = a.w / (a.n + cfg.priorSol);
    const tier = a.launches.size >= cfg.minLaunches && scoreBps >= cfg.toxicBps ? 'TOXIC' : 'STANDARD';
    out.push({ wallet, tier, scoreBps, launches: a.launches.size, earlyBuys: a.buys, notionalSol: a.n, meanEntrySlot: a.entry / a.buys });
  }
  return out.sort((x, y) => y.scoreBps - x.scoreBps);
}
