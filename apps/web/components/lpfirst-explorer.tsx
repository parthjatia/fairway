'use client';
import { useState } from 'react';
import type { LpFirstOutput, Band } from '@fairway/sim';
import { Card, Stat } from './ui';
import { RegimeBars } from './charts';
import { bps, signed, usd } from '@/lib/format';

export type LpFirstData = Pick<LpFirstOutput, 'cells' | 'protocolOptions' | 'recommended' | 'noiseSigmas' | 'elasticityExtra' | 'rebate'> & {
  baseline: { flat30: { arbProfitUsd: number; lpPnlVsHodlUsd: number; retailCostBps: number; stalenessP95Bps: number; lpFeesUsd: number; botExtraFeesUsd: number } };
  hours: number;
  seeds: number;
};

const pm = (b: Band, f: (v: number) => string = (v) => usd(v)) => `${b.mean >= 0 ? '+' : '−'}${f(Math.abs(b.mean))} ± ${f(b.stderr)}`;
const verdict = (b: Band) => (b.beatsNoise ? 'beats flat 30 beyond noise' : b.mean + b.stderr * 2 < 0 ? 'worse than flat 30 beyond noise' : 'within noise of flat 30');

export function LpFirstExplorer({ data }: { data: LpFirstData }) {
  const rec = data.cells.find((c) => c.id === data.recommended.id)!;
  const grid = data.cells.filter((c) => !c.extended && c.kind !== 'max-discount');
  const toxics = [...new Set(grid.map((c) => c.fees.TOXIC))];
  const shares = [0, ...new Set(grid.filter((c) => c.kind === 'rebate').map((c) => c.rebateShare))];
  const [toxic, setToxic] = useState(rec.fees.TOXIC);
  const [share, setShare] = useState(rec.rebateShare);
  const [opt, setOpt] = useState(data.recommended.protocolOption);
  const cell = grid.find((c) => c.fees.TOXIC === toxic && c.rebateShare === share)!;
  const f30 = data.baseline.flat30;
  const days = data.hours / 24;
  const after = cell.lpAfterProtocol[opt]!;
  const isRec = cell.id === rec.id && opt === data.recommended.protocolOption;
  const chip = (on: boolean) => `rounded-md border px-3 py-1.5 text-sm font-semibold ${on ? 'border-accent bg-surface-2 text-ink' : 'border-line text-ink-2 hover:text-ink'}`;
  const ext = data.cells.filter((c) => c.extended && c.kind === 'toxic-only');
  const max = data.cells.find((c) => c.kind === 'max-discount')!;
  const botDay = cell.botExtraFeesUsdPerDay;
  const protoDay = cell.protocolUsdPerDay[opt]!;
  return (
    <div className="space-y-6">
      <Card title="LP-first fee model" subtitle="Retail = standard = 30 bps. Only proven-toxic wallets pay more; part of that premium comes back to proven-retail wallets as a rebate.">
        <div className="grid gap-6 lg:grid-cols-3">
          <div>
            <div className="mb-2 text-sm font-semibold text-ink">Toxic fee</div>
            <div className="flex flex-wrap gap-2">{toxics.map((t) => <button key={t} aria-pressed={t === toxic} onClick={() => setToxic(t)} className={chip(t === toxic)}>{t} bps</button>)}</div>
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold text-ink">Rebate: share of the toxic premium</div>
            <div className="flex flex-wrap gap-2">{shares.map((s) => <button key={s} aria-pressed={s === share} onClick={() => setShare(s)} className={chip(s === share)}>{s === 0 ? 'none' : `${Math.round(s * 100)}%`}</button>)}</div>
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold text-ink">Protocol share</div>
            <div className="flex flex-wrap gap-2">{data.protocolOptions.map((o) => <button key={o.id} aria-pressed={o.id === opt} onClick={() => setOpt(o.id)} className={chip(o.id === opt)}>{o.label}</button>)}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-ink-2">
          {isRec ? <span className="rounded-md border border-line bg-surface-2 px-2.5 py-1 font-semibold text-accent">Default setting</span> : (
            <button onClick={() => { setToxic(rec.fees.TOXIC); setShare(rec.rebateShare); setOpt(data.recommended.protocolOption); }} className="rounded-md border border-line px-2.5 py-1 font-semibold text-accent hover:bg-surface-2">Jump to default</button>
          )}
          <span>Noise band = {data.noiseSigmas} × standard error over {data.seeds} paired seeds. Values are per day on the simulated pool, versus a flat 30 bps pool in the same random world.</span>
        </div>
      </Card>

      <div className="flush grid grid-cols-2 lg:grid-cols-4">
        <Stat label="LVR cut" value={`−${cell.lvrReductionPct.mean.toFixed(0)}%`} hint={`arb profit vs flat 30 (${usd(f30.arbProfitUsd / days)}/d)`} tone="good" />
        <Stat label="LP vs flat 30, before protocol" value={`${pm(cell.lpBeforeProtocol)}/d`} hint={verdict(cell.lpBeforeProtocol)} tone={cell.lpBeforeProtocol.beatsNoise ? 'good' : undefined} />
        <Stat label="LP vs flat 30, after protocol" value={`${pm(after)}/d`} hint={verdict(after)} tone={after.beatsNoise ? 'good' : after.mean + 2 * after.stderr < 0 ? 'bad' : undefined} />
        <Stat label="Retail cost vs flat 30" value={`${signed(cell.retailCostBps.vsFlat30Bps.mean, 1)} bps`} hint={`± ${cell.retailCostBps.vsFlat30Bps.stderr.toFixed(1)} · p95 staleness ${signed(cell.stalenessP95VsFlat30Bps.mean, 0)} bps`} tone={cell.retailCostBps.vsFlat30Bps.mean < 0 ? 'good' : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Where the bot tax goes ($/day)" subtitle="Extra fees bots pay above the standard 30 bps, split three ways.">
          <RegimeBars
            rows={[
              { regime: 'bots', value: botDay },
              { regime: 'rebate', value: cell.rebateUsdPerDay },
              { regime: 'protocol', value: protoDay },
              { regime: 'lps', value: botDay - cell.rebateUsdPerDay - protoDay },
            ]}
            fmt={(v) => usd(v)}
            height={200}
          />
        </Card>
        <Card title="Worst case: every bot rotates wallets" subtitle="Bots then pay STANDARD (30 bps), so no premium exists and nothing is rebated.">
          <div className="space-y-2 text-sm text-ink-2 tnum">
            <div className="flex justify-between"><span>LP vs flat 30</span><span className="font-semibold text-ink">{pm(cell.rotationLpBeforeProtocol)}/d</span></div>
            <div className="flex justify-between"><span>Retail cost vs flat 30</span><span className="font-semibold text-ink">{signed(cell.rotationRetailVsFlat30Bps.mean, 1)} bps</span></div>
            <div className="flex justify-between"><span>Protocol revenue</span><span className="font-semibold text-ink">$0 (no premium)</span></div>
          </div>
          <p className="mt-3 text-xs text-muted">The design degrades to a plain 30 bps pool, not to something worse for LPs.</p>
        </Card>
      </div>

      <Card title="All settings" subtitle="LP net vs flat 30 per day after the selected protocol share. ✓ = beats flat 30 beyond the noise band. No setting does.">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tnum">
            <thead className="label"><tr><th className="py-2">Setting</th><th>LP before</th><th>LP after</th><th>Retail Δ</th><th>LVR cut</th><th>p95 Δ</th></tr></thead>
            <tbody className="divide-y divide-line">
              {[...grid, max, ...ext].map((c) => (
                <tr key={c.id} className={c.id === cell.id ? 'bg-surface-2' : ''}>
                  <td className="py-2">{c.label}{c.extended && <span className="ml-2 rounded border border-dashed border-line px-1.5 text-xs text-muted">extension</span>}{c.kind === 'max-discount' && <span className="ml-2 rounded border border-dashed border-line px-1.5 text-xs text-muted">max retail discount</span>}</td>
                  <td>{pm(c.lpBeforeProtocol)}</td>
                  <td>{pm(c.lpAfterProtocol[opt]!)} {c.lpAfterProtocol[opt]!.beatsNoise ? '✓' : ''}</td>
                  <td>{signed(c.retailCostBps.vsFlat30Bps.mean, 1)}</td>
                  <td>{c.lvrReductionPct.mean.toFixed(0)}%</td>
                  <td>{signed(c.stalenessP95VsFlat30Bps.mean, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {data.recommended.reason} Rows marked &quot;extension&quot; are outside the requested 40–100 bps grid and are never recommended. Stale pools hurt retail: toxic fees above ~100 bps raise p95 pool-vs-CEX deviation by 100+ bps.
        </p>
      </Card>

      <Card title="Extra: if retail volume responds to fees (assumption, not a result)" subtitle={data.elasticityExtra.note}>
        <table className="w-full text-left text-sm tnum">
          <thead className="label"><tr><th className="py-2">Elasticity</th><th>LP before protocol</th><th>LP after protocol</th><th>Retail Δ</th></tr></thead>
          <tbody className="divide-y divide-line">
            {data.elasticityExtra.rows.map((r) => (
              <tr key={r.elasticity}><td className="py-2">{r.elasticity}</td><td>{pm(r.lpBeforeProtocol)}</td><td>{pm(r.lpAfterProtocol)}</td><td>{bps(r.retailVsFlat30Bps.mean)}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
