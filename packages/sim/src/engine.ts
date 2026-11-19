import { Rng, arbTrade, cpOut, gbmPath } from '@fairway/fixtures';
import type { Swap, Tier } from '@fairway/scoring';
import type { FeeSchedule, Regime, SimConfig } from './config';

export type AgentType = 'retail' | 'arb' | 'sniper';

/** Pre-generated randomness for one seed, shared by every regime (common random numbers). */
export type Scenario = {
  seed: number;
  steps: number;
  stepSec: number;
  path: Float64Array;
  /** retail candidate orders, generated at the MAX elasticity rate and thinned per regime */
  retail: { step: Int32Array; wallet: Int32Array; buy: Uint8Array; usd: Float64Array; u: Float64Array };
  /** sniper inspection events */
  sniper: { step: Int32Array; wallet: Int32Array; usd: Float64Array };
  arbPick: Float64Array;
  retailWeights: Float64Array;
};

export function makeScenario(cfg: SimConfig, seed: number, hours = cfg.hours): Scenario {
  const steps = Math.round((hours * 3600) / cfg.stepSec);
  const path = gbmPath({ seed: seed * 7919 + 1, s0: cfg.s0, steps, stepSec: cfg.stepSec, annualVol: cfg.annualVol });
  if (cfg.jumpsPerDay > 0 && cfg.jumpSdBps > 0) {
    const jr = new Rng(seed * 31_337 + 5);
    const pJump = (cfg.jumpsPerDay * cfg.stepSec) / 86_400;
    let mult = 1;
    for (let i = 1; i <= steps; i++) {
      if (jr.next() < pJump) mult *= Math.exp((cfg.jumpSdBps / 10_000) * jr.normal());
      path[i] = path[i]! * mult;
    }
  }
  const rng = new Rng(seed * 104_729 + 3);
  // wallet activity weights are a property of the population, fixed across seeds
  const wrng = new Rng(cfg.seed + 17);
  const retailWeights = new Float64Array(cfg.retail.nWallets);
  for (let i = 0; i < retailWeights.length; i++) retailWeights[i] = wrng.lognormal(1, 1);
  const cum = new Float64Array(retailWeights.length);
  let acc = 0;
  for (let i = 0; i < retailWeights.length; i++) cum[i] = acc += retailWeights[i]!;
  const pickWallet = (u: number) => {
    const x = u * acc;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cum[m]! > x) hi = m;
      else lo = m + 1;
    }
    return lo;
  };
  const maxMult = 1 + Math.max(0, cfg.retail.elasticity);
  const lambda = ((cfg.retail.perMin * cfg.stepSec) / 60) * maxMult;
  const rs: number[] = [];
  const rw: number[] = [];
  const rb: number[] = [];
  const ru: number[] = [];
  const rU: number[] = [];
  for (let s = 1; s <= steps; s++) {
    const k = rng.poisson(lambda);
    for (let j = 0; j < k; j++) {
      rs.push(s);
      rw.push(pickWallet(rng.next()));
      rb.push(rng.bool() ? 1 : 0);
      ru.push(Math.min(rng.lognormal(cfg.retail.medianUsd, cfg.retail.sigma), cfg.retail.maxUsd));
      rU.push(rng.next());
    }
  }
  const ss: number[] = [];
  const sw: number[] = [];
  const su: number[] = [];
  for (let s = 1; s + cfg.sniper.lookaheadSteps <= steps; s++) {
    if (rng.next() < cfg.sniper.probPerStep) {
      ss.push(s);
      sw.push(rng.int(cfg.sniper.nWallets));
      su.push(rng.lognormal(cfg.sniper.medianUsd, 0.4));
    }
  }
  const arbPick = new Float64Array(steps + 1);
  for (let s = 0; s <= steps; s++) arbPick[s] = rng.next();
  return {
    seed,
    steps,
    stepSec: cfg.stepSec,
    path,
    retail: { step: Int32Array.from(rs), wallet: Int32Array.from(rw), buy: Uint8Array.from(rb), usd: Float64Array.from(ru), u: Float64Array.from(rU) },
    sniper: { step: Int32Array.from(ss), wallet: Int32Array.from(sw), usd: Float64Array.from(su) },
    arbPick,
    retailWeights,
  };
}

/** Learned tiers per agent (from a warm-up run + the scoring package). */
export type TierBook = { retail: Tier[]; arb: Tier[]; sniper: Tier[] };

export const walletId = (type: AgentType, i: number) => `${type}-${i}`;

export type FeeFn = (type: AgentType, wallet: number) => number;

export function feeFunction(regime: Regime, fees: FeeSchedule, tiers: TierBook | null): FeeFn {
  switch (regime) {
    case 'flat30':
      return () => 30;
    case 'flat5':
      return () => 5;
    case 'flat80':
      return () => 80;
    case 'flat':
      return () => fees.STANDARD;
    case 'fairway':
      return (type, w) => fees[(tiers?.[type][w] ?? 'STANDARD') as Tier];
    case 'rotation':
      // informed agents rotate to fresh wallets → always STANDARD; retail keeps its learned tier
      return (type, w) => (type === 'retail' ? fees[(tiers?.retail[w] ?? 'STANDARD') as Tier] : fees.STANDARD);
  }
}

export type TierOfFn = (type: AgentType, wallet: number) => Tier;

export type RunMetrics = {
  regime: Regime;
  seed: number;
  /** LP fee revenue in USD (fees valued at CEX mid when paid) */
  lpFeesUsd: number;
  lpFeesByTier: Record<Tier, number>;
  lpFeesByAgent: Record<AgentType, number>;
  /** arbitrage profit at CEX mid — the LVR proxy */
  arbProfitUsd: number;
  /** sniper profit marked at the CEX price `lookahead` later */
  sniperProfitUsd: number;
  /** fees − LVR proxy */
  feesMinusLvrUsd: number;
  /** LP value (reserves + accrued fees at final CEX) − HODL value (initial reserves at final CEX) */
  lpPnlVsHodlUsd: number;
  lpPnlVsHodlBps: number;
  /** notional-weighted retail execution cost vs CEX mid (fee + impact + staleness), bps */
  retailCostBps: number;
  retailFeeBps: number;
  retailCostUsd: number;
  stalenessMeanBps: number;
  stalenessP95Bps: number;
  volumeUsd: Record<AgentType, number>;
  trades: Record<AgentType, number>;
  initialTvlUsd: number;
};

export type TimeSeries = { t: number[]; cex: number[]; pool: number[]; lpPnl: number[]; feesUsd: number[]; arbUsd: number[]; sniperUsd: number[] };

export type RunOptions = {
  regime: Regime;
  fee: FeeFn;
  tierOf?: TierOfFn;
  /** record every trade as a canonical Swap (warm-up / replay) */
  recordSwaps?: boolean;
  timeseries?: boolean;
  /** ts of step 0 for recorded swaps */
  startTs?: number;
};

export type RunResult = { metrics: RunMetrics; swaps?: Swap[]; series?: TimeSeries };

const HIST_BIN = 0.25; // bps
const HIST_N = 8_000; // up to 2000 bps

/** Run one regime over a scenario. Pure function of (cfg, scenario, options). */
export function runRegime(cfg: SimConfig, sc: Scenario, opt: RunOptions): RunResult {
  const path = sc.path;
  const B0 = cfg.poolBase;
  const Q0 = cfg.poolBase * cfg.s0;
  let B = B0;
  let Q = Q0;
  let feeBase = 0;
  let feeQuote = 0;
  const m: RunMetrics = {
    regime: opt.regime,
    seed: sc.seed,
    lpFeesUsd: 0,
    lpFeesByTier: { RETAIL: 0, STANDARD: 0, TOXIC: 0 },
    lpFeesByAgent: { retail: 0, arb: 0, sniper: 0 },
    arbProfitUsd: 0,
    sniperProfitUsd: 0,
    feesMinusLvrUsd: 0,
    lpPnlVsHodlUsd: 0,
    lpPnlVsHodlBps: 0,
    retailCostBps: 0,
    retailFeeBps: 0,
    retailCostUsd: 0,
    stalenessMeanBps: 0,
    stalenessP95Bps: 0,
    volumeUsd: { retail: 0, arb: 0, sniper: 0 },
    trades: { retail: 0, arb: 0, sniper: 0 },
    initialTvlUsd: 2 * Q0,
  };
  const tierOf: TierOfFn = opt.tierOf ?? (() => 'STANDARD');
  const swaps: Swap[] | undefined = opt.recordSwaps ? [] : undefined;
  const series: TimeSeries | undefined = opt.timeseries ? { t: [], cex: [], pool: [], lpPnl: [], feesUsd: [], arbUsd: [], sniperUsd: [] } : undefined;
  const sampleEvery = Math.max(1, Math.round(cfg.sampleEverySec / sc.stepSec));
  const hist = new Uint32Array(HIST_N + 1);
  let stalenessSum = 0;
  let retailNotional = 0;
  let retailCostWeighted = 0;
  let retailFeeWeighted = 0;
  const startTs = opt.startTs ?? 0;
  let swapN = 0;

  /** execute a trade; returns {out, gross} or null */
  const trade = (step: number, type: AgentType, wallet: number, buy: boolean, grossIn: number, feeBps: number) => {
    if (!(grossIn > 0)) return null;
    const f = feeBps / 10_000;
    const cex = path[step]!;
    const net = grossIn * (1 - f);
    const feeAmt = grossIn - net;
    let out: number;
    let feeUsd: number;
    let notional: number;
    if (buy) {
      out = cpOut(net, Q, B);
      if (!(out > 0) || out >= B) return null;
      Q += net;
      B -= out;
      feeQuote += feeAmt;
      feeUsd = feeAmt;
      notional = grossIn;
    } else {
      out = cpOut(net, B, Q);
      if (!(out > 0) || out >= Q) return null;
      B += net;
      Q -= out;
      feeBase += feeAmt;
      feeUsd = feeAmt * cex;
      notional = grossIn * cex;
    }
    const tier = tierOf(type, wallet);
    m.lpFeesUsd += feeUsd;
    m.lpFeesByTier[tier] += feeUsd;
    m.lpFeesByAgent[type] += feeUsd;
    m.volumeUsd[type] += notional;
    m.trades[type] += 1;
    if (swaps) {
      swaps.push({
        sig: `${sc.seed}-${opt.regime}-${swapN++}`,
        slot: step,
        ts: startTs + step * sc.stepSec,
        pool: 'SIM',
        venue: 'fixture',
        trader: walletId(type, wallet),
        side: buy ? 'buy' : 'sell',
        baseAmount: buy ? out : grossIn,
        quoteAmount: buy ? grossIn : out,
        execPrice: buy ? net / out : out / net,
        feeBps,
        tier,
      });
    }
    return { out, gross: grossIn, notional };
  };

  let ri = 0;
  let si = 0;
  const R = sc.retail;
  const S = sc.sniper;
  const nArb = cfg.arb.nWallets;

  for (let step = 1; step <= sc.steps; step++) {
    const cex = path[step]!;
    // 1) arbitrage: one arb per step trades the pool to its no-arb boundary
    {
      const w = Math.min(nArb - 1, Math.floor(sc.arbPick[step]! * nArb));
      const feeBps = opt.fee('arb', w);
      const t = arbTrade({ base: B, quote: Q }, cex, feeBps);
      if (t) {
        const f = feeBps / 10_000;
        const gross = t.inAfterFee / (1 - f);
        const profit = t.side === 'buy' ? cpOut(t.inAfterFee, Q, B) * cex - gross : cpOut(t.inAfterFee, B, Q) - gross * cex;
        if (profit > cfg.arb.gasUsd) {
          const r = trade(step, 'arb', w, t.side === 'buy', gross, feeBps);
          if (r) m.arbProfitUsd += profit;
        }
      }
    }
    // 2) snipers: know the CEX price `lookahead` steps ahead
    while (si < S.step.length && S.step[si]! === step) {
      const w = S.wallet[si]!;
      const usd = S.usd[si]!;
      const fut = path[step + cfg.sniper.lookaheadSteps]!;
      const feeBps = opt.fee('sniper', w);
      const poolPx = Q / B;
      const buy = fut > poolPx;
      // expected edge vs pool price, minus fee and price impact (≈ trade / quote reserve)
      const edgeBps = (Math.abs(fut - poolPx) / poolPx) * 10_000 - feeBps - (usd / Q) * 10_000;
      if (edgeBps > cfg.sniper.minEdgeBps) {
        const r = trade(step, 'sniper', w, buy, buy ? usd : usd / poolPx, feeBps);
        if (r) m.sniperProfitUsd += buy ? r.out * fut - r.gross : r.out - r.gross * fut;
      }
      si++;
    }
    // 3) retail: price-insensitive, random direction
    while (ri < R.step.length && R.step[ri]! === step) {
      const w = R.wallet[ri]!;
      const feeBps = opt.fee('retail', w);
      const e = cfg.retail.elasticity;
      const accept = e > 0 ? (1 + e * (cfg.fees.STANDARD - feeBps) / cfg.fees.STANDARD) / (1 + e) : 1;
      if (R.u[ri]! < accept) {
        const buy = R.buy[ri]! === 1;
        const usd = R.usd[ri]!;
        const poolPx = Q / B;
        const r = trade(step, 'retail', w, buy, buy ? usd : usd / poolPx, feeBps);
        if (r) {
          const eff = buy ? r.gross / r.out : r.out / r.gross;
          const costBps = buy ? (eff / cex - 1) * 10_000 : (1 - eff / cex) * 10_000;
          retailNotional += r.notional;
          retailCostWeighted += costBps * r.notional;
          retailFeeWeighted += feeBps * r.notional;
        }
      }
      ri++;
    }
    // staleness of the pool the next trader sees
    const dev = Math.abs(Q / B / cex - 1) * 10_000;
    stalenessSum += dev;
    hist[Math.min(HIST_N, Math.floor(dev / HIST_BIN))]! += 1;
    if (series && step % sampleEvery === 0) {
      const lpVal = (B + feeBase) * cex + Q + feeQuote;
      series.t.push(step * sc.stepSec);
      series.cex.push(cex);
      series.pool.push(Q / B);
      series.lpPnl.push(lpVal - (B0 * cex + Q0));
      series.feesUsd.push(m.lpFeesUsd);
      series.arbUsd.push(m.arbProfitUsd);
      series.sniperUsd.push(m.sniperProfitUsd);
    }
  }

  const PT = path[sc.steps]!;
  m.lpPnlVsHodlUsd = (B + feeBase) * PT + Q + feeQuote - (B0 * PT + Q0);
  m.lpPnlVsHodlBps = (m.lpPnlVsHodlUsd / (B0 * PT + Q0)) * 10_000;
  m.feesMinusLvrUsd = m.lpFeesUsd - m.arbProfitUsd;
  m.retailCostBps = retailNotional > 0 ? retailCostWeighted / retailNotional : 0;
  m.retailFeeBps = retailNotional > 0 ? retailFeeWeighted / retailNotional : 0;
  m.retailCostUsd = retailCostWeighted / 10_000;
  m.stalenessMeanBps = stalenessSum / sc.steps;
  const target = 0.95 * sc.steps;
  let c = 0;
  for (let i = 0; i <= HIST_N; i++) {
    c += hist[i]!;
    if (c >= target) {
      m.stalenessP95Bps = (i + 1) * HIST_BIN;
      break;
    }
  }
  return { metrics: m, swaps, series };
}
