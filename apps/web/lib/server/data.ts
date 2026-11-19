import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  explainTier,
  FixtureMidPrice,
  makeConfig,
  onchainParamsFrom,
  onchainScoreFromSwaps,
  scoreWallets,
  tierTimeline,
  tradeMarkouts,
  type Swap,
  type Tier,
  type WalletScore,
} from '@fairway/scoring';
import type { OnchainScore, PoolView, Persona, WalletView } from '../types';

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

/** Program defaults (MarkoutParams::default): ~30 s horizon, onchain score wins after 1,000 USDC of settled notional. */
const MARKOUT_SLOTS = 75;
const ONCHAIN_MIN_NOTIONAL_USDC = 1_000;
const ONCHAIN_PARAMS = { ...onchainParamsFrom(cfg), onchainMinNotional: BigInt(ONCHAIN_MIN_NOTIONAL_USDC * 1e6) };

/** What `settle_markout` would have recorded from this wallet's swaps on the Fairway pool (same integer math as the program). */
function onchainScoreOf(address: string): OnchainScore {
  const f = fixtures();
  const fairwayPools = new Set(f.meta.pools.filter((p) => p.venue === 'fairway').map((p) => p.id));
  const own = f.swaps.filter((s) => s.trader === address && fairwayPools.has(s.pool));
  const v = onchainScoreFromSwaps(own, (ts) => f.mids.midAt(ts), ONCHAIN_PARAMS, { horizonSec: MARKOUT_SLOTS * 0.4, asOf: f.meta.end });
  return {
    tradeCount: v.tradeCount,
    notional: Number(v.sumNotional) / 1e6,
    scoreBps: v.scoreBps,
    tier: v.tier,
    historyDays: (Number(v.historySlots) * 0.4) / cfg.secondsPerDay,
    verified: v.verified,
    thresholdNotional: ONCHAIN_MIN_NOTIONAL_USDC,
    minTrades: Math.min(cfg.toxicMinTrades, cfg.retailMinTrades),
    markoutSlots: MARKOUT_SLOTS,
  };
}

/** Blend rule (programs/fairway `resolve_blended`): onchain tier once verified, else the keeper's bootstrap tier. */
function blend(bootstrapTier: Tier, known: boolean, onchain: OnchainScore): Pick<WalletView, 'tier' | 'scoreSource' | 'bootstrapTier' | 'onchain'> {
  if (onchain.verified) return { tier: onchain.tier, scoreSource: 'onchain', bootstrapTier, onchain };
  return { tier: bootstrapTier, scoreSource: known ? 'bootstrap' : 'default', bootstrapTier, onchain };
}

const onchainNote = (o: OnchainScore) =>
  `Onchain verified: ${o.tradeCount} Fairway trades (${Math.round(o.notional).toLocaleString('en-US')} USDC) settled against Pyth give ${o.scoreBps} bps, so the program charges the ${o.tier} fee and ignores the keeper's score.`;

/** Wallet score explorer data: from the ingest service when it is running, else computed in-process. */
export async function walletView(address: string): Promise<WalletView> {
  const f = fixtures();
  const agentClass = CLASS_LABEL[f.cls.get(address) ?? ''] ?? null;
  const onchain = onchainScoreOf(address);
  const remote = await fromIngest<Omit<WalletView, 'source' | 'agentClass' | 'scoreSource' | 'bootstrapTier' | 'onchain'>>(`/wallet/${address}`);
  if (remote && remote.trades) {
    const b = blend(remote.tier, remote.known, onchain);
    return { ...remote, ...b, explanation: b.scoreSource === 'onchain' ? onchainNote(onchain) : remote.explanation, label: remote.label ?? labelOf(address), agentClass, source: 'ingest' };
  }

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
    return { address, known: false, ...blend('STANDARD', false, onchain), explanation: explainTier(undefined, cfg), label: labelOf(address), agentClass, score: null, trades: [], timeline: [], config, source: 'in-process' };
  }
  const tierIn = { scoreBps: score.scoreBps, maxScoreBps: score.maxScoreBps, trades: score.byHorizon[cfg.primaryHorizon]?.scoredTrades ?? score.trades, historyDays: score.historyDays };
  const b = blend(score.tier, true, onchain);
  return {
    address,
    known: true,
    ...b,
    explanation: b.scoreSource === 'onchain' ? onchainNote(onchain) : explainTier(tierIn, cfg),
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
