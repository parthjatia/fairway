/**
 * Fairway Check (M18): a public fairness report for a token launch and for a wallet, built from the same Pump.fun /
 * PumpSwap launch trades (QuickNode Streams) and the same cross-launch sniper scores as the launch fee tiers.
 *
 * Token report, over the EARLY WINDOW (default 150 slots ≈ 60 s after the launch slot):
 *   sniper share   = tokens bought by TOXIC wallets ÷ tokens bought by everyone, in the window
 *   fresh share    = early buyers with no trade on any OTHER token before this launch ÷ early buyers
 *   dumped         = tokens the early snipers have sold ÷ tokens they bought in the window (token-weighted, capped at 100%)
 *   risk grade     = High / Medium / Low from the thresholds in DEFAULT_CHECK_CONFIG (documented in docs/ECONOMICS.md §9)
 * A wallet is TOXIC if the sniper scorer says so, or if it is funded by a known bundler (bundle detection).
 * Everything here is pure: same trades in, same report out. No offchain labels, no oracle.
 */
import { earlyBuyMarkouts, scoreSnipers, DEFAULT_SNIPER_CONFIG, type LaunchTrade, type SniperConfig, type SniperScore } from './sniper';
import type { Tier } from './types';

export type RiskGrade = 'Low' | 'Medium' | 'High';

export type CheckConfig = {
  /** early window after the launch slot: 150 slots ≈ 60 s */
  earlyWindowSlots: number;
  /** rows in the top-early-buyers table */
  topBuyers: number;
  /** below this many early buyers the grade is shown with "low confidence" */
  minEarlyBuyers: number;
  /** High when the snipers' share of early supply is at least this (%) */
  highSniperSharePct: number;
  /** ... or at least `highWithDumpSharePct` and the snipers have already dumped at least `highDumpedPct` of their bag */
  highWithDumpSharePct: number;
  highDumpedPct: number;
  /** Medium when the snipers' share is at least this (%); below it the grade is Low */
  mediumSniperSharePct: number;
  /** "Fair launch verified": snipers' share below this (%) AND at least `fairLaunchMinBuyers` early buyers */
  fairLaunchMaxSniperSharePct: number;
  fairLaunchMinBuyers: number;
};

export const DEFAULT_CHECK_CONFIG: CheckConfig = {
  earlyWindowSlots: 150,
  topBuyers: 10,
  minEarlyBuyers: 5,
  highSniperSharePct: 30,
  highWithDumpSharePct: 15,
  highDumpedPct: 50,
  mediumSniperSharePct: 10,
  fairLaunchMaxSniperSharePct: 10,
  fairLaunchMinBuyers: 10,
};

/** One trade, normalised so the launch sim and the Streams data can feed the same report. */
export type CheckTrade = { wallet: string; slot: number; kind: 'buy' | 'sell'; tokens: number; sol: number };

export type CheckBuyer = {
  wallet: string;
  tier: Extract<Tier, 'TOXIC' | 'STANDARD'>;
  /** funded by a known bundler (bundle detection) */
  bundle: boolean;
  /** no trade on any other token before this launch */
  fresh: boolean;
  /** bought in the launch slot itself */
  firstBlock: boolean;
  /** slots after the launch of the first buy */
  entrySlots: number;
  tokens: number;
  sol: number;
  /** share of all early-window tokens */
  sharePct: number;
  sold: boolean;
  /** share of this wallet's early bag it has sold (0–100) */
  soldPct: number;
};

export type TokenCheck = {
  mint: string;
  found: boolean;
  launchSlot: number;
  earlyWindowSlots: number;
  earlyBuyers: number;
  earlyBuyVolumeSol: number;
  sniperCount: number;
  sniperSharePct: number;
  freshWalletSharePct: number;
  snipersSold: number;
  snipersDumpedPct: number;
  grade: RiskGrade;
  /** true when there are fewer than `minEarlyBuyers` early buyers: the grade is a weak signal */
  lowConfidence: boolean;
  fairLaunchVerified: boolean;
  verdict: string;
  topBuyers: CheckBuyer[];
};

const pct = (x: number) => (Number.isFinite(x) ? x : 0);
const fmt = (x: number) => `${Math.round(x)}%`;

export function gradeOf(sniperSharePct: number, dumpedPct: number, cfg: CheckConfig = DEFAULT_CHECK_CONFIG): RiskGrade {
  if (sniperSharePct >= cfg.highSniperSharePct || (sniperSharePct >= cfg.highWithDumpSharePct && dumpedPct >= cfg.highDumpedPct)) return 'High';
  if (sniperSharePct >= cfg.mediumSniperSharePct) return 'Medium';
  return 'Low';
}

export type CheckInput = {
  mint: string;
  launchSlot: number;
  trades: readonly CheckTrade[];
  tierOf: (wallet: string) => Extract<Tier, 'TOXIC' | 'STANDARD'>;
  bundleOf?: (wallet: string) => boolean;
  /** true when the wallet traded some other token before this launch */
  hadHistory?: (wallet: string) => boolean;
};

export function emptyTokenCheck(mint: string, cfg: CheckConfig = DEFAULT_CHECK_CONFIG): TokenCheck {
  return {
    mint,
    found: false,
    launchSlot: 0,
    earlyWindowSlots: cfg.earlyWindowSlots,
    earlyBuyers: 0,
    earlyBuyVolumeSol: 0,
    sniperCount: 0,
    sniperSharePct: 0,
    freshWalletSharePct: 0,
    snipersSold: 0,
    snipersDumpedPct: 0,
    grade: 'Low',
    lowConfidence: true,
    fairLaunchVerified: false,
    verdict: 'No launch data for this token yet.',
    topBuyers: [],
  };
}

export function buildTokenCheck(inp: CheckInput, cfg: CheckConfig = DEFAULT_CHECK_CONFIG): TokenCheck {
  const early = inp.trades.filter((t) => t.kind === 'buy' && t.slot >= inp.launchSlot && t.slot - inp.launchSlot <= cfg.earlyWindowSlots);
  if (!early.length) return { ...emptyTokenCheck(inp.mint, cfg), found: inp.trades.length > 0, launchSlot: inp.launchSlot, verdict: 'No buys in the first 60 seconds were captured for this token.' };
  type Acc = { tokens: number; sol: number; first: number; sold: number };
  const by = new Map<string, Acc>();
  for (const t of early) {
    const a = by.get(t.wallet) ?? { tokens: 0, sol: 0, first: Infinity, sold: 0 };
    a.tokens += t.tokens;
    a.sol += t.sol;
    a.first = Math.min(a.first, t.slot);
    by.set(t.wallet, a);
  }
  for (const t of inp.trades) if (t.kind === 'sell') {
    const a = by.get(t.wallet);
    if (a && t.slot >= a.first) a.sold += t.tokens;
  }
  const total = [...by.values()].reduce((s, a) => s + a.tokens, 0);
  const buyers: CheckBuyer[] = [...by].map(([wallet, a]) => ({
    wallet,
    tier: inp.tierOf(wallet),
    bundle: inp.bundleOf?.(wallet) ?? false,
    fresh: !(inp.hadHistory?.(wallet) ?? false),
    firstBlock: a.first === inp.launchSlot,
    entrySlots: a.first - inp.launchSlot,
    tokens: a.tokens,
    sol: a.sol,
    sharePct: total > 0 ? (a.tokens / total) * 100 : 0,
    sold: a.sold > 0,
    soldPct: a.tokens > 0 ? Math.min(100, (a.sold / a.tokens) * 100) : 0,
  }));
  const snipers = buyers.filter((b) => b.tier === 'TOXIC');
  const sniperTokens = snipers.reduce((s, b) => s + b.tokens, 0);
  const dumpedTokens = snipers.reduce((s, b) => s + (b.soldPct / 100) * b.tokens, 0);
  const sniperSharePct = pct(total > 0 ? (sniperTokens / total) * 100 : 0);
  const snipersDumpedPct = pct(sniperTokens > 0 ? (dumpedTokens / sniperTokens) * 100 : 0);
  const grade = gradeOf(sniperSharePct, snipersDumpedPct, cfg);
  const snipersSold = snipers.filter((b) => b.sold).length;
  const verdict =
    grade === 'Low'
      ? `Low risk: only ${fmt(sniperSharePct)} of early supply went to known snipers.`
      : `${grade} risk: snipers bought ${fmt(sniperSharePct)} of early supply and ${snipersDumpedPct >= 1 ? `have already sold ${fmt(snipersDumpedPct)} of it` : 'have not sold yet'}.`;
  return {
    mint: inp.mint,
    found: true,
    launchSlot: inp.launchSlot,
    earlyWindowSlots: cfg.earlyWindowSlots,
    earlyBuyers: buyers.length,
    earlyBuyVolumeSol: buyers.reduce((s, b) => s + b.sol, 0),
    sniperCount: snipers.length,
    sniperSharePct,
    freshWalletSharePct: (buyers.filter((b) => b.fresh).length / buyers.length) * 100,
    snipersSold,
    snipersDumpedPct,
    grade,
    lowConfidence: buyers.length < cfg.minEarlyBuyers,
    fairLaunchVerified: sniperSharePct < cfg.fairLaunchMaxSniperSharePct && buyers.length >= cfg.fairLaunchMinBuyers,
    verdict,
    topBuyers: buyers.sort((a, b) => b.tokens - a.tokens || a.wallet.localeCompare(b.wallet)).slice(0, cfg.topBuyers),
  };
}

// ---- from launch trades (Streams / ingest DB / fixtures)

export type CheckContext = {
  /** cross-launch sniper scores (scoreSnipers over ALL launch trades, including this one) */
  snipers: ReadonlyMap<string, SniperScore>;
  /** wallets flagged as funded by a known bundler */
  bundled?: ReadonlySet<string>;
};

export function checkContextFrom(trades: readonly LaunchTrade[], bundled: Iterable<string> = [], sniperCfg: SniperConfig = DEFAULT_SNIPER_CONFIG): CheckContext {
  return { snipers: new Map(scoreSnipers(trades, sniperCfg).map((s) => [s.wallet, s])), bundled: new Set(bundled) };
}

/** First trade slot per wallet per mint (for "no history before this launch"). */
function firstSlots(trades: readonly LaunchTrade[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const t of trades) {
    const w = m.get(t.trader) ?? new Map<string, number>();
    w.set(t.mint, Math.min(w.get(t.mint) ?? Infinity, t.slot));
    m.set(t.trader, w);
  }
  return m;
}

export function launchSlotOf(trades: readonly LaunchTrade[], mint: string): number | null {
  const ts = trades.filter((t) => t.mint === mint);
  if (!ts.length) return null;
  const create = ts.filter((t) => t.kind === 'create');
  return create.length ? Math.min(...create.map((t) => t.slot)) : Math.min(...ts.map((t) => t.slot));
}

export function checkToken(trades: readonly LaunchTrade[], mint: string, ctx: CheckContext = checkContextFrom(trades), cfg: CheckConfig = DEFAULT_CHECK_CONFIG): TokenCheck {
  const launchSlot = launchSlotOf(trades, mint);
  if (launchSlot === null) return emptyTokenCheck(mint, cfg);
  const first = firstSlots(trades);
  const toxic = (w: string) => ctx.snipers.get(w)?.tier === 'TOXIC' || (ctx.bundled?.has(w) ?? false);
  return buildTokenCheck(
    {
      mint,
      launchSlot,
      trades: trades.filter((t) => t.mint === mint && t.kind !== 'create').map((t) => ({ wallet: t.trader, slot: t.slot, kind: t.kind as 'buy' | 'sell', tokens: t.tokenAmount, sol: t.solAmount })),
      tierOf: (w) => (toxic(w) ? 'TOXIC' : 'STANDARD'),
      bundleOf: (w) => ctx.bundled?.has(w) ?? false,
      hadHistory: (w) => [...(first.get(w) ?? [])].some(([m, slot]) => m !== mint && slot < launchSlot),
    },
    cfg,
  );
}

/** Tokens seen in the data, newest launch first, with their grade (for example chips and the /check index). */
export function listChecks(trades: readonly LaunchTrade[], ctx: CheckContext = checkContextFrom(trades), cfg: CheckConfig = DEFAULT_CHECK_CONFIG): TokenCheck[] {
  const mints = [...new Set(trades.map((t) => t.mint))];
  return mints.map((m) => checkToken(trades, m, ctx, cfg)).sort((a, b) => b.launchSlot - a.launchSlot);
}

export type WalletCheck = {
  wallet: string;
  found: boolean;
  tier: Extract<Tier, 'TOXIC' | 'STANDARD'>;
  /** shrunk cross-launch sniper score (bps) */
  scoreBps: number;
  /** distinct tokens the wallet traded in the data */
  launches: number;
  /** distinct launches it bought into early (inside the sniper window) */
  earlyLaunches: number;
  /** buys in the launch slot itself */
  firstBlockBuys: number;
  /** mean markout of its early buys (bps), unshrunk */
  avgMarkoutBps: number;
  bundle: boolean;
  verdict: string;
  recent: { mint: string; kind: 'buy' | 'sell'; slotsAfterLaunch: number; sol: number }[];
};

export function checkWallet(trades: readonly LaunchTrade[], wallet: string, ctx: CheckContext = checkContextFrom(trades), sniperCfg: SniperConfig = DEFAULT_SNIPER_CONFIG): WalletCheck {
  const mine = trades.filter((t) => t.trader === wallet && t.kind !== 'create');
  const s = ctx.snipers.get(wallet);
  const bundle = ctx.bundled?.has(wallet) ?? false;
  const tier = s?.tier === 'TOXIC' || bundle ? 'TOXIC' : 'STANDARD';
  if (!mine.length && !bundle) {
    return { wallet, found: false, tier: 'STANDARD', scoreBps: 0, launches: 0, earlyLaunches: 0, firstBlockBuys: 0, avgMarkoutBps: 0, bundle: false, verdict: 'No launch history for this wallet: it would pay the STANDARD fee.', recent: [] };
  }
  const slotOf = new Map<string, number>();
  for (const m of new Set(mine.map((t) => t.mint))) slotOf.set(m, launchSlotOf(trades, m) ?? 0);
  const mk = earlyBuyMarkouts(trades, sniperCfg).filter((m) => m.wallet === wallet);
  const avg = mk.length ? mk.reduce((a, m) => a + m.markoutBps, 0) / mk.length : 0;
  const firstBlockBuys = mine.filter((t) => t.kind === 'buy' && t.slot === slotOf.get(t.mint)).length;
  const launches = slotOf.size;
  const verdict =
    tier === 'TOXIC'
      ? bundle && s?.tier !== 'TOXIC'
        ? 'TOXIC: funded by a known bundler. Pays the sniper fee on Fairway launches.'
        : `TOXIC: bought early in ${s?.launches ?? 0} launches and the price rose after it bought (${Math.round(s?.scoreBps ?? 0)} bps shrunk markout). Pays the sniper fee on Fairway launches.`
      : s && s.launches >= 1
        ? `STANDARD: ${s.launches} early buy${s.launches === 1 ? '' : 's'} so far, not enough repeated edge to be labelled a sniper.`
        : 'STANDARD: no early buys; it trades like an ordinary holder.';
  return {
    wallet,
    found: true,
    tier,
    scoreBps: s?.scoreBps ?? 0,
    launches,
    earlyLaunches: s?.launches ?? 0,
    firstBlockBuys,
    avgMarkoutBps: avg,
    bundle,
    verdict,
    recent: mine
      .sort((a, b) => b.slot - a.slot)
      .slice(0, 8)
      .map((t) => ({ mint: t.mint, kind: t.kind as 'buy' | 'sell', slotsAfterLaunch: t.slot - (slotOf.get(t.mint) ?? t.slot), sol: t.solAmount })),
  };
}
