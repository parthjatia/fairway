/**
 * Runs warm-up → backtest (all regimes) → parameter sweep → sensitivities → fixture replay,
 * and writes JSON outputs to packages/sim/out/ for the frontend and chart export.
 * Usage: pnpm --filter @fairway/sim backtest [--seeds 8] [--quick]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDataset } from '@fairway/fixtures/node';
import { fixtureMids } from '@fairway/fixtures';
import { makeConfig, scoreWallets } from '@fairway/scoring';
import { DEFAULT_SIM_CONFIG, replay, runBacktest, runSensitivity, runSweep, warmup } from '../src';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const seedIdx = args.indexOf('--seeds');
const nSeeds = (seedIdx >= 0 ? Number(args[seedIdx + 1]) : 0) || (quick ? 2 : 8);
const seeds = Array.from({ length: nSeeds }, (_, i) => i + 1);
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
mkdirSync(OUT, { recursive: true });
const cfg = quick ? { ...DEFAULT_SIM_CONFIG, hours: 6 } : DEFAULT_SIM_CONFIG;
const round = (_k: string, v: unknown) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
const write = (name: string, data: unknown) => writeFileSync(join(OUT, name), JSON.stringify(data, round));

let t = Date.now();
const lap = (label: string) => {
  console.log(`  ${label} (${Date.now() - t} ms)`);
  t = Date.now();
};
console.log(`Fairway backtest — ${seeds.length} seeds × ${cfg.hours}h, ${cfg.annualVol * 100}% vol, pool ${cfg.poolBase} SOL`);
const wu = warmup(cfg);
lap(`warm-up: ${wu.swaps} swaps scored; confusion ${JSON.stringify(wu.confusion)}`);
const bt = runBacktest(cfg, seeds, wu);
write('backtest.json', bt);
lap('backtest.json');
const sweep = runSweep(cfg, seeds, { wu });
write('sweep.json', sweep);
lap(`sweep.json (recommended toxic ${sweep.recommended.toxicBps} / retail ${sweep.recommended.retailBps})`);
const recCfg = { ...cfg, fees: { ...cfg.fees, TOXIC: sweep.recommended.toxicBps, RETAIL: sweep.recommended.retailBps } };
const btRec = runBacktest(recCfg, seeds, wu);
write('backtest-recommended.json', {
  config: btRec.config,
  headline: btRec.headline,
  regimes: btRec.regimes.map((r) => ({ regime: r.regime, label: r.label, mean: r.mean })),
});
lap('backtest-recommended.json');
const sens = runSensitivity(cfg, seeds.slice(0, Math.min(4, seeds.length)), wu);
write('sensitivity.json', { synthetic: true, rows: sens });
lap('sensitivity.json');
// the same sensitivities at the recommended fee schedule
const sensRec = runSensitivity(recCfg, seeds.slice(0, Math.min(4, seeds.length)), wu);
write('sensitivity-recommended.json', { synthetic: true, fees: recCfg.fees, rows: sensRec });
lap('sensitivity-recommended.json');
// elasticity-labelled sweeps: more retail volume at lower fees (aggregators route to the cheaper pool)
const elastic: Record<string, unknown> = {};
for (const e of [0.5, 1]) {
  const ec = { ...cfg, retail: { ...cfg.retail, elasticity: e } };
  const sw = runSweep(ec, seeds.slice(0, Math.min(4, seeds.length)), { wu });
  const b = sw.baseline;
  elastic[String(e)] = {
    elasticity: e,
    recommended: sw.recommended,
    baseline: { lpPnlVsHodlUsd: b.lpPnlVsHodlUsd, retailCostBps: b.retailCostBps },
    cells: sw.cells.map((c) => ({
      toxicBps: c.toxicBps,
      retailBps: c.retailBps,
      lpVsFlat30: c.fairway.lpPnlVsHodlUsd - b.lpPnlVsHodlUsd,
      lpNetOfProtocolVsFlat30: c.fairway.lpPnlNetOfProtocolUsd - b.lpPnlVsHodlUsd,
      retailSavedBps: b.retailCostBps - c.fairway.retailCostBps,
      stalenessP95Bps: c.fairway.stalenessP95Bps,
      rotationLpVsFlat30: c.rotation.lpPnlVsHodlUsd - b.lpPnlVsHodlUsd,
    })),
  };
}
write('sweep-elastic.json', { synthetic: true, note: 'Elasticity is an ASSUMPTION: arrival rate ×(1 + e·(30 − fee)/30)/(1 + e). Per-day values are for the 24 h window.', byElasticity: elastic });
lap('sweep-elastic.json');
const ds = loadDataset();
const scores = scoreWallets(ds.swaps, fixtureMids(ds.cex), makeConfig());
const rec = sweep.recommended;
const rp = replay(ds.swaps, scores, [
  { name: 'Flat 30 bps', fees: 30 },
  { name: 'Fairway 5/30/80', fees: { RETAIL: 5, STANDARD: 30, TOXIC: 80 } },
  { name: `Fairway ${rec.retailBps}/30/${rec.toxicBps} (recommended)`, fees: { RETAIL: rec.retailBps, STANDARD: 30, TOXIC: rec.toxicBps } },
]);
write('replay.json', rp);
lap('replay.json');

const h = bt.headline;
console.log(`\nHeadline (Fairway 5/30/80 vs flat fees, per day, $${(h.tvlUsd / 1e6).toFixed(1)}M pool):`);
console.log(`  retail cost saved:     ${h.retailCostSavedBps.toFixed(1)} bps  ($${h.retailCostSavedUsdPerDay.toFixed(0)}/day)`);
console.log(`  LP PnL vs flat 30:     $${h.lpPnlVsFlat30UsdPerDay.toFixed(0)} ± ${h.lpPnlVsFlat30StderrUsd.toFixed(0)}`);
console.log(`  LP PnL vs flat 5:      $${h.lpPnlVsFlat5UsdPerDay.toFixed(0)} ± ${h.lpPnlVsFlat5StderrUsd.toFixed(0)}`);
console.log(`  arb profit reduction:  ${h.arbProfitReductionPct.toFixed(0)}%   sniper: ${h.sniperProfitReductionPct.toFixed(0)}%`);
console.log(
  `  worst case (rotation): retail saves ${h.rotationRetailCostSavedBps.toFixed(1)} bps; LP vs flat30 $${h.rotationLpPnlVsFlat30UsdPerDay.toFixed(0)}, vs flat5 $${h.rotationLpPnlVsFlat5UsdPerDay.toFixed(0)}`,
);
for (const r of bt.regimes) {
  const m = r.mean;
  console.log(
    `  ${r.regime.padEnd(9)} fees $${m.lpFeesUsd.toFixed(0)} arb $${m.arbProfitUsd.toFixed(0)} sniper $${m.sniperProfitUsd.toFixed(0)} LPvsHODL $${m.lpPnlVsHodlUsd.toFixed(0)} retail ${m.retailCostBps.toFixed(1)}bps stale ${m.stalenessMeanBps.toFixed(1)}/${m.stalenessP95Bps.toFixed(1)}bps`,
  );
}
for (const c of sweep.cells) {
  console.log(
    `  sweep tox ${String(c.toxicBps).padStart(3)} ret ${String(c.retailBps).padStart(2)}: LP ${c.fairway.lpPnlVsHodlUsd.toFixed(0).padStart(6)} (rot ${c.rotation.lpPnlVsHodlUsd.toFixed(0).padStart(6)}) retail ${c.fairway.retailCostBps.toFixed(1)} p95 ${c.fairway.stalenessP95Bps.toFixed(0)} ${c.meetsRetailCost && c.meetsStaleness ? 'ok' : ''}`,
  );
}
for (const r of sens) console.log(`  sens ${r.label.padEnd(28)} ${r.regime.padEnd(8)} LPvs30 $${r.lpPnlVsFlat30UsdPerDay.toFixed(0)} retailSaved ${r.retailCostSavedBps.toFixed(1)}bps`);
console.log(`Outputs → ${OUT}`);
