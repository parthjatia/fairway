/**
 * Launch study: many simulated token launches under flat / time-decay-only / Fairway (tier × time) / Fairway rotation.
 * Writes packages/sim/out/launch.json (the default /backtest view). Usage: pnpm --filter @fairway/sim launch [--launches 200]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LAUNCH_CONFIG, runLaunchStudy } from '../src';

const args = process.argv.slice(2);
const i = args.indexOf('--launches');
const n = (i >= 0 ? Number(args[i + 1]) : 0) || 200;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
mkdirSync(OUT, { recursive: true });
const t = Date.now();
const st = runLaunchStudy(DEFAULT_LAUNCH_CONFIG, Array.from({ length: n }, (_, k) => k + 1));
const round = (_k: string, v: unknown) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
writeFileSync(join(OUT, 'launch.json'), JSON.stringify(st, round));
console.log(`Fairway launch study — ${n} synthetic launches (${Date.now() - t} ms)`);
for (const r of st.regimes) {
  const m = r.metrics;
  console.log(
    `  ${r.short.padEnd(19)} sniper share ${(m.sniperShareOfWindowSupply.mean * 100).toFixed(1).padStart(5)}%  retail premium ${m.retailEntryPremiumPct.mean.toFixed(1).padStart(5)}%  human fee ${m.humanFeeBps.mean.toFixed(0).padStart(4)} bps  sniper fee ${m.sniperFeeBps.mean.toFixed(0).padStart(4)} bps  high-fee humans ${(m.humanHighFeeShare.mean * 100).toFixed(0).padStart(3)}%  creator $${m.creatorFeesUsd.mean.toFixed(0).padStart(5)}  protocol $${m.protocolUsd.mean.toFixed(1)}  sniper PnL $${m.sniperPnlUsd.mean.toFixed(0)}  participation ${(m.sniperParticipation.mean * 100).toFixed(0)}%`,
  );
}
console.log('  key chart (pooled):', st.keyChart.map((k) => `${k.short}: humans ${k.humanFeeBps.toFixed(0)} / snipers ${k.sniperFeeBps.toFixed(0)}`).join(' | '));
console.log('  paired vs time-decay:', JSON.stringify(st.paired));
