import 'server-only';
import { BASE_FEE_BPS, MOCK_RETAIL_REBATE_BPS, PROTOCOL_PREMIUM_SHARE_BPS, TIER_FEE } from '../fees';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  accumulateOnchain,
  EMPTY_SUMS,
  onchainMarkoutBps,
  onchainTier,
  type OnchainSums,
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
import type { MemecoinMarket } from '@fairway/fixtures';
import type { OnchainScore, PairMeta, PoolKey, PoolView, Persona, WalletView } from '../types';

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

/** BONK-test / USDC (a TEST mint): the second Fairway pool. Additive fixture (data/memecoin.json), see packages/fixtures/src/memecoin.ts. */
let memeCache: null | { m: MemecoinMarket; mids: FixtureMidPrice } = null;
export function memecoin() {
  if (memeCache) return memeCache;
  const m = readJson<MemecoinMarket>('packages', 'fixtures', 'data', 'memecoin.json');
  const mids = new FixtureMidPrice(m.cex.prices.map((p, i) => [m.cex.start + i * m.cex.stepSec, p] as [number, number]), Math.max(5, m.cex.stepSec * 2));
  memeCache = { m, mids };
  return memeCache;
}

export function pairs(): PairMeta[] {
  const m = memecoin().m;
  return [
    { key: 'sol', label: 'SOL / USDC', baseSymbol: 'SOL', baseDecimals: 9, quoteSymbol: 'USDC', quoteDecimals: 6, blurb: 'Blue-chip pair. Arbitrage bots dominate the toxic flow.' },
    { key: 'bonk', label: `${m.symbol} / USDC`, baseSymbol: m.symbol, baseDecimals: m.pool.baseDecimals, quoteSymbol: 'USDC', quoteDecimals: 6, blurb: 'Test memecoin (not the real BONK). Pumps and dumps make snipers earn a big markout, so they are scored TOXIC fastest here.' },
  ];
}

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

const labelOf = (address: string) => {
  const p = fixtures().meta.personas.find((x) => x.address === address)?.name;
  if (p) return p;
  const i = memecoin().m.extraWallets.findIndex((w) => w.address === address);
  return i >= 0 ? `Memecoin sniper ${i + 1}` : null;
};
const CLASS_LABEL: Record<string, string> = { retail: 'retail trader', arb: 'arbitrage bot', sniper: 'momentum sniper', new: 'new wallet' };

/** Program defaults (MarkoutParams::default): ~30 s horizon, onchain score wins after 1,000 USDC of settled notional. */
const MARKOUT_SLOTS = 75;
const ONCHAIN_MIN_NOTIONAL_USDC = 1_000;
const ONCHAIN_PARAMS = { ...onchainParamsFrom(cfg), onchainMinNotional: BigInt(ONCHAIN_MIN_NOTIONAL_USDC * 1e6) };

/** Verified fair flow: onchain RETAIL tier from at least this many settled trades. */
export const FAIR_FLOW_MIN_TRADES = 10;

type FairwaySwap = Swap & { _pool: PoolKey };

/** Every swap on a Fairway pool by `address`, tagged with its pool key and priced against that pool's own mid path. */
function fairwaySwaps(address: string): FairwaySwap[] {
  const f = fixtures();
  const solPool = f.meta.pools.find((p) => p.venue === 'fairway')!.id;
  const sol = f.swaps.filter((s) => s.trader === address && s.pool === solPool).map((s) => ({ ...s, _pool: 'sol' as const }));
  const meme = memecoin().m.swaps.filter((s) => s.trader === address).map((s) => ({ ...s, _pool: 'bonk' as const }));
  return [...sol, ...meme];
}
const midFor = (swap: { pool: string }) => (memecoin().m.pool.id === swap.pool ? memecoin().mids : fixtures().mids);

/** What `settle_markout` would have recorded from this wallet's swaps on the Fairway pools (same integer math as the program). */
function onchainScoreOf(address: string): OnchainScore {
  const f = fixtures();
  const own = fairwaySwaps(address);
  const horizonSec = MARKOUT_SLOTS * 0.4;
  const run = (swaps: FairwaySwap[]) => onchainScoreFromSwaps(swaps, (ts, pool) => midFor({ pool }).midAt(ts), ONCHAIN_PARAMS, { horizonSec, asOf: f.meta.end });
  const v = run(own);
  const labels: Record<PoolKey, string> = { sol: 'SOL / USDC', bonk: `${memecoin().m.symbol} / USDC` };
  const perPool = (['sol', 'bonk'] as const)
    .map((key) => {
      const sw = own.filter((s) => s._pool === key);
      const r = run(sw);
      return { key, label: labels[key], trades: r.tradeCount, notional: Number(r.sumNotional) / 1e6, scoreBps: r.scoreBps, tier: r.tier, tradesToToxic: tradesToToxic(sw, horizonSec) };
    })
    .filter((p) => p.trades > 0);
  const scoreBps = v.scoreBps;
  return {
    tradeCount: v.tradeCount,
    notional: Number(v.sumNotional) / 1e6,
    scoreBps,
    tier: v.tier,
    historyDays: (Number(v.historySlots) * 0.4) / cfg.secondsPerDay,
    verified: v.verified,
    thresholdNotional: ONCHAIN_MIN_NOTIONAL_USDC,
    minTrades: Math.min(cfg.toxicMinTrades, cfg.retailMinTrades),
    fairFlow: v.verified && v.tier === 'RETAIL' && v.tradeCount >= FAIR_FLOW_MIN_TRADES,
    fairFlowMinTrades: FAIR_FLOW_MIN_TRADES,
    perPool,
    markoutSlots: MARKOUT_SLOTS,
  };
}

/** How many settled trades until this wallet's running onchain score first reaches TOXIC (null = never). */
function tradesToToxic(swaps: FairwaySwap[], horizonSec: number): number | null {
  let s: OnchainSums = EMPTY_SUMS;
  for (const sw of [...swaps].sort((a, b) => a.ts - b.ts)) {
    const mid = midFor(sw).midAt(sw.ts + horizonSec);
    if (mid === undefined || !(sw.execPrice > 0)) continue;
    s = accumulateOnchain(s, BigInt(Math.round(Math.abs(sw.quoteAmount) * 1e6)), onchainMarkoutBps(sw.side, BigInt(Math.round(sw.execPrice * 1e12)), BigInt(Math.round(mid * 1e12))));
    if (onchainTier(s, 0n, { ...ONCHAIN_PARAMS, retailMinHistorySlots: 0n }) === 2) return s.trades;
  }
  return null;
}

/** Memecoin vs SOL: settled trades until each sniper wallet's running onchain score first reaches TOXIC. */
export function sniperTimeToToxic(): Array<{ address: string; label: string; meme: number | null; sol: number | null; solTrades: number }> {
  const f = fixtures();
  const snipers = [...f.meta.wallets.filter((w) => w.cls === 'sniper').map((w) => w.address), ...memecoin().m.extraWallets.map((w) => w.address)];
  const horizonSec = MARKOUT_SLOTS * 0.4;
  return snipers.map((address) => {
    const own = fairwaySwaps(address);
    const solSwaps = own.filter((s) => s._pool === 'sol');
    return {
      address,
      label: labelOf(address) ?? 'sniper',
      meme: tradesToToxic(own.filter((s) => s._pool === 'bonk'), horizonSec),
      sol: tradesToToxic(solSwaps, horizonSec),
      solTrades: solSwaps.length,
    };
  });
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

/** Protocol's share of the TOXIC PREMIUM (Config.protocol_fee_bps default; it takes nothing from other fees) and the rent of one score account (≈ 0.0023 SOL). */
export const PROTOCOL_FEE_BPS = PROTOCOL_PREMIUM_SHARE_BPS;
const SCORE_ACCOUNT_RENT_SOL = 0.0023;

/** Fairway fixture pool: reserves (replayed from swaps), volume/fees by tier, M14 economics, recent swaps. */
export function poolView(key: PoolKey = 'sol'): PoolView {
  const f = fixtures();
  const meme = memecoin().m;
  const pair = pairs().find((p) => p.key === key)!;
  const pool = key === 'bonk' ? meme.pool : f.meta.pools.find((p) => p.venue === 'fairway')!;
  const s0 = key === 'bonk' ? meme.cex.prices[0]! : f.meta.market.s0;
  const allSwaps = key === 'bonk' ? meme.swaps : f.swaps;
  let base = pool.initialBase;
  let quote = pool.initialBase * s0;
  const zero = () => ({ RETAIL: 0, STANDARD: 0, TOXIC: 0 }) as Record<Tier, number>;
  const volumeByTier = zero();
  const feesByTier = zero();
  const tradesByTier = zero();
  const traders = new Set<string>();
  const daily = new Map<string, Record<Tier, number>>();
  const mine = allSwaps.filter((s) => s.pool === pool.id);
  let botExtra = 0;
  let retailSaved = 0;
  for (const s of mine) {
    base += s.side === 'buy' ? -s.baseAmount : s.baseAmount;
    quote += s.side === 'buy' ? s.quoteAmount : -s.quoteAmount;
    const t = s.tier ?? 'STANDARD';
    // fixtures were generated under the old 5/30/80 schedule: re-price every swap under the current default (static counterfactual, volume held fixed)
    const feeBps = TIER_FEE[t];
    const fee = (s.quoteAmount * feeBps) / 10_000;
    volumeByTier[t] += s.quoteAmount;
    feesByTier[t] += fee;
    tradesByTier[t] += 1;
    traders.add(s.trader);
    // vs a flat STANDARD (30 bps) pool on the same volume: bots pay extra, retail saves
    const vsFlat = (s.quoteAmount * (feeBps - BASE_FEE_BPS.STANDARD)) / 10_000;
    if (t === 'TOXIC') botExtra += vsFlat;
    if (t === 'RETAIL') retailSaved -= vsFlat;
    const day = new Date(s.ts * 1000).toISOString().slice(5, 10);
    if (!daily.has(day)) daily.set(day, zero());
    daily.get(day)![t] += fee;
  }
  const price = quote / base;
  const lpFees = feesByTier.RETAIL + feesByTier.STANDARD + feesByTier.TOXIC;
  return {
    key,
    baseSymbol: pair.baseSymbol,
    baseDecimals: pair.baseDecimals,
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
    economics: {
      botExtraFeesUsd: botExtra,
      retailSavedUsd: retailSaved,
      protocolFeeBps: PROTOCOL_FEE_BPS,
      protocolRevenueUsd: (botExtra * PROTOCOL_FEE_BPS) / 10_000,
      lpFeesUsd: lpFees - (botExtra * PROTOCOL_FEE_BPS) / 10_000,
      rebateBps: MOCK_RETAIL_REBATE_BPS,
      sponsoredRentSol: traders.size * SCORE_ACCOUNT_RENT_SOL,
    },
    recent: mine
      .slice(-14)
      .reverse()
      .map((s) => ({ sig: s.sig, ts: s.ts, trader: s.trader, side: s.side, quoteAmount: s.quoteAmount, execPrice: s.execPrice, feeBps: TIER_FEE[s.tier ?? 'STANDARD'], tier: s.tier, label: labelOf(s.trader) })),
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
    lpfirst: read<import('@fairway/sim').LpFirstOutput>('lpfirst.json'),
  };
}
