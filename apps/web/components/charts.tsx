'use client';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { bps, signed, usd, usdCompact } from '@/lib/format';

export const REGIME_COLOR: Record<string, string> = {
  fairway: 'var(--s-fairway)',
  flat30: 'var(--s-flat30)',
  rotation: 'var(--s-rotation)',
  flat5: 'var(--s-flat5)',
  flat80: 'var(--s-flat80)',
  bots: 'var(--toxic)',
  rebate: 'var(--retail)',
  protocol: 'var(--standard)',
  lps: 'var(--s-fairway)',
};
export const REGIME_NAME: Record<string, string> = {
  fairway: 'Fairway tiers',
  flat30: 'Flat 30 bps',
  rotation: 'Fairway, bots rotate wallets',
  flat5: 'Flat 5 bps',
  flat80: 'Flat 80 bps',
  bots: 'Extra fees paid by bots',
  rebate: 'Rebate to retail',
  protocol: 'Protocol',
  lps: 'LPs',
};
export const TIER_COLOR = { RETAIL: 'var(--retail)', STANDARD: 'var(--standard)', TOXIC: 'var(--toxic)' } as const;

const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12, color: 'var(--ink)' };
const axis = { stroke: 'var(--axis)', tickLine: false, fontSize: 11 } as const;

/** Horizontal bars, one per regime, value-labelled (identity also in the axis label, never colour alone). */
export function RegimeBars({ rows, fmt, height = 220 }: { rows: Array<{ regime: string; value: number }>; fmt: (v: number) => string; height?: number }) {
  const data = rows.map((r) => ({ ...r, name: REGIME_NAME[r.regime] ?? r.regime }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 64, top: 4, bottom: 4 }} barCategoryGap={8}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" {...axis} tickFormatter={(v) => fmt(v)} />
        <YAxis type="category" dataKey="name" width={170} {...axis} tick={{ fill: 'var(--ink-2)', fontSize: 12 }} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={tooltipStyle} formatter={(v) => [fmt(Number(v)), '']} />
        <ReferenceLine x={0} stroke="var(--axis)" />
        <Bar dataKey="value" radius={4} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.regime} fill={REGIME_COLOR[d.regime]} />
          ))}
          <LabelList dataKey="value" position="right" formatter={(v) => fmt(Number(v))} style={{ fill: 'var(--ink)', fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Cumulative "what LPs keep" lines (fees − arb − sniper profit) per regime. */
export function KeepSeries({ series, regimes, height = 280 }: { series: Record<string, { t: number[]; feesUsd: number[]; arbUsd: number[]; sniperUsd: number[] }>; regimes: string[]; height?: number }) {
  const base = series[regimes[0]!]!;
  const data = base.t.map((t, i) => {
    const row: Record<string, number> = { h: t / 3600 };
    for (const r of regimes) {
      const s = series[r]!;
      row[r] = s.feesUsd[i]! - s.arbUsd[i]! - s.sniperUsd[i]!;
    }
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="h" type="number" domain={[0, 'dataMax']} ticks={[0, 4, 8, 12, 16, 20, 24]} tickFormatter={(v) => `${v}h`} {...axis} />
        <YAxis tickFormatter={(v) => usdCompact(v)} width={56} {...axis} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `hour ${Number(v).toFixed(1)}`} formatter={(v, n) => [usd(Number(v)), REGIME_NAME[String(n)] ?? n]} />
        <Legend formatter={(v) => <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{REGIME_NAME[v] ?? v}</span>} />
        <ReferenceLine y={0} stroke="var(--axis)" />
        {regimes.map((r) => (
          <Line key={r} type="monotone" dataKey={r} stroke={REGIME_COLOR[r]} strokeWidth={2} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

type FrontierPoint = { x: number; y: number; label: string };

/** Retail cost (x) vs LP PnL (y): flat-fee curve vs Fairway settings. */
export function Frontier({ flat, fairway, rotation, highlight, height = 340 }: { flat: FrontierPoint[]; fairway: FrontierPoint[]; rotation: FrontierPoint[]; highlight?: FrontierPoint; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ left: 8, right: 24, top: 12, bottom: 20 }}>
        <CartesianGrid />
        <XAxis type="number" dataKey="x" name="Retail cost" unit=" bps" domain={[0, 'dataMax + 5']} {...axis} label={{ value: 'Retail execution cost (bps) → lower is better', position: 'insideBottom', offset: -12, fill: 'var(--muted)', fontSize: 11 }} />
        <YAxis type="number" dataKey="y" name="LP PnL" tickFormatter={(v) => usdCompact(v)} width={60} {...axis} />
        <ZAxis range={[70, 70]} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ strokeDasharray: '3 3' }}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as FrontierPoint | undefined;
            if (!p) return null;
            return (
              <div style={tooltipStyle} className="px-3 py-2">
                <div className="font-semibold">{p.label}</div>
                <div>Retail cost {bps(p.x)}</div>
                <div>LP PnL vs HODL {usd(p.y)}/day</div>
              </div>
            );
          }}
        />
        <Legend verticalAlign="top" height={28} formatter={(v) => <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{v}</span>} />
        <ReferenceLine y={0} stroke="var(--axis)" />
        <Scatter name="Flat fee (5–80 bps)" data={flat} fill="var(--s-flat30)" line={{ stroke: 'var(--s-flat30)', strokeDasharray: '5 4', strokeWidth: 2 }} isAnimationActive={false} />
        <Scatter name="Fairway tiers" data={fairway} fill="var(--s-fairway)" isAnimationActive={false} />
        <Scatter name="Fairway, bots rotate wallets" data={rotation} fill="var(--s-rotation)" isAnimationActive={false} />
        {highlight && <Scatter name="Selected" data={[highlight]} fill="var(--s-fairway)" stroke="var(--ink)" strokeWidth={2} shape="diamond" legendType="none" isAnimationActive={false} />}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** Per-trade markout bars (diverging around zero: informed = warm, uninformed = cool). */
export function MarkoutBars({ data, height = 120 }: { data: Array<{ i: number; m: number; label: string }>; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 0, top: 6, bottom: 0 }} barCategoryGap={1}>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <XAxis dataKey="i" hide />
        <ReferenceLine y={0} stroke="var(--axis)" />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={tooltipStyle} labelFormatter={(_, p) => (p?.[0]?.payload as { label?: string })?.label ?? ''} formatter={(v) => [`${signed(Number(v))} bps`, '30 s markout']} />
        <Bar dataKey="m" radius={2} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.i} fill={d.m >= 0 ? '#e34948' : '#3987e5'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Histogram({ data, height = 220 }: { data: Array<{ bin: string; n: number; mid: number }>; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 4 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="bin" {...axis} interval="preserveStartEnd" />
        <YAxis allowDecimals={false} width={32} {...axis} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={tooltipStyle} formatter={(v) => [String(v), 'trades']} labelFormatter={(l) => `markout ${l} bps`} />
        <Bar dataKey="n" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.bin} fill={d.mid >= 0 ? '#e34948' : '#3987e5'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ScoreTimeline({ data, toxic, retail, height = 220 }: { data: Array<{ t: number; score: number; max: number }>; toxic: number; retail: number; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: 0, right: 16, top: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => new Date(v * 1000).toISOString().slice(5, 10)} {...axis} />
        <YAxis width={40} {...axis} tickFormatter={(v) => `${v}`} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => new Date(Number(v) * 1000).toISOString().replace('T', ' ').slice(5, 16)} formatter={(v, n) => [`${Number(v).toFixed(1)} bps`, n === 'score' ? '30 s score' : 'max over horizons']} />
        <ReferenceLine y={toxic} stroke="var(--toxic)" strokeDasharray="4 4" label={{ value: `TOXIC ≥ ${toxic}`, fill: 'var(--toxic)', fontSize: 11, position: 'insideTopRight' }} />
        <ReferenceLine y={retail} stroke="var(--retail)" strokeDasharray="4 4" label={{ value: `RETAIL ≤ ${retail}`, fill: 'var(--retail)', fontSize: 11, position: 'insideBottomRight' }} />
        <Line type="stepAfter" dataKey="score" stroke="var(--s-fairway)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="stepAfter" dataKey="max" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TierStack({ data, height = 240, fmt = usdCompact }: { data: Array<{ day: string; RETAIL: number; STANDARD: number; TOXIC: number }>; height?: number; fmt?: (v: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 4 }} barCategoryGap="25%">
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" {...axis} />
        <YAxis tickFormatter={fmt} width={52} {...axis} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={tooltipStyle} formatter={(v, n) => [fmt(Number(v)), String(n)]} />
        <Legend formatter={(v) => <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{v}</span>} />
        {(['RETAIL', 'STANDARD', 'TOXIC'] as const).map((t, i) => (
          <Bar key={t} dataKey={t} stackId="a" fill={TIER_COLOR[t]} stroke="var(--surface)" strokeWidth={2} radius={i === 2 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
