import { FixtureMidPrice, makeConfig, scoreWallets, type ScoringConfig, type Tier, type WalletScore } from '@fairway/scoring';
import { DEFAULT_SIM_CONFIG, REGIME_LABELS, type FeeSchedule, type Regime, type SimConfig } from './config';
import { feeFunction, makeScenario, runRegime, walletId, type RunMetrics, type Scenario, type TierBook, type TimeSeries } from './engine';

/** Scoring config used inside the simulator: warm-up is 3 days, so require ≥ 2 days of history. */
export const SIM_SCORING: Partial<ScoringConfig> = { retailMinHistoryDays: 2 };

export type WarmupResult = {
  tiers: TierBook;
  scores: WalletScore[];
  /** confusion matrix: agent type → tier → wallets */
  confusion: Record<string, Partial<Record<Tier, number>>>;
  /** share of retail VOLUME (by activity weight) that is classified RETAIL */
  retailShareClassified: number;
  swaps: number;
};

/** Warm-up: flat 30 bps on an independent path, then score every wallet with @fairway/scoring. */
export function warmup(cfg: SimConfig): WarmupResult {
  const sc = makeScenario(cfg, cfg.seed + 10_000, cfg.warmupHours);
  const { swaps } = runRegime(cfg, sc, { regime: 'flat30', fee: () => 30, recordSwaps: true });
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= sc.steps; i++) pts.push([i * sc.stepSec, sc.path[i]!]);
  const mids = new FixtureMidPrice(pts, 1);
  const scores = scoreWallets(swaps!, mids, makeConfig(SIM_SCORING), sc.steps * sc.stepSec);
  const byId = new Map(scores.map((s) => [s.trader, s.tier]));
  const book = (type: 'retail' | 'arb' | 'sniper', n: number): Tier[] => Array.from({ length: n }, (_, i) => byId.get(walletId(type, i)) ?? 'STANDARD');
  const tiers: TierBook = { retail: book('retail', cfg.retail.nWallets), arb: book('arb', cfg.arb.nWallets), sniper: book('sniper', cfg.sniper.nWallets) };
  const confusion: WarmupResult['confusion'] = {};
  for (const type of ['retail', 'arb', 'sniper'] as const) {
    confusion[type] = {};
    for (const t of tiers[type]) confusion[type]![t] = (confusion[type]![t] ?? 0) + 1;
  }
  let wsum = 0;
  let wret = 0;
  sc.retailWeights.forEach((w, i) => {
    wsum += w;
    if (tiers.retail[i] === 'RETAIL') wret += w;
  });
  return { tiers, scores, confusion, retailShareClassified: wret / wsum, swaps: swaps!.length };
}

const tierOfFn = (tiers: TierBook) => (type: 'retail' | 'arb' | 'sniper', w: number): Tier => tiers[type][w] ?? 'STANDARD';

/** average numeric fields of metrics across seeds (deep for nested records) */
export function averageMetrics(runs: RunMetrics[]): RunMetrics {
  const avg = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length;
  const first = runs[0]!;
  const out: any = { ...first, seed: -1 };
  for (const k of Object.keys(first) as Array<keyof RunMetrics>) {
    const v = first[k];
    if (typeof v === 'number') out[k] = avg(runs.map((r) => r[k] as number));
    else if (v && typeof v === 'object') {
      out[k] = {};
      for (const kk of Object.keys(v)) out[k][kk] = avg(runs.map((r) => (r[k] as any)[kk] as number));
    }
  }
  return out as RunMetrics;
}

export type RegimeSummary = { regime: Regime; label: string; mean: RunMetrics; perSeed: RunMetrics[]; lpPnlStderrUsd: number };

const stderr = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v / xs.length);
};

const summarize = (regime: Regime, perSeed: RunMetrics[]): RegimeSummary => ({
  regime,
  label: REGIME_LABELS[regime],
  mean: averageMetrics(perSeed),
  perSeed,
  lpPnlStderrUsd: stderr(perSeed.map((r) => r.lpPnlVsHodlUsd)),
});

export type BacktestOutput = {
  generatedAt: string;
  synthetic: true;
  config: SimConfig;
  seeds: number[];
  warmup: Omit<WarmupResult, 'scores' | 'tiers'> & { tiersByType: TierBook };
  regimes: RegimeSummary[];
  /** time series from the first seed, every `sampleEverySec` */
  series: Record<Regime, TimeSeries>;
  headline: Headline;
};

/**
 * Headline numbers. A flat fee forces one number to do two jobs: price retail AND set the no-arbitrage band that
 * protects LPs from LVR. Fairway separates them, so we compare against BOTH flat references:
 *  - vs flat 30 (same LVR protection): how much less retail pays, and what it costs LPs (a transfer)
 *  - vs flat 5 (same retail price): how much more LPs keep
 */
export type Headline = {
  retailCostSavedBps: number;
  retailCostSavedUsdPerDay: number;
  lpPnlVsFlat30UsdPerDay: number;
  lpPnlVsFlat30StderrUsd: number;
  lpPnlVsFlat5UsdPerDay: number;
  lpPnlVsFlat5StderrUsd: number;
  arbProfitReductionPct: number;
  sniperProfitReductionPct: number;
  rotationRetailCostSavedBps: number;
  rotationLpPnlVsFlat30UsdPerDay: number;
  rotationLpPnlVsFlat5UsdPerDay: number;
  tvlUsd: number;
};

/** Run the full backtest for one fee schedule across seeds. */
export function runBacktest(cfg: SimConfig = DEFAULT_SIM_CONFIG, seeds = [1, 2, 3, 4], wu: WarmupResult = warmup(cfg)): BacktestOutput {
  const regimes: Regime[] = ['flat30', 'fairway', 'rotation', 'flat5', 'flat80'];
  const per: Record<Regime, RunMetrics[]> = { flat30: [], fairway: [], rotation: [], flat5: [], flat80: [], flat: [] };
  const series = {} as Record<Regime, TimeSeries>;
  const tierOf = tierOfFn(wu.tiers);
  seeds.forEach((seed, si) => {
    const sc = makeScenario(cfg, seed);
    for (const r of regimes) {
      const res = runRegime(cfg, sc, { regime: r, fee: feeFunction(r, cfg.fees, wu.tiers), tierOf, timeseries: si === 0 });
      per[r].push(res.metrics);
      if (si === 0) series[r] = res.series!;
    }
  });
  const sums = regimes.map((r) => summarize(r, per[r]));
  const get = (r: Regime) => sums.find((s) => s.regime === r)!.mean;
  const base = get('flat30');
  const fw = get('fairway');
  const rot = get('rotation');
  const f5 = get('flat5');
  const days = cfg.hours / 24;
  const pairedStderr = (a: Regime, b: Regime) => stderr(per[a].map((m, i) => m.lpPnlVsHodlUsd - per[b][i]!.lpPnlVsHodlUsd)) / days;
  return {
    generatedAt: new Date(0).toISOString(), // fixed for determinism; real time is in the file mtime
    synthetic: true,
    config: cfg,
    seeds,
    warmup: { confusion: wu.confusion, retailShareClassified: wu.retailShareClassified, swaps: wu.swaps, tiersByType: wu.tiers },
    regimes: sums,
    series,
    headline: {
      retailCostSavedBps: base.retailCostBps - fw.retailCostBps,
      retailCostSavedUsdPerDay: (base.retailCostUsd - fw.retailCostUsd) / days,
      lpPnlVsFlat30UsdPerDay: (fw.lpPnlVsHodlUsd - base.lpPnlVsHodlUsd) / days,
      lpPnlVsFlat30StderrUsd: pairedStderr('fairway', 'flat30'),
      lpPnlVsFlat5UsdPerDay: (fw.lpPnlVsHodlUsd - f5.lpPnlVsHodlUsd) / days,
      lpPnlVsFlat5StderrUsd: pairedStderr('fairway', 'flat5'),
      arbProfitReductionPct: base.arbProfitUsd > 0 ? (1 - fw.arbProfitUsd / base.arbProfitUsd) * 100 : 0,
      sniperProfitReductionPct: base.sniperProfitUsd > 0 ? (1 - fw.sniperProfitUsd / base.sniperProfitUsd) * 100 : 0,
      rotationRetailCostSavedBps: base.retailCostBps - rot.retailCostBps,
      rotationLpPnlVsFlat30UsdPerDay: (rot.lpPnlVsHodlUsd - base.lpPnlVsHodlUsd) / days,
      rotationLpPnlVsFlat5UsdPerDay: (rot.lpPnlVsHodlUsd - f5.lpPnlVsHodlUsd) / days,
      tvlUsd: base.initialTvlUsd,
    },
  };
}

export const SWEEP_TOXIC = [30, 50, 80, 100, 150];
export const SWEEP_RETAIL = [5, 10, 20];

export type SweepCell = {
  toxicBps: number;
  retailBps: number;
  fairway: RunMetrics;
  rotation: RunMetrics;
  /** constraint checks vs baseline (fairway regime) */
  meetsRetailCost: boolean;
  meetsStaleness: boolean;
};

export type SweepOutput = {
  synthetic: true;
  config: SimConfig;
  seeds: number[];
  stalenessBoundBps: number;
  toxic: number[];
  retail: number[];
  baseline: RunMetrics;
  context: { flat5: RunMetrics; flat80: RunMetrics };
  cells: SweepCell[];
  /** flat-fee reference curve (everyone pays the same fee) */
  flatCurve: Array<{ feeBps: number; metrics: RunMetrics }>;
  recommended: { toxicBps: number; retailBps: number; reason: string };
};

/**
 * Parameter sweep: toxic × retail fee (STANDARD fixed). Recommended = max LP net PnL (fairway regime)
 * subject to retail cost ≤ baseline and p95 staleness ≤ bound.
 */
export function runSweep(
  cfg: SimConfig = DEFAULT_SIM_CONFIG,
  seeds = [1, 2, 3, 4],
  opts: { stalenessBoundBps?: number; toxic?: number[]; retail?: number[]; wu?: WarmupResult } = {},
): SweepOutput {
  const toxic = opts.toxic ?? SWEEP_TOXIC;
  const retail = opts.retail ?? SWEEP_RETAIL;
  const wu = opts.wu ?? warmup(cfg);
  const tierOf = tierOfFn(wu.tiers);
  const scenarios: Scenario[] = seeds.map((s) => makeScenario(cfg, s));
  const runAll = (regime: Regime, fees: FeeSchedule) =>
    averageMetrics(scenarios.map((sc) => runRegime(cfg, sc, { regime, fee: feeFunction(regime, fees, wu.tiers), tierOf }).metrics));
  const baseline = runAll('flat30', cfg.fees);
  const context = { flat5: runAll('flat5', cfg.fees), flat80: runAll('flat80', cfg.fees) };
  const bound = opts.stalenessBoundBps ?? Math.max(60, baseline.stalenessP95Bps * 3);
  const cells: SweepCell[] = [];
  for (const t of toxic) {
    for (const r of retail) {
      const fees: FeeSchedule = { RETAIL: r, STANDARD: cfg.fees.STANDARD, TOXIC: t };
      const fairway = runAll('fairway', fees);
      const rotation = runAll('rotation', fees);
      cells.push({
        toxicBps: t,
        retailBps: r,
        fairway,
        rotation,
        meetsRetailCost: fairway.retailCostBps <= baseline.retailCostBps,
        meetsStaleness: fairway.stalenessP95Bps <= bound,
      });
    }
  }
  const flatCurve = [5, 10, 15, 20, 30, 50, 80].map((f) => ({ feeBps: f, metrics: runAll('flat', { RETAIL: f, STANDARD: f, TOXIC: f }) }));
  const feasible = cells.filter((c) => c.meetsRetailCost && c.meetsStaleness);
  const pool = feasible.length ? feasible : cells;
  const best = pool.reduce((a, b) => (b.fairway.lpPnlVsHodlUsd > a.fairway.lpPnlVsHodlUsd ? b : a));
  const reason = feasible.length
    ? `Highest LP net PnL among ${feasible.length}/${cells.length} settings with retail cost ≤ baseline (${baseline.retailCostBps.toFixed(1)} bps) and p95 staleness ≤ ${bound.toFixed(0)} bps.`
    : 'No setting met every constraint; picked the highest LP net PnL overall.';
  return { synthetic: true, config: cfg, seeds, stalenessBoundBps: bound, toxic, retail, baseline, context, cells, flatCurve, recommended: { toxicBps: best.toxicBps, retailBps: best.retailBps, reason } };
}

export type SensitivityRow = { label: string; param: string; value: number; regime: Regime; lpPnlVsFlat30UsdPerDay: number; retailCostBps: number; retailCostSavedBps: number; stalenessP95Bps: number };

/**
 * Sensitivities: (1) retail fee elasticity (aggregators route more retail flow to a cheaper pool),
 * (2) the STANDARD fee in the wallet-rotation worst case (the lever that keeps LPs whole if every bot rotates).
 */
export function runSensitivity(cfg: SimConfig = DEFAULT_SIM_CONFIG, seeds = [1, 2, 3, 4], wu: WarmupResult = warmup(cfg)): SensitivityRow[] {
  const rows: SensitivityRow[] = [];
  const tierOf = tierOfFn(wu.tiers);
  const days = cfg.hours / 24;
  const run = (c: SimConfig, regime: Regime) =>
    averageMetrics(seeds.map((sd) => runRegime(c, makeScenario(c, sd), { regime, fee: feeFunction(regime, c.fees, wu.tiers), tierOf }).metrics));
  for (const e of [0, 0.5, 1]) {
    const c = { ...cfg, retail: { ...cfg.retail, elasticity: e } };
    const base = run(c, 'flat30');
    for (const regime of ['fairway', 'rotation'] as Regime[]) {
      const m = run(c, regime);
      rows.push({ label: `elasticity ${e}`, param: 'retail.elasticity', value: e, regime, lpPnlVsFlat30UsdPerDay: (m.lpPnlVsHodlUsd - base.lpPnlVsHodlUsd) / days, retailCostBps: m.retailCostBps, retailCostSavedBps: base.retailCostBps - m.retailCostBps, stalenessP95Bps: m.stalenessP95Bps });
    }
  }
  // informed-flow intensity: how much toxic flow is needed before tiering pays for the retail discount
  for (const mult of [0.25, 1, 2, 4]) {
    const c = { ...cfg, sniper: { ...cfg.sniper, probPerStep: cfg.sniper.probPerStep * mult } };
    const b = run(c, 'flat30');
    for (const regime of ['fairway', 'rotation'] as Regime[]) {
      const m = run(c, regime);
      rows.push({ label: `informed flow ×${mult}`, param: 'sniper.probPerStep×', value: mult, regime, lpPnlVsFlat30UsdPerDay: (m.lpPnlVsHodlUsd - b.lpPnlVsHodlUsd) / days, retailCostBps: m.retailCostBps, retailCostSavedBps: b.retailCostBps - m.retailCostBps, stalenessP95Bps: m.stalenessP95Bps });
    }
  }
  const base = run(cfg, 'flat30');
  for (const sfee of [30, 40, 50]) {
    const c = { ...cfg, fees: { ...cfg.fees, STANDARD: sfee } };
    const m = run(c, 'rotation');
    rows.push({ label: `STANDARD ${sfee} bps (rotation)`, param: 'fees.STANDARD', value: sfee, regime: 'rotation', lpPnlVsFlat30UsdPerDay: (m.lpPnlVsHodlUsd - base.lpPnlVsHodlUsd) / days, retailCostBps: m.retailCostBps, retailCostSavedBps: base.retailCostBps - m.retailCostBps, stalenessP95Bps: m.stalenessP95Bps });
  }
  return rows;
}
