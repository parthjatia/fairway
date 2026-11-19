import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { explainTier, FixtureMidPrice, makeConfig, scoreWallets, tierTimeline, tradeMarkouts, type Swap, type Tier, type WalletScore } from '@fairway/scoring';
import type { PoolView, Persona, WalletView } from '../types';

/** Repo root = nearest ancestor of cwd containing pnpm-workspace.yaml (Next runs from apps/web). */
function repoRoot(): string {
  let d = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(d, 'pnpm-workspace.yaml'))) return d;
    d = dirname(d);
  }
  return join(process.cwd(), '..', '..');
}

const readJson = <T>(...p: string[]): T => JSON.parse(readFileSync(join(/*turbopackIgnore: true*/ repoRoot(), ...p), 'utf8')) as T;

type Meta = {
  start: number;
  end: number;
  pools: Array<{ id: string; venue: string; label: string; baseVault: string; quoteVault: string; initialBase: number; feeBps: number }>;
  personas: Persona[];
  wallets: Array<{ address: string; cls: string }>;
  market: { s0: number };
};
type Cex = { start: number; stepSec: number; prices: number[] };

let cache: null | { meta: Meta; cex: Cex; swaps: Swap[]; mids: FixtureMidPrice; scores: Map<string, WalletScore>; cls: Map<string, string> } = null;
const cfg = makeConfig();

export function fixtures() {
  if (cache) return cache;
  const meta = readJson<Meta>('packages', 'fixtures', 'data', 'meta.json');
  const cex = readJson<Cex>('packages', 'fixtures', 'data', 'cex.json');
  const swaps = readJson<Swap[]>('packages', 'fixtures', 'data', 'swaps.json');
  const mids = new FixtureMidPrice(
    cex.prices.map((p, i) => [cex.start + i * cex.stepSec, p] as [number, number]),
    Math.max(5, cex.stepSec * 2),
  );
  const scores = new Map(scoreWallets(swaps, mids, cfg).map((s) => [s.trader, s]));
  cache = { meta, cex, swaps, mids, scores, cls: new Map(meta.wallets.map((w) => [w.address, w.cls])) };
  return cache;
}

export const personas = (): Persona[] => fixtures().meta.personas;

const INGEST = process.env.INGEST_URL || process.env.NEXT_PUBLIC_INGEST_URL || '';

async function fromIngest<T>(path: string): Promise<T | null> {
  if (!INGEST) return null;
  try {
    const r = await fetch(`${INGEST}${path}`, { signal: AbortSignal.timeout(1500), cache: 'no-store' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const labelOf = (address: string) => fixtures().meta.personas.find((p) => p.address === address)?.name ?? null;
const CLASS_LABEL: Record<string, string> = { retail: 'retail trader', arb: 'arbitrage bot', sniper: 'momentum sniper', new: 'new wallet' };

/** Wallet score explorer data: from the ingest service when it is running, else computed in-process. */
export async function walletView(address: string): Promise<WalletView> {
  const f = fixtures();
  const agentClass = CLASS_LABEL[f.cls.get(address) ?? ''] ?? null;
  const remote = await fromIngest<Omit<WalletView, 'source' | 'agentClass'>>(`/wallet/${address}`);
  if (remote && remote.trades) return { ...remote, label: remote.label ?? labelOf(address), agentClass, source: 'ingest' };

  const config = { horizons: cfg.horizons, primaryHorizon: cfg.primaryHorizon, priorNotional: cfg.priorNotional, toxicScoreBps: cfg.toxicScoreBps, retailScoreBps: cfg.retailScoreBps, minTrades: cfg.retailMinTrades, retailMinHistoryDays: cfg.retailMinHistoryDays };
  const score = f.scores.get(address) ?? null;
  const own = f.swaps.filter((s) => s.trader === address);
  const trades = own
    .map((s) => {
      const t = tradeMarkouts(s, f.mids, cfg.horizons);
      const markouts: Record<string, number | null> = {};
      for (const h of cfg.horizons) markouts[h] = Number.isFinite(t.markouts[h]) ? t.markouts[h]! : null;
      return { sig: s.sig, ts: s.ts, pool: s.pool, venue: s.venue, side: s.side, baseAmount: s.baseAmount, quoteAmount: s.quoteAmount, execPrice: s.execPrice, feeBps: s.feeBps, markouts };
    })
    .sort((a, b) => b.ts - a.ts);
  if (!score) {
    return { address, known: false, tier: 'STANDARD', explanation: explainTier(undefined, cfg), label: labelOf(address), agentClass, score: null, trades: [], timeline: [], config, source: 'in-process' };
  }
  const tierIn = { scoreBps: score.scoreBps, maxScoreBps: score.maxScoreBps, trades: score.byHorizon[cfg.primaryHorizon]?.scoredTrades ?? score.trades, historyDays: score.historyDays };
  return {
    address,
    known: true,
    tier: score.tier,
    explanation: explainTier(tierIn, cfg),
    label: labelOf(address),
    agentClass,
    score: { ...score, byHorizon: score.byHorizon as never },
    trades,
    timeline: tierTimeline(trades, cfg),
    config,
    source: 'in-process',
  };
}

/** Example wallets for the explorer: personas + a few of each tier. */
export function exampleWallets(): Array<{ address: string; tier: Tier; trades: number; label: string | null; scoreBps: number }> {
  const f = fixtures();
  const all = [...f.scores.values()];
  const pick = (tier: Tier, n: number) => all.filter((s) => s.tier === tier).sort((a, b) => b.totalNotional - a.totalNotional).slice(0, n);
  const persona = f.meta.personas.map((p) => f.scores.get(p.address)).filter(Boolean) as WalletScore[];
  const seen = new Set<string>();
  return [...persona, ...pick('TOXIC', 3), ...pick('RETAIL', 3), ...pick('STANDARD', 2)]
    .filter((s) => (seen.has(s.trader) ? false : (seen.add(s.trader), true)))
    .map((s) => ({ address: s.trader, tier: s.tier, trades: s.trades, label: labelOf(s.trader), scoreBps: s.scoreBps }));
}

/** Fairway fixture pool: reserves (replayed from swaps), volume/fees by tier, recent swaps. */
export function poolView(): PoolView {
  const f = fixtures();
  const pool = f.meta.pools.find((p) => p.venue === 'fairway')!;
  let base = pool.initialBase;
  let quote = pool.initialBase * f.meta.market.s0;
  const zero = () => ({ RETAIL: 0, STANDARD: 0, TOXIC: 0 }) as Record<Tier, number>;
  const volumeByTier = zero();
  const feesByTier = zero();
  const tradesByTier = zero();
  const traders = new Set<string>();
  const daily = new Map<string, Record<Tier, number>>();
  const mine = f.swaps.filter((s) => s.pool === pool.id);
  for (const s of mine) {
    base += s.side === 'buy' ? -s.baseAmount : s.baseAmount;
    quote += s.side === 'buy' ? s.quoteAmount : -s.quoteAmount;
    const t = s.tier ?? 'STANDARD';
    volumeByTier[t] += s.quoteAmount;
    feesByTier[t] += (s.quoteAmount * (s.feeBps ?? 30)) / 10_000;
    tradesByTier[t] += 1;
    traders.add(s.trader);
    const day = new Date(s.ts * 1000).toISOString().slice(5, 10);
    if (!daily.has(day)) daily.set(day, zero());
    daily.get(day)![t] += (s.quoteAmount * (s.feeBps ?? 30)) / 10_000;
  }
  const price = quote / base;
  return {
    id: pool.id,
    label: pool.label,
    baseVault: pool.baseVault,
    quoteVault: pool.quoteVault,
    reserves: { base, quote },
    price,
    tvlUsd: base * price + quote,
    trades: mine.length,
    uniqueTraders: traders.size,
    volumeByTier,
    feesByTier,
    tradesByTier,
    daily: [...daily.entries()].map(([day, v]) => ({ day, ...v })),
    recent: mine
      .slice(-14)
      .reverse()
      .map((s) => ({ sig: s.sig, ts: s.ts, trader: s.trader, side: s.side, quoteAmount: s.quoteAmount, execPrice: s.execPrice, feeBps: s.feeBps, tier: s.tier, label: labelOf(s.trader) })),
    source: 'in-process',
  };
}

export function simOutputs() {
  const read = <T>(name: string): T => readJson<T>('packages', 'sim', 'out', name);
  return {
    backtest: read<import('@fairway/sim').BacktestOutput>('backtest.json'),
    sweep: read<import('@fairway/sim').SweepOutput>('sweep.json'),
    recommended: read<{ headline: import('@fairway/sim').Headline; config: import('@fairway/sim').SimConfig }>('backtest-recommended.json'),
    sensitivity: read<{ rows: import('@fairway/sim').SensitivityRow[] }>('sensitivity.json'),
    replay: read<import('@fairway/sim').ReplayOutput>('replay.json'),
  };
}
