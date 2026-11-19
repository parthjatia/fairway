import type { FeeSchedule, SimConfig } from './config';
import { DEFAULT_SIM_CONFIG } from './config';
import { averageMetrics, warmup, type WarmupResult } from './backtest';
import { feeFunction, makeScenario, runRegime, type RunMetrics, type Scenario, type TierBook } from './engine';
import type { Regime } from './config';
import type { Tier } from '@fairway/scoring';

/**
 * M15 "LP-first" analysis: raise the fee only for proven-toxic wallets, keep retail at the normal 30 bps, and
 * recycle part of the toxic premium to retail as a bot-tax rebate. No retail elasticity (clearly separate extra).
 */

export const LPFIRST_TOXIC = [40, 50, 60, 80, 100];
/** beyond the requested grid; shown as clearly labelled extension rows, never recommended */
export const LPFIRST_TOXIC_EXT = [150, 200];
export const LPFIRST_REBATE_SHARE = [0.1, 0.25, 0.5];
export const REBATE_FLOOR_BPS = 5;
export const REBATE_EPOCH_SEC = 3_600;
/** a result "beats noise" when the paired mean difference exceeds this many standard errors */
export const NOISE_SIGMAS = 2;
/** the recommended setting may let p95 pool-vs-CEX deviation grow by at most this much vs flat 30 */
export const MAX_P95_WORSE_BPS = 50;

export type ProtocolOption = { id: string; label: string; kind: 'all' | 'premium'; share: number };
export const PROTOCOL_OPTIONS: ProtocolOption[] = [
  { id: 'all15', label: '15% of all fees (M14 default)', kind: 'all', share: 0.15 },
  { id: 'all10', label: '10% of all fees', kind: 'all', share: 0.1 },
  { id: 'all5', label: '5% of all fees', kind: 'all', share: 0.05 },
  { id: 'premium15', label: '15% of the toxic premium only', kind: 'premium', share: 0.15 },
  { id: 'premium30', label: '30% of the toxic premium only', kind: 'premium', share: 0.3 },
];

const protocolUsd = (m: RunMetrics, o: ProtocolOption) => (o.kind === 'all' ? o.share * m.lpFeesUsd : o.share * m.botExtraFeesUsd);

export type Band = { mean: number; stderr: number; /** mean − NOISE_SIGMAS·stderr > 0 */ beatsNoise: boolean };

const stats = (xs: number[]): Band => {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const v = n > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const stderr = Math.sqrt(v / n);
  return { mean, stderr, beatsNoise: mean - NOISE_SIGMAS * stderr > 0 };
};

export type LpFirstCell = {
  id: string;
  kind: 'toxic-only' | 'rebate' | 'max-discount';
  /** outside the requested grid (extension row) */
  extended: boolean;
  label: string;
  fees: FeeSchedule;
  rebateShare: number;
  /** per-day, paired vs flat 30 (same random world) */
  lpBeforeProtocol: Band;
  /** LP PnL vs flat 30 after each protocol-share option */
  lpAfterProtocol: Record<string, Band>;
  retailCostBps: Band & { vsFlat30Bps: Band };
  lvrReductionPct: Band;
  /** arb + sniper profit reduction vs flat 30 */
  botProfitReductionPct: Band;
  stalenessP95Bps: Band;
  stalenessP95VsFlat30Bps: Band;
  rotationLpBeforeProtocol: Band;
  rotationLpAfterProtocol: Record<string, Band>;
  rotationRetailVsFlat30Bps: Band;
  protocolUsdPerDay: Record<string, number>;
  botExtraFeesUsdPerDay: number;
  rebateUsdPerDay: number;
  /** fraction of retail volume that is RETAIL tier (rebate-eligible) and mean effective retail fee, bps */
  retailFeeBps: number;
};

export type LpFirstOutput = {
  synthetic: true;
  note: string;
  config: SimConfig;
  seeds: number[];
  noiseSigmas: number;
  rebate: { epochSec: number; floorBps: number };
  baseline: { flat30: RunMetrics; flat5: RunMetrics };
  protocolOptions: ProtocolOption[];
  cells: LpFirstCell[];
  recommended: { id: string; toxicBps: number; rebateShare: number; protocolOption: string; beatsNoise: boolean; reason: string };
  elasticityExtra: { note: string; rows: Array<{ elasticity: number; lpBeforeProtocol: Band; lpAfterProtocol: Band; retailVsFlat30Bps: Band }> };
};

type Tiers = TierBook;

export function runLpFirst(cfg: SimConfig = DEFAULT_SIM_CONFIG, seeds = [1, 2, 3, 4, 5, 6, 7, 8], wu: WarmupResult = warmup(cfg)): LpFirstOutput {
  const tiers: Tiers = wu.tiers;
  const tierOf = (type: 'retail' | 'arb' | 'sniper', w: number): Tier => tiers[type][w] ?? 'STANDARD';
  const days = cfg.hours / 24;
  const scenarios: Scenario[] = seeds.map((s) => makeScenario(cfg, s));
  const runEach = (regime: Regime, fees: FeeSchedule, share = 0) =>
    scenarios.map((sc) => {
      const c = { ...cfg, fees };
      return runRegime(c, sc, {
        regime,
        fee: feeFunction(regime, fees, tiers),
        tierOf,
        rebate: share > 0 ? { share, epochSec: REBATE_EPOCH_SEC, floorBps: REBATE_FLOOR_BPS } : undefined,
      }).metrics;
    });
  const flat30 = runEach('flat30', cfg.fees);
  const flat5 = runEach('flat5', cfg.fees);
  const paired = (a: RunMetrics[], f: (m: RunMetrics, i: number) => number) => stats(a.map(f));

  const mk = (id: string, kind: LpFirstCell['kind'], label: string, fees: FeeSchedule, share: number, extended = false): LpFirstCell => {
    const regime: Regime = kind === 'max-discount' ? 'fairway' : 'rebate';
    const rotRegime: Regime = 'rotation';
    const fw = runEach(regime, fees, share);
    // worst case: informed bots rotate to fresh wallets, so they pay STANDARD; the rebate pool then only exists if some bots are still caught
    const rot = runEach(rotRegime, fees, 0);
    const lpAfter: Record<string, Band> = {};
    const rotAfter: Record<string, Band> = {};
    const protoPerDay: Record<string, number> = {};
    for (const o of PROTOCOL_OPTIONS) {
      lpAfter[o.id] = paired(fw, (m, i) => (m.lpPnlVsHodlUsd - protocolUsd(m, o) - flat30[i]!.lpPnlVsHodlUsd) / days);
      // in rotation bots pay 30: the premium is ~0, so a premium-only protocol fee earns ~0 there (and LPs keep everything)
      rotAfter[o.id] = paired(rot, (m, i) => (m.lpPnlVsHodlUsd - protocolUsd(m, o) - flat30[i]!.lpPnlVsHodlUsd) / days);
      protoPerDay[o.id] = averageMetrics(fw).lpFeesUsd >= 0 ? fw.reduce((a, m) => a + protocolUsd(m, o), 0) / fw.length / days : 0;
    }
    const avgFw = averageMetrics(fw);
    return {
      id,
      kind,
      extended,
      label,
      fees,
      rebateShare: share,
      lpBeforeProtocol: paired(fw, (m, i) => (m.lpPnlVsHodlUsd - flat30[i]!.lpPnlVsHodlUsd) / days),
      lpAfterProtocol: lpAfter,
      retailCostBps: { ...stats(fw.map((m) => m.retailCostBps)), vsFlat30Bps: paired(fw, (m, i) => m.retailCostBps - flat30[i]!.retailCostBps) },
      lvrReductionPct: paired(fw, (m, i) => (flat30[i]!.arbProfitUsd > 0 ? (1 - m.arbProfitUsd / flat30[i]!.arbProfitUsd) * 100 : 0)),
      botProfitReductionPct: paired(fw, (m, i) => {
        const b = flat30[i]!.arbProfitUsd + flat30[i]!.sniperProfitUsd;
        return b > 0 ? (1 - (m.arbProfitUsd + m.sniperProfitUsd) / b) * 100 : 0;
      }),
      stalenessP95Bps: stats(fw.map((m) => m.stalenessP95Bps)),
      stalenessP95VsFlat30Bps: paired(fw, (m, i) => m.stalenessP95Bps - flat30[i]!.stalenessP95Bps),
      rotationLpBeforeProtocol: paired(rot, (m, i) => (m.lpPnlVsHodlUsd - flat30[i]!.lpPnlVsHodlUsd) / days),
      rotationLpAfterProtocol: rotAfter,
      rotationRetailVsFlat30Bps: paired(rot, (m, i) => m.retailCostBps - flat30[i]!.retailCostBps),
      protocolUsdPerDay: protoPerDay,
      botExtraFeesUsdPerDay: avgFw.botExtraFeesUsd / days,
      rebateUsdPerDay: avgFw.rebateUsd / days,
      retailFeeBps: avgFw.retailFeeBps,
    };
  };

  const cells: LpFirstCell[] = [];
  for (const [list, ext] of [[LPFIRST_TOXIC, false], [LPFIRST_TOXIC_EXT, true]] as const) {
    for (const t of list) cells.push(mk(`toxic-${t}`, 'toxic-only', `Retail = standard = 30, toxic ${t}`, { RETAIL: 30, STANDARD: 30, TOXIC: t }, 0, ext));
    for (const r of LPFIRST_REBATE_SHARE)
      for (const t of list)
        cells.push(mk(`rebate-${Math.round(r * 100)}-${t}`, 'rebate', `Toxic ${t}, rebate ${Math.round(r * 100)}% of premium`, { RETAIL: 30, STANDARD: 30, TOXIC: t }, r, ext));
  }
  cells.push(mk('max-discount-5-30-80', 'max-discount', 'Max retail discount 5 / 30 / 80 (previous design)', { RETAIL: 5, STANDARD: 30, TOXIC: 80 }, 0));

  // Selection rule (the LP-first criterion "LP net beats flat 30 beyond noise" is reported, not forced):
  //  feasible = rebate cell on the requested grid, retail cost strictly below flat 30, p95 staleness at most +MAX_P95_WORSE_BPS vs flat 30
  //  pick the (cell, protocol option) with the highest LP net vs flat 30 after the protocol share.
  const feasible: Array<{ cell: LpFirstCell; opt: ProtocolOption; b: Band }> = [];
  for (const c of cells) {
    if (c.kind !== 'rebate' || c.extended) continue;
    if (!(c.retailCostBps.vsFlat30Bps.mean < 0)) continue;
    if (c.stalenessP95VsFlat30Bps.mean > MAX_P95_WORSE_BPS) continue;
    for (const o of PROTOCOL_OPTIONS) feasible.push({ cell: c, opt: o, b: c.lpAfterProtocol[o.id]! });
  }
  const top = feasible.reduce((a, x) => (x.b.mean > a.b.mean ? x : a), feasible[0]!);
  // many cells differ by less than the noise band: among those within NOISE_SIGMAS·stderr of the best LP net, take the largest LVR cut
  const tied = feasible.filter((x) => x.b.mean >= top.b.mean - NOISE_SIGMAS * Math.max(top.b.stderr, x.b.stderr));
  const winner = tied.reduce((a, x) => (x.cell.lvrReductionPct.mean > a.cell.lvrReductionPct.mean || (x.cell.lvrReductionPct.mean === a.cell.lvrReductionPct.mean && x.b.mean > a.b.mean) ? x : a), tied[0]!);
  const best = feasible.length ? { cell: winner.cell, opt: winner.opt, mean: winner.b.mean } : null;
  const pick = best ?? { cell: cells.find((c) => c.kind === 'rebate')!, opt: PROTOCOL_OPTIONS[0]!, mean: 0 };
  const lp = pick.cell.lpAfterProtocol[pick.opt.id]!;
  const reason =
    `LP net vs flat 30 after the protocol share among rebate settings on the requested grid with retail cost below flat 30 and p95 staleness at most +${MAX_P95_WORSE_BPS} bps vs flat 30; settings within the noise band of the best LP net are ranked by LVR reduction. ` +
    (lp.beatsNoise
      ? 'LP net beats flat 30 beyond the noise band.'
      : `HONEST: LP net vs flat 30 is ${lp.mean.toFixed(0)} ± ${lp.stderr.toFixed(0)} $/day, i.e. NOT better than flat 30 beyond noise: no setting in the grid achieves that (see cells).`);
  // elasticity: an extra, labelled. Same recommended cell with more retail flow at lower fees.
  const elasticity = [0.5, 1].map((e) => {
    const c2 = { ...cfg, retail: { ...cfg.retail, elasticity: e } };
    const sc2 = seeds.slice(0, 8).map((s) => makeScenario(c2, s));
    const fees = pick.cell.fees;
    const base = sc2.map((sc) => runRegime(c2, sc, { regime: 'flat30', fee: feeFunction('flat30', c2.fees, tiers), tierOf }).metrics);
    const fw = sc2.map((sc) =>
      runRegime({ ...c2, fees }, sc, { regime: 'rebate', fee: feeFunction('rebate', fees, tiers), tierOf, rebate: { share: pick.cell.rebateShare, epochSec: REBATE_EPOCH_SEC, floorBps: REBATE_FLOOR_BPS } }).metrics,
    );
    const d = c2.hours / 24;
    return {
      elasticity: e,
      lpBeforeProtocol: stats(fw.map((m, i) => (m.lpPnlVsHodlUsd - base[i]!.lpPnlVsHodlUsd) / d)),
      lpAfterProtocol: stats(fw.map((m, i) => (m.lpPnlVsHodlUsd - protocolUsd(m, pick.opt) - base[i]!.lpPnlVsHodlUsd) / d)),
      retailVsFlat30Bps: stats(fw.map((m, i) => m.retailCostBps - base[i]!.retailCostBps)),
    };
  });
  return {
    synthetic: true,
    note: 'No retail elasticity. Paired differences vs flat 30 over the same random worlds; noise band = 2 × standard error across seeds.',
    config: cfg,
    seeds,
    noiseSigmas: NOISE_SIGMAS,
    rebate: { epochSec: REBATE_EPOCH_SEC, floorBps: REBATE_FLOOR_BPS },
    baseline: { flat30: averageMetrics(flat30), flat5: averageMetrics(flat5) },
    protocolOptions: PROTOCOL_OPTIONS,
    cells,
    recommended: { id: pick.cell.id, toxicBps: pick.cell.fees.TOXIC, rebateShare: pick.cell.rebateShare, protocolOption: pick.opt.id, beatsNoise: lp.beatsNoise, reason },
    elasticityExtra: { note: 'EXTRA, assumption-driven: retail arrival rate × (1 + e·(30 − fee)/30)/(1 + e). Not part of the headline.', rows: elasticity },
  };
}
