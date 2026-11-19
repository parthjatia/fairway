'use client';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { LaunchStudy } from '@fairway/sim';
import { Card, Stat } from './ui';
import { usd } from '@/lib/format';

export type LaunchStudyData = Pick<LaunchStudy, 'regimes' | 'keyChart' | 'paired' | 'schedules' | 'launches'> & { windowSlots: number; knownShare: number; historyShare: number };

export const LAUNCH_COLOR: Record<string, string> = {
  flat: 'var(--s-flat5)',
  decay: 'var(--s-flat30)',
  decayHigh: 'var(--s-flat80)',
  fairway: 'var(--s-fairway)',
  fairwayRotation: 'var(--s-rotation)',
};

const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12, color: 'var(--ink)' };
const axis = { stroke: 'var(--axis)', tickLine: false, fontSize: 11 } as const;
const pct = (v: number, dp = 0) => `${(v * 100).toFixed(dp)}%`;
const b0 = (v: number) => `${v.toFixed(0)} bps`;

type MetricKey = 'sniperShareOfWindowSupply' | 'retailEntryPremiumPct' | 'humanHighFeeShare' | 'creatorFeesUsd' | 'protocolUsd' | 'sniperPnlUsd';
const METRICS: { key: MetricKey; label: string; fmt: (v: number) => string; better: 'low' | 'high'; note: string }[] = [
  { key: 'sniperShareOfWindowSupply', label: 'Sniper + bundler share of window supply', fmt: (v) => pct(v), better: 'low', note: 'Tokens bought by snipers and bundlers during the launch window ÷ all tokens bought in the window.' },
  { key: 'retailEntryPremiumPct', label: 'Retail entry vs listing price', fmt: (v) => `+${v.toFixed(0)}%`, better: 'low', note: 'Average retail entry price (incl. fee) above the listing price. Snipers in front of retail push it up.' },
  { key: 'humanHighFeeShare', label: 'Humans who paid ≥ 100 bps', fmt: (v) => pct(v), better: 'low', note: 'Share of retail buys that paid the high early fee.' },
  { key: 'creatorFeesUsd', label: 'Creator / LP fee revenue per launch', fmt: (v) => usd(v), better: 'high', note: 'All swap fees in the 15 minutes simulated, minus the protocol share.' },
  { key: 'protocolUsd', label: 'Protocol revenue per launch', fmt: (v) => usd(v, 2), better: 'high', note: 'Launch fee (0.05 SOL ≈ $7.50) + 15% of the toxic premium.' },
  { key: 'sniperPnlUsd', label: 'Sniper + bundler profit per launch', fmt: (v) => usd(v), better: 'low', note: 'Realised plus marked-to-market at the end of the simulation.' },
];

export function LaunchExplorer({ data }: { data: LaunchStudyData }) {
  const [metric, setMetric] = useState<MetricKey>('sniperShareOfWindowSupply');
  const M = METRICS.find((m) => m.key === metric)!;
  const by = (id: string) => data.regimes.find((r) => r.id === id)!;
  const fw = by('fairway').metrics;
  const dc = by('decay').metrics;
  const key = (id: string) => data.keyChart.find((k) => k.id === id)!;
  const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-[13px] font-semibold ${on ? 'border-accent bg-surface-2 text-ink' : 'border-line text-ink-2 hover:text-ink'}`;
  const keyRows = data.keyChart.map((k) => ({ name: k.short, Humans: k.humanFeeBps, Snipers: k.sniperFeeBps, 'Known snipers': k.knownSniperFeeBps }));
  const metricRows = data.regimes.map((r) => ({ id: r.id, name: r.short, value: r.metrics[metric].mean, p10: r.metrics[metric].p10, p90: r.metrics[metric].p90 }));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Human fee vs time-decay" value={`−${data.paired.humanFeeCutPct.toFixed(0)}%`} tone="good" hint={`${b0(key('fairway').humanFeeBps)} vs ${b0(key('decay').humanFeeBps)}, all ${data.launches} launches pooled`} />
        <Stat label="Known snipers pay" value={`${data.paired.knownSniperFeeRatio.toFixed(2)}×`} tone="good" hint={`${b0(key('fairway').knownSniperFeeBps)} vs ${b0(key('decay').knownSniperFeeBps)} under time-decay`} />
        <Stat label="Sniper share of supply" value={pct(fw.sniperShareOfWindowSupply.mean)} tone="good" hint={`vs ${pct(dc.sniperShareOfWindowSupply.mean)} time-decay, ${pct(by('flat').metrics.sniperShareOfWindowSupply.mean)} flat`} />
        <Stat label="Creator fees / launch" value={usd(fw.creatorFeesUsd.mean)} tone="bad" hint={`vs ${usd(dc.creatorFeesUsd.mean)} time-decay: humans pay less, so creators earn less in fees`} />
      </div>

      <Card title="The key chart: who pays the launch fee" subtitle="Volume-weighted fee paid in the launch, pooled over every simulated launch. Humans = retail buyers. Snipers = snipers + bundlers. Known snipers = wallets already scored TOXIC.">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={keyRows} margin={{ left: 0, right: 12, top: 16, bottom: 4 }} barCategoryGap={18}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="name" {...axis} tick={{ fill: 'var(--ink-2)', fontSize: 12 }} interval={0} />
            <YAxis {...axis} tickFormatter={(v) => `${v}`} width={44} label={{ value: 'bps', angle: -90, position: 'insideLeft', fill: 'var(--ink-2)', fontSize: 11 }} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={tooltipStyle} formatter={(v, n) => [b0(Number(v)), n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Humans" fill="var(--retail)" radius={4} isAnimationActive={false}>
              <LabelList dataKey="Humans" position="top" formatter={(v) => Number(v).toFixed(0)} style={{ fill: 'var(--ink)', fontSize: 11 }} />
            </Bar>
            <Bar dataKey="Snipers" fill="var(--standard)" radius={4} isAnimationActive={false}>
              <LabelList dataKey="Snipers" position="top" formatter={(v) => Number(v).toFixed(0)} style={{ fill: 'var(--ink)', fontSize: 11 }} />
            </Bar>
            <Bar dataKey="Known snipers" fill="var(--toxic)" radius={4} isAnimationActive={false}>
              <LabelList dataKey="Known snipers" position="top" formatter={(v) => Number(v).toFixed(0)} style={{ fill: 'var(--ink)', fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
          Under time-decay-only, everyone pays the same early tax, so humans pay about as much as snipers. Fairway charges by tier: humans with a clean history pay the RETAIL curve (30→5 bps) from block 0, and known snipers pay
          the TOXIC curve (1000→80). Most known snipers then skip the launch or wait, so pooled over all snipers they pay about the same as under time-decay ({data.paired.sniperFeeRatio.toFixed(2)}×). Per dollar traded,
          the snipers Fairway knows pay {data.paired.knownSniperFeeRatio.toFixed(2)}×. The <strong className="text-ink">rotation</strong> bars are the worst case: every sniper uses a fresh wallet. They then pay exactly the
          time-decay fee, and humans still pay less.
        </p>
      </Card>

      <Card title="Compare regimes" subtitle="Mean over all launches; whiskers in the tooltip are the 10th–90th percentile across launches.">
        <div className="mb-4 flex flex-wrap gap-2">
          {METRICS.map((m) => (
            <button key={m.key} aria-pressed={m.key === metric} onClick={() => setMetric(m.key)} className={chip(m.key === metric)}>
              {m.label}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={metricRows} layout="vertical" margin={{ left: 8, right: 72, top: 4, bottom: 4 }} barCategoryGap={8}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" {...axis} tickFormatter={(v) => M.fmt(Number(v))} />
            <YAxis type="category" dataKey="name" width={140} {...axis} tick={{ fill: 'var(--ink-2)', fontSize: 12 }} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              contentStyle={tooltipStyle}
              formatter={(v, _n, item) => {
                const p = item.payload as { p10: number; p90: number };
                return [`${M.fmt(Number(v))}  (p10 ${M.fmt(p.p10)} · p90 ${M.fmt(p.p90)})`, M.label];
              }}
            />
            <ReferenceLine x={0} stroke="var(--axis)" />
            <Bar dataKey="value" radius={4} isAnimationActive={false}>
              {metricRows.map((d) => (
                <Cell key={d.id} fill={LAUNCH_COLOR[d.id]} />
              ))}
              <LabelList dataKey="value" position="right" formatter={(v) => M.fmt(Number(v))} style={{ fill: 'var(--ink)', fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-2 text-[13px] text-ink-2">
          {M.note} {M.better === 'low' ? 'Lower is better for buyers.' : 'Higher is better for the receiver.'}
        </p>
      </Card>

      <Card title="Fee schedules" subtitle={`Fee by slot since launch. The window is ${data.windowSlots} slots (≈ ${Math.round((data.windowSlots * 0.4) / 60)} min). After it, Fairway charges its normal tier fees.`}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data.schedules} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="slot" {...axis} tickFormatter={(v) => `${Math.round(v * 0.4)}s`} />
            <YAxis {...axis} width={44} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `slot ${v} (${Math.round(Number(v) * 0.4)} s)`} formatter={(v, n) => [b0(Number(v)), n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine x={data.windowSlots} stroke="var(--axis)" strokeDasharray="4 4" />
            <Line dataKey="decay" name="Time-decay (everyone)" stroke={LAUNCH_COLOR.decay} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="fairwayToxic" name="Fairway TOXIC" stroke="var(--toxic)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="fairwayStandard" name="Fairway STANDARD (fresh wallets)" stroke="var(--standard)" strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
            <Line dataKey="fairwayRetail" name="Fairway RETAIL" stroke="var(--retail)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Assumptions (synthetic)" subtitle="What the simulation models, and what it does not.">
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
          <li>{data.launches} launches, 15 minutes each. Snipers arrive at block 0, and {pct(data.knownShare)} of them are already known TOXIC (scored from Pump.fun history). A sniper buys only when the fee is below its expected edge (150–700 bps), and waits at most 30–300 slots.</li>
          <li>Bundlers: one entity funding 3–8 fresh wallets (in 50% of launches). Fresh wallets pay STANDARD, so Fairway charges bundlers the same as time-decay. Funding-graph detection is not built.</li>
          <li>Retail: front-loaded Poisson arrivals, median $80. {pct(data.historyShare)} have a RETAIL history; the rest are fresh wallets that pay the STANDARD curve, exactly as under time-decay.</li>
          <li>Retail buyers do not react to fees. If they avoided high early fees, time-decay would lose even more human volume.</li>
        </ul>
      </Card>
    </div>
  );
}
