'use client';
import { useState } from 'react';
import type { SweepOutput, TimeSeries, SensitivityRow } from '@fairway/sim';
import { Card, Stat } from './ui';
import { FrontierPanel } from './frontier-panel';
import { KeepSeries, RegimeBars } from './charts';
import { bps, usd, usdCompact } from '@/lib/format';

type Data = {
  sweep: Pick<SweepOutput, 'toxic' | 'retail' | 'cells' | 'flatCurve' | 'baseline' | 'context' | 'recommended' | 'stalenessBoundBps'> & { hours: number; seeds: number; config?: { hours: number } };
  series: Record<string, TimeSeries>;
  sensitivity: SensitivityRow[];
};

export function BacktestExplorer({ data }: { data: Data }) {
  const { sweep } = data;
  const [toxic, setToxic] = useState(sweep.recommended.toxicBps);
  const [retail, setRetail] = useState(sweep.recommended.retailBps);
  const days = sweep.hours / 24;
  const cell = sweep.cells.find((c) => c.toxicBps === toxic && c.retailBps === retail)!;
  const isRec = toxic === sweep.recommended.toxicBps && retail === sweep.recommended.retailBps;
  const rows = [
    { regime: 'flat30', m: sweep.baseline },
    { regime: 'fairway', m: cell.fairway },
    { regime: 'rotation', m: cell.rotation },
    { regime: 'flat5', m: sweep.context.flat5 },
    { regime: 'flat80', m: sweep.context.flat80 },
  ];
  const sel = (title: string, vals: number[], v: number, set: (n: number) => void) => (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <label className="text-sm font-semibold text-ink">{title}</label>
        <span className="text-lg font-semibold text-ink tnum">{v} bps</span>
      </div>
      <input type="range" min={0} max={vals.length - 1} step={1} value={vals.indexOf(v)} onChange={(e) => set(vals[Number(e.target.value)]!)} className="w-full" aria-label={title} />
      <div className="mt-1 flex justify-between text-xs text-muted tnum">{vals.map((x) => <span key={x}>{x}</span>)}</div>
    </div>
  );
  const dLp = (cell.fairway.lpPnlVsHodlUsd - sweep.baseline.lpPnlVsHodlUsd) / days;
  return (
    <div className="space-y-6">
      <Card>
        <div className="grid gap-8 sm:grid-cols-2">
          {sel('Toxic fee', sweep.toxic, toxic, setToxic)}
          {sel('Retail fee', sweep.retail, retail, setRetail)}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-ink-2">
          {isRec ? <span className="rounded-full bg-accent/15 px-2.5 py-1 font-semibold text-accent">Recommended setting</span> : (
            <button onClick={() => { setToxic(sweep.recommended.toxicBps); setRetail(sweep.recommended.retailBps); }} className="rounded-full border border-line px-2.5 py-1 font-semibold text-accent hover:bg-surface-2">Jump to recommended ({sweep.recommended.retailBps}/30/{sweep.recommended.toxicBps})</button>
          )}
          <span>{sweep.recommended.reason}</span>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Retail cost" value={bps(cell.fairway.retailCostBps)} hint={`flat 30: ${bps(sweep.baseline.retailCostBps)}`} tone={cell.meetsRetailCost ? 'good' : 'bad'} />
        <Stat label="LP PnL vs flat 30" value={`${dLp >= 0 ? '+' : '−'}${usd(Math.abs(dLp))}/d`} hint="negative = discount paid to retail" tone={dLp >= 0 ? 'good' : undefined} />
        <Stat label="Staleness p95" value={bps(cell.fairway.stalenessP95Bps)} hint={`bound ${sweep.stalenessBoundBps} bps`} tone={cell.meetsStaleness ? 'good' : 'bad'} />
        <Stat label="Worst case (rotation)" value={bps(cell.rotation.retailCostBps)} hint="retail cost if all bots rotate" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="LP PnL vs HODL ($/day)"><RegimeBars rows={rows.map((r) => ({ regime: r.regime, value: r.m.lpPnlVsHodlUsd / days }))} fmt={usdCompact} /></Card>
        <Card title="Retail execution cost (bps)"><RegimeBars rows={rows.map((r) => ({ regime: r.regime, value: r.m.retailCostBps }))} fmt={(v) => `${v.toFixed(1)}`} /></Card>
        <Card title="Pool staleness, p95 |pool − CEX| (bps)"><RegimeBars rows={rows.map((r) => ({ regime: r.regime, value: r.m.stalenessP95Bps }))} fmt={(v) => `${v.toFixed(1)}`} /></Card>
        <Card title="Arbitrage profit, LVR proxy ($/day)"><RegimeBars rows={rows.map((r) => ({ regime: r.regime, value: r.m.arbProfitUsd / days }))} fmt={usdCompact} /></Card>
      </div>
      <Card title="Trade-off frontier" subtitle="Every Fairway setting vs the flat-fee curve. The diamond is your selection.">
        <FrontierPanel sweep={{ ...sweep, config: { hours: sweep.hours } } as never} selected={{ toxicBps: toxic, retailBps: retail }} />
      </Card>
      {data.series.fairway && (
        <Card title="What LPs keep over 24 h" subtitle="Cumulative fees minus arbitrage and sniper profit (first seed).">
          <KeepSeries series={data.series as never} regimes={['flat30', 'fairway', 'rotation', 'flat5']} />
        </Card>
      )}
      <Card title="Sensitivities" subtitle="Assumptions that could break the result are output, not hidden.">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tnum">
            <thead className="text-xs uppercase tracking-wide text-muted"><tr><th className="py-2">Scenario</th><th>Regime</th><th>Retail saved</th><th>LP PnL vs flat 30</th><th>p95 stale</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.sensitivity.map((r, i) => (
                <tr key={i}><td className="py-2">{r.label}</td><td>{r.regime}</td><td>{bps(r.retailCostSavedBps)}</td><td>{usd(r.lpPnlVsFlat30UsdPerDay)}/d</td><td>{bps(r.stalenessP95Bps)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
