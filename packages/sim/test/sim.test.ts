import { describe, expect, it } from 'vitest';
import type { Swap, WalletScore } from '@fairway/scoring';
import { DEFAULT_SIM_CONFIG, feeFunction, makeScenario, mergeConfig, replay, runBacktest, runLpFirst, runRegime, runSweep, warmup, type SimConfig } from '../src';

const cfg: SimConfig = mergeConfig({ hours: 3, warmupHours: 72 });
const sc = makeScenario(cfg, 1);
const run = (regime: Parameters<typeof feeFunction>[0], tiers = null as any) => runRegime(cfg, sc, { regime, fee: feeFunction(regime, cfg.fees, tiers) }).metrics;

describe('engine', () => {
  it('is deterministic', () => {
    expect(run('flat30')).toEqual(runRegime(cfg, makeScenario(cfg, 1), { regime: 'flat30', fee: () => 30 }).metrics);
  });
  it('higher arb fee → less arb profit, more staleness', () => {
    const f5 = run('flat5');
    const f30 = run('flat30');
    const f80 = run('flat80');
    expect(f5.arbProfitUsd).toBeGreaterThan(f30.arbProfitUsd);
    expect(f30.arbProfitUsd).toBeGreaterThan(f80.arbProfitUsd);
    expect(f5.stalenessMeanBps).toBeLessThan(f30.stalenessMeanBps);
    expect(f30.stalenessP95Bps).toBeLessThan(f80.stalenessP95Bps);
    expect(f80.stalenessP95Bps).toBeLessThan(85);
  });
  it('fairway with no learned tiers equals flat 30 (unknown wallets pay STANDARD)', () => {
    const fw = run('fairway', null);
    const f30 = run('flat30');
    expect(fw.lpFeesUsd).toBeCloseTo(f30.lpFeesUsd, 6);
    expect(fw.lpPnlVsHodlUsd).toBeCloseTo(f30.lpPnlVsHodlUsd, 6);
  });
  it('accounting: retail fee ≈ fee bps; LP PnL identity holds with zero flow', () => {
    const f30 = run('flat30');
    expect(f30.retailFeeBps).toBeCloseTo(30, 6);
    expect(f30.retailCostBps).toBeGreaterThan(30);
    const empty = mergeConfig({ hours: 1, retail: { perMin: 0 }, sniper: { probPerStep: 0 }, arb: { gasUsd: 1e12 } });
    const m = runRegime(empty, makeScenario(empty, 3), { regime: 'flat30', fee: () => 30 }).metrics;
    expect(m.lpPnlVsHodlUsd).toBeCloseTo(0, 6);
    expect(m.trades).toEqual({ retail: 0, arb: 0, sniper: 0 });
  });
  it('common random numbers: retail order flow identical across regimes', () => {
    expect(run('flat5').trades.retail).toBe(run('flat80').trades.retail);
  });
  it('elasticity thins retail flow at higher fees', () => {
    const e = mergeConfig({ hours: 3, retail: { elasticity: 1 } });
    const s = makeScenario(e, 1);
    const lo = runRegime(e, s, { regime: 'flat5', fee: () => 5 }).metrics.trades.retail;
    const hi = runRegime(e, s, { regime: 'flat30', fee: () => 30 }).metrics.trades.retail;
    expect(lo).toBeGreaterThan(hi * 1.5);
  });
  it('records canonical swaps when asked', () => {
    const r = runRegime(cfg, sc, { regime: 'flat30', fee: () => 30, recordSwaps: true });
    expect(r.swaps!.length).toBe(r.metrics.trades.retail + r.metrics.trades.arb + r.metrics.trades.sniper);
    expect(r.swaps![0]!.execPrice).toBeGreaterThan(0);
  });
});

describe('warm-up + regimes', () => {
  const wu = warmup(cfg);
  it('learns tiers: arbs and snipers TOXIC, most retail volume RETAIL', () => {
    expect(wu.tiers.arb.every((t) => t === 'TOXIC')).toBe(true);
    expect(wu.tiers.sniper.every((t) => t === 'TOXIC')).toBe(true);
    expect(wu.retailShareClassified).toBeGreaterThan(0.6);
  });
  it('backtest: fairway cuts retail cost and arb profit; rotation arbs behave like flat 30', () => {
    const bt = runBacktest(cfg, [1, 2], wu);
    const m = Object.fromEntries(bt.regimes.map((r) => [r.regime, r.mean]));
    expect(m.fairway!.retailCostBps).toBeLessThan(m.flat30!.retailCostBps - 10);
    expect(m.fairway!.arbProfitUsd).toBeLessThan(m.flat30!.arbProfitUsd);
    expect(m.rotation!.arbProfitUsd).toBeCloseTo(m.flat30!.arbProfitUsd, -1);
    expect(m.fairway!.lpPnlVsHodlUsd).toBeGreaterThan(m.flat5!.lpPnlVsHodlUsd);
    expect(bt.headline.lpPnlVsFlat5UsdPerDay).toBeGreaterThan(0);
    expect(bt.series.flat30.t.length).toBeGreaterThan(10);
  });
  it('sweep: full grid and a recommended cell from the grid', () => {
    const sw = runSweep(mergeConfig({ hours: 1 }), [1], { wu, toxic: [30, 80], retail: [5, 20] });
    expect(sw.cells).toHaveLength(4);
    expect([30, 80]).toContain(sw.recommended.toxicBps);
    expect([5, 20]).toContain(sw.recommended.retailBps);
    // rotation is insensitive to the toxic fee (bots never pay it)
    const r = sw.cells.filter((c) => c.retailBps === 5).map((c) => c.rotation.arbProfitUsd);
    expect(r[0]).toBeCloseTo(r[1]!, 6);
  });
});

describe('replay (static counterfactual)', () => {
  const swaps: Swap[] = [
    { sig: 'a', slot: 1, ts: 1, pool: 'P', venue: 'fixture', trader: 'R', side: 'buy', baseAmount: 1, quoteAmount: 1000, execPrice: 1000 },
    { sig: 'b', slot: 2, ts: 2, pool: 'P', venue: 'fixture', trader: 'T', side: 'sell', baseAmount: 1, quoteAmount: 1000, execPrice: 1000 },
    { sig: 'c', slot: 3, ts: 3, pool: 'P', venue: 'fixture', trader: 'U', side: 'sell', baseAmount: 1, quoteAmount: 1000, execPrice: 1000 },
  ];
  const scores = [
    { trader: 'R', tier: 'RETAIL' },
    { trader: 'T', tier: 'TOXIC' },
  ] as WalletScore[];
  it('re-prices each trade by tier', () => {
    const r = replay(swaps, scores, [
      { name: 'flat', fees: 30 },
      { name: 'tiers', fees: { RETAIL: 5, STANDARD: 30, TOXIC: 80 } },
    ]);
    expect(r.rows[0]!.lpFeesUsd).toBeCloseTo(9);
    expect(r.rows[1]!.lpFeesUsd).toBeCloseTo(0.5 + 3 + 8);
    expect(r.retailSavingsUsd).toBeCloseTo(2.5);
    expect(r.toxicExtraFeesUsd).toBeCloseTo(5);
    expect(r.rows[1]!.avgFeeBpsByTier.STANDARD).toBeCloseTo(30);
  });
});

it('default config matches the spec', () => {
  expect(DEFAULT_SIM_CONFIG.stepSec).toBe(0.4);
  expect(DEFAULT_SIM_CONFIG.annualVol).toBe(0.6);
  expect(DEFAULT_SIM_CONFIG.hours).toBe(24);
  expect(DEFAULT_SIM_CONFIG.poolBase * DEFAULT_SIM_CONFIG.s0).toBe(1_500_000);
  expect(DEFAULT_SIM_CONFIG.fees).toEqual({ RETAIL: 5, STANDARD: 30, TOXIC: 80 });
});

describe('bot-tax rebate regime (M15)', () => {
  const fees = { RETAIL: 30, STANDARD: 30, TOXIC: 80 };
  const tiers = { retail: Array.from({ length: cfg.retail.nWallets }, () => 'RETAIL' as const), arb: Array.from({ length: cfg.arb.nWallets }, () => 'TOXIC' as const), sniper: Array.from({ length: cfg.sniper.nWallets }, () => 'TOXIC' as const) };
  const tierOf = (t: 'retail' | 'arb' | 'sniper', w: number) => tiers[t][w]!;
  const reb = (share: number, floorBps = 5, f = fees) => runRegime({ ...cfg, fees: f }, sc, { regime: 'rebate', fee: feeFunction('rebate', f, tiers), tierOf, rebate: { share, epochSec: 3_600, floorBps } }).metrics;

  it('rebate handed out never exceeds the budget funded by the toxic premium', () => {
    for (const share of [0.1, 0.5, 1]) {
      const m = reb(share);
      expect(m.rebateUsd).toBeGreaterThan(0);
      expect(m.rebateUsd).toBeLessThanOrEqual(m.rebateBudgetUsd + 1e-9);
      expect(m.rebateUsd).toBeLessThanOrEqual(share * m.botExtraFeesUsd + 1e-9);
    }
  });
  it('no toxic premium → no rebate, identical to flat 30', () => {
    const m = reb(1, 5, { RETAIL: 30, STANDARD: 30, TOXIC: 30 });
    const f30 = run('flat30');
    expect(m.rebateUsd).toBe(0);
    expect(m.lpPnlVsHodlUsd).toBeCloseTo(f30.lpPnlVsHodlUsd, 6);
    expect(m.retailCostBps).toBeCloseTo(f30.retailCostBps, 6);
  });
  it('retail fee floor holds: a 100% share cannot push the fee below the floor', () => {
    const m = reb(1, 25);
    expect(m.retailFeeBps).toBeGreaterThanOrEqual(25 - 1e-9);
    expect(m.retailFeeBps).toBeLessThanOrEqual(30 + 1e-9);
  });
  it('the first epoch has no rebate (it is funded by the previous one)', () => {
    const short = mergeConfig({ hours: 0.9 });
    const m = runRegime({ ...short, fees }, makeScenario(short, 1), { regime: 'rebate', fee: feeFunction('rebate', fees, tiers), tierOf, rebate: { share: 1, epochSec: 3_600, floorBps: 5 } }).metrics;
    expect(m.rebateUsd).toBe(0);
  });
  it('rebate lowers the retail fee below 30 and costs LPs exactly what it hands out', () => {
    const m = reb(0.5);
    const noReb = runRegime({ ...cfg, fees }, sc, { regime: 'rebate', fee: feeFunction('rebate', fees, tiers), tierOf }).metrics;
    expect(m.retailFeeBps).toBeLessThan(30);
    expect(m.retailCostBps).toBeLessThan(noReb.retailCostBps);
    expect(noReb.lpFeesUsd - m.lpFeesUsd).toBeGreaterThan(0);
  });
});

describe('LP-first analysis output', () => {
  it('is deterministic and reports the honest verdict', () => {
    const small = mergeConfig({ hours: 2, warmupHours: 24 });
    const wu = warmup(small);
    const a = runLpFirst(small, [1, 2], wu);
    const b = runLpFirst(small, [1, 2], wu);
    expect(a).toEqual(b);
    expect(a.cells.some((c) => c.kind === 'max-discount')).toBe(true);
    expect(a.cells.filter((c) => c.extended).every((c) => c.fees.TOXIC > 100)).toBe(true);
    expect(a.recommended.beatsNoise).toBe(a.cells.find((c) => c.id === a.recommended.id)!.lpAfterProtocol[a.recommended.protocolOption]!.beatsNoise);
    // protocol options: premium-only shares are strictly cheaper for LPs than 15% of all fees
    const c = a.cells.find((x) => x.id === a.recommended.id)!;
    expect(c.protocolUsdPerDay.premium15).toBeLessThan(c.protocolUsdPerDay.all15);
  });
});
