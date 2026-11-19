/**
 * Exports static SVG charts from packages/sim/out/*.json into docs/charts/ for the README and pitch.
 * Palette: validated categorical slots (light surface), fixed order per regime; every mark is
 * direct-labelled (several slots are < 3:1 on the light surface) and carries a <title> tooltip.
 * Usage: pnpm charts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BacktestOutput, LaunchStudy, SweepOutput } from '@fairway/sim';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'packages/sim/out');
const CHART_DIR = join(ROOT, 'docs/charts');

const C = {
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
};
/** regime → categorical slot (fixed order: fairway, flat30, rotation, flat5, flat80) */
const REGIME_COLOR: Record<string, string> = {
  fairway: '#2a78d6',
  flat30: '#eb6834',
  rotation: '#1baf7a',
  flat5: '#eda100',
  flat80: '#e87ba4',
};
const REGIME_SHORT: Record<string, string> = {
  fairway: 'Fairway 5/30/80',
  flat30: 'Flat 30 bps',
  rotation: 'Fairway, bots rotate wallets',
  flat5: 'Flat 5 bps',
  flat80: 'Flat 80 bps',
};
const ORDER = ['fairway', 'flat30', 'rotation', 'flat5', 'flat80'];
const SEQ = ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281'];
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const text = (x: number, y: number, s: string, o: { size?: number; fill?: string; anchor?: string; weight?: number } = {}) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size ?? 12}" fill="${o.fill ?? C.ink2}" text-anchor="${o.anchor ?? 'start'}" font-weight="${o.weight ?? 400}">${esc(s)}</text>`;
const svg = (w: number, h: number, body: string, title: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}" role="img" aria-label="${esc(title)}">
<rect width="${w}" height="${h}" fill="${C.surface}" rx="8"/>
${body}
</svg>
`;

/** "nice" ticks */
function ticks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : v);
  return out;
}

/** horizontal bar with 4px rounded data-end, square at the zero baseline */
function hbar(x0: number, x1: number, y: number, h: number, fill: string, tip: string): string {
  const left = Math.min(x0, x1);
  const w = Math.abs(x1 - x0);
  const r = Math.min(4, w / 2, h / 2);
  const pos = x1 >= x0;
  // path: square corners at baseline side, rounded at data end
  const d = pos
    ? `M${left},${y} h${w - r} q${r},0 ${r},${r} v${h - 2 * r} q0,${r} -${r},${r} h-${w - r} z`
    : `M${left + w},${y} h-${w - r} q-${r},0 -${r},${r} v${h - 2 * r} q0,${r} ${r},${r} h${w - r} z`;
  return `<path d="${d}" fill="${fill}"><title>${esc(tip)}</title></path>`;
}

function regimeBars(bt: BacktestOutput): string {
  const panels: Array<{ key: string; title: string; fmt: (v: number) => string; get: (m: any) => number; note: string }> = [
    { key: 'lp', title: 'LP PnL vs HODL ($/day)', fmt: usd, get: (m) => m.lpPnlVsHodlUsd / (bt.config.hours / 24), note: 'higher is better for LPs' },
    { key: 'retail', title: 'Retail execution cost (bps)', fmt: (v) => v.toFixed(1), get: (m) => m.retailCostBps, note: 'fee + impact vs CEX mid; lower is better' },
    { key: 'stale', title: 'Pool staleness, p95 |pool − CEX| (bps)', fmt: (v) => v.toFixed(0), get: (m) => m.stalenessP95Bps, note: 'lower = fresher price' },
  ];
  const W = 980;
  const panelW = 300;
  const gap = 20;
  const labelW = 0;
  const top = 70;
  const barH = 22;
  const rowH = 34;
  const H = top + ORDER.length * rowH + 70;
  let body = text(24, 32, 'Backtest: five fee regimes on the same simulated market', { size: 17, fill: C.ink, weight: 600 });
  body += text(24, 52, `${bt.seeds.length} seeds × ${bt.config.hours}h, 60% vol + jumps, $${(bt.config.poolBase * bt.config.s0 * 2 / 1e6).toFixed(0)}M pool. Simulated data.`, { size: 12, fill: C.ink2 });
  panels.forEach((p, pi) => {
    const px = 24 + pi * (panelW + gap) + labelW;
    const vals = ORDER.map((r) => p.get(bt.regimes.find((x) => x.regime === r)!.mean));
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    const plotL = px + 150;
    const plotW = panelW - 150 - 46;
    const sx = (v: number) => plotL + ((v - lo) / (hi - lo || 1)) * plotW;
    body += text(px, top - 4, p.title, { size: 12, fill: C.ink, weight: 600 });
    ORDER.forEach((r, i) => {
      const y = top + 10 + i * rowH;
      const v = vals[i]!;
      body += text(px, y + barH / 2 + 4, REGIME_SHORT[r]!.replace('Fairway, bots rotate wallets', 'Fairway, rotation'), { size: 11, fill: C.ink2 });
      body += hbar(sx(0), sx(v), y, barH, REGIME_COLOR[r]!, `${REGIME_SHORT[r]}: ${p.fmt(v)}`);
      const lx = v >= 0 ? sx(v) + 4 : sx(v) - 4;
      body += text(lx, y + barH / 2 + 4, p.fmt(v), { size: 11, fill: C.ink, anchor: v >= 0 ? 'start' : 'end' });
    });
    body += `<line x1="${sx(0)}" x2="${sx(0)}" y1="${top + 4}" y2="${top + 10 + ORDER.length * rowH - 8}" stroke="${C.axis}" stroke-width="1"/>`;
    body += text(px, top + 10 + ORDER.length * rowH + 14, p.note, { size: 11, fill: C.muted });
  });
  return svg(W, H, body, 'Backtest regimes comparison');
}

function lpLines(bt: BacktestOutput): string {
  const series = ['fairway', 'flat30', 'rotation', 'flat5'];
  const W = 820;
  const H = 400;
  const L = 70;
  const R = 270;
  const T = 70;
  const B = 50;
  const net = (r: string) => {
    const s = bt.series[r as keyof typeof bt.series];
    return s.feesUsd.map((f, i) => f - s.arbUsd[i]! - s.sniperUsd[i]!);
  };
  const all = series.flatMap((r) => net(r));
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const tmax = Math.max(...bt.series.flat30.t);
  const sx = (t: number) => L + (t / tmax) * (W - L - R);
  const sy = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  let body = text(24, 32, 'What LPs keep: fees minus what bots take (one simulated day, seed 1)', { size: 17, fill: C.ink, weight: 600 });
  body += text(24, 52, 'Cumulative LP fee revenue − arbitrage profit (LVR proxy) − sniper profit, USD. Simulated data.', { size: 12 });
  for (const v of ticks(lo, hi, 6)) {
    body += `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="${v === 0 ? C.axis : C.grid}" stroke-width="1"/>`;
    body += text(L - 8, sy(v) + 4, usd(v), { size: 11, fill: C.muted, anchor: 'end' });
  }
  for (let h = 0; h <= tmax / 3600; h += 4) body += text(sx(h * 3600), H - B + 18, `${h}h`, { size: 11, fill: C.muted, anchor: 'middle' });
  const ends: Array<{ y: number; r: string; v: number }> = [];
  for (const r of series) {
    const s = bt.series[r as keyof typeof bt.series];
    const n = net(r);
    const d = s.t.map((t, i) => `${i ? 'L' : 'M'}${sx(t).toFixed(1)},${sy(n[i]!).toFixed(1)}`).join('');
    body += `<path d="${d}" fill="none" stroke="${REGIME_COLOR[r]}" stroke-width="2" stroke-linejoin="round"><title>${esc(REGIME_SHORT[r]!)}</title></path>`;
    ends.push({ y: sy(n.at(-1)!), r, v: n.at(-1)! });
  }
  // de-collide end labels
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 16) ends[i]!.y = ends[i - 1]!.y + 16;
  for (const e of ends) {
    body += `<circle cx="${W - R}" cy="${sy(e.v)}" r="4" fill="${REGIME_COLOR[e.r]}" stroke="${C.surface}" stroke-width="2"/>`;
    body += text(W - R + 10, e.y + 4, `${REGIME_SHORT[e.r]} ${usd(e.v)}`, { size: 11, fill: C.ink });
  }
  return svg(W, H, body, 'LP PnL vs HODL time series');
}

function sweepHeatmap(sw: SweepOutput): string {
  const W = 760;
  const H = 360;
  const L = 120;
  const T = 90;
  const cw = 110;
  const ch = 58;
  const vals = sw.cells.map((c) => c.fairway.lpPnlVsHodlUsd);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const base = sw.baseline.lpPnlVsHodlUsd;
  let body = text(24, 32, 'Parameter sweep: LP PnL vs HODL ($/day), Fairway regime', { size: 17, fill: C.ink, weight: 600 });
  body += text(24, 52, `STANDARD fixed at 30 bps. Flat-30 baseline: ${usd(base)}/day. Outlined: recommended. Hatched: p95 staleness above ${sw.stalenessBoundBps.toFixed(0)} bps.`, { size: 12 });
  body += `<defs><pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="6" stroke="${C.surface}" stroke-width="2" opacity="0.7"/></pattern></defs>`;
  body += text(L + (sw.toxic.length * cw) / 2, T - 14, 'TOXIC fee (bps)', { size: 12, fill: C.ink, anchor: 'middle', weight: 600 });
  body += text(24, T + 10, 'RETAIL fee', { size: 12, fill: C.ink, weight: 600 });
  body += text(24, T + 26, '(bps)', { size: 12, fill: C.ink2 });
  sw.toxic.forEach((t, i) => (body += text(L + i * cw + cw / 2, T + sw.retail.length * ch + 18, String(t), { size: 12, anchor: 'middle' })));
  sw.retail.forEach((r, j) => {
    body += text(L - 12, T + j * ch + ch / 2 + 4, String(r), { size: 12, anchor: 'end' });
    sw.toxic.forEach((t, i) => {
      const c = sw.cells.find((x) => x.toxicBps === t && x.retailBps === r)!;
      const v = c.fairway.lpPnlVsHodlUsd;
      const k = Math.round(((v - lo) / (hi - lo || 1)) * (SEQ.length - 1));
      const x = L + i * cw;
      const y = T + j * ch;
      const fill = SEQ[k]!;
      body += `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" rx="4" fill="${fill}"><title>toxic ${t} / retail ${r}: LP ${usd(v)}/day, retail cost ${c.fairway.retailCostBps.toFixed(1)} bps, p95 staleness ${c.fairway.stalenessP95Bps.toFixed(0)} bps</title></rect>`;
      if (!c.meetsStaleness) body += `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" rx="4" fill="url(#hatch)"/>`;
      const light = k >= 4;
      body += text(x + cw / 2, y + ch / 2 - 2, usd(v), { size: 13, fill: light ? '#ffffff' : C.ink, anchor: 'middle', weight: 600 });
      body += text(x + cw / 2, y + ch / 2 + 14, `retail ${c.fairway.retailCostBps.toFixed(1)} bps`, { size: 10, fill: light ? '#ffffff' : C.ink, anchor: 'middle' });
      if (t === sw.recommended.toxicBps && r === sw.recommended.retailBps) body += `<rect x="${x + 2}" y="${y + 2}" width="${cw - 4}" height="${ch - 4}" rx="4" fill="none" stroke="${C.ink}" stroke-width="2.5"/>`;
    });
  });
  body += text(L, H - 24, sw.recommended.reason, { size: 11, fill: C.ink2 });
  return svg(W, H, body, 'Parameter sweep heatmap');
}

function frontier(bt: BacktestOutput, sw: SweepOutput): string {
  const W = 820;
  const H = 440;
  const L = 80;
  const R = 40;
  const T = 96;
  const B = 56;
  const days = bt.config.hours / 24;
  type P = { x: number; y: number; group: 'flat' | 'fairway' | 'rotation'; label?: string };
  const pts: P[] = [];
  for (const f of sw.flatCurve) {
    pts.push({ x: f.metrics.retailCostBps, y: f.metrics.lpPnlVsHodlUsd / days, group: 'flat', label: [5, 30, 80].includes(f.feeBps) ? `Flat ${f.feeBps} bps` : undefined });
  }
  for (const c of sw.cells) {
    pts.push({ x: c.fairway.retailCostBps, y: c.fairway.lpPnlVsHodlUsd / days, group: 'fairway', label: c.toxicBps === 80 && c.retailBps === 5 ? 'Fairway 5/30/80' : undefined });
    if (c.toxicBps === 80) pts.push({ x: c.rotation.retailCostBps, y: c.rotation.lpPnlVsHodlUsd / days, group: 'rotation', label: c.retailBps === 20 ? 'worst case: bots rotate wallets' : undefined });
  }
  const GC = { flat: REGIME_COLOR.flat30!, fairway: REGIME_COLOR.fairway!, rotation: REGIME_COLOR.rotation! };
  const xlo = 0;
  const xhi = Math.max(...pts.map((p) => p.x)) * 1.05;
  const ylo = Math.min(0, ...pts.map((p) => p.y)) * 1.1;
  const yhi = Math.max(...pts.map((p) => p.y)) * 1.1;
  const sx = (v: number) => L + ((v - xlo) / (xhi - xlo)) * (W - L - R);
  const sy = (v: number) => T + (1 - (v - ylo) / (yhi - ylo)) * (H - T - B);
  let body = text(24, 32, 'The trade-off a flat fee cannot escape', { size: 17, fill: C.ink, weight: 600 });
  body += text(24, 52, 'Each dot is one fee setting (mean of all seeds). Up = LPs keep more; left = retail pays less.', { size: 12 });
  body += text(24, 68, 'A flat fee can only move along the dashed curve. Fairway settings sit above it. Simulated data.', { size: 12 });
  for (const v of ticks(ylo, yhi, 6)) {
    body += `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="${v === 0 ? C.axis : C.grid}"/>`;
    body += text(L - 8, sy(v) + 4, usd(v), { size: 11, fill: C.muted, anchor: 'end' });
  }
  for (const v of ticks(xlo, xhi, 8)) body += text(sx(v), H - B + 18, String(v), { size: 11, fill: C.muted, anchor: 'middle' });
  body += text((L + W - R) / 2, H - 14, 'Retail execution cost (bps)', { size: 12, fill: C.ink2, anchor: 'middle' });
  body += text(16, T - 12, 'LP PnL vs HODL ($/day)', { size: 12, fill: C.ink2 });
  // flat-fee line
  const flats = pts.filter((p) => p.group === 'flat').sort((a, b) => a.x - b.x);
  body += `<path d="${flats.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x)},${sy(p.y)}`).join('')}" fill="none" stroke="${GC.flat}" stroke-width="2" stroke-dasharray="5 4"/>`;
  for (const p of pts) {
    body += `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${p.group === 'fairway' ? 5 : 6}" fill="${GC[p.group]}" stroke="${C.surface}" stroke-width="2"><title>${esc(p.label ?? p.group)}: retail ${p.x.toFixed(1)} bps, LP ${usd(p.y)}/day</title></circle>`;
    if (p.label) {
      const dy = p.group === 'rotation' ? 22 : p.group === 'fairway' ? -12 : -10;
      const dx = p.group === 'flat' ? 10 : p.group === 'rotation' ? 14 : -10;
      body += text(sx(p.x) + dx, sy(p.y) + dy, p.label, { size: 11, fill: C.ink, anchor: p.group === 'fairway' ? 'end' : 'start' });
    }
  }
  // legend
  const lg: Array<[string, string]> = [
    ['Flat fee, 5 to 80 bps', GC.flat],
    ['Fairway tiers (sweep grid)', GC.fairway],
    ['Fairway, bots rotate wallets', GC.rotation],
  ];
  lg.forEach(([l, c], i) => {
    const x = W - R - 240;
    const y = H - B - 70 + i * 18;
    body += `<circle cx="${x}" cy="${y - 4}" r="5" fill="${c}"/>` + text(x + 12, y, l, { size: 11, fill: C.ink2 });
  });
  return svg(W, H, body, 'Retail cost vs LP PnL frontier');
}

/** M16 key chart: volume-weighted launch fee paid by humans vs snipers, per regime (grouped horizontal bars). */
function launchKey(st: LaunchStudy): string {
  const groups = [
    { k: 'humanFeeBps' as const, label: 'Humans (retail buyers)', fill: '#1baf7a' },
    { k: 'sniperFeeBps' as const, label: 'All snipers + bundlers', fill: '#eda100' },
    { k: 'knownSniperFeeBps' as const, label: 'Known snipers (TOXIC)', fill: '#d6455d' },
  ];
  const W = 900;
  const top = 92;
  const barH = 14;
  const rowH = 3 * (barH + 3) + 16;
  const H = top + st.keyChart.length * rowH + 40;
  const hi = Math.max(...st.keyChart.flatMap((r) => groups.map((g) => r[g.k])));
  const plotL = 200;
  const plotW = W - plotL - 90;
  const sx = (v: number) => plotL + (v / (hi || 1)) * plotW;
  let body = text(24, 32, 'Launch fees: who pays? (bps, volume-weighted)', { size: 17, fill: C.ink, weight: 600 });
  body += text(24, 52, `${st.launches} simulated launches. Fairway cuts the human fee by ${st.paired.humanFeeCutPct.toFixed(0)}% vs time-decay-only; known snipers pay ${st.paired.knownSniperFeeRatio.toFixed(2)}×. Simulated data.`, { size: 12, fill: C.ink2 });
  groups.forEach((g, i) => {
    const lx = 24 + i * 230;
    body += `<rect x="${lx}" y="64" width="10" height="10" rx="2" fill="${g.fill}"/>` + text(lx + 16, 73, g.label, { size: 11, fill: C.ink2 });
  });
  st.keyChart.forEach((r, ri) => {
    const y0 = top + ri * rowH;
    body += text(24, y0 + 1.5 * (barH + 3) + 4, r.short, { size: 12, fill: C.ink, weight: 600 });
    groups.forEach((g, gi) => {
      const y = y0 + gi * (barH + 3);
      const v = r[g.k];
      body += hbar(sx(0), sx(v), y, barH, g.fill, `${r.short} · ${g.label}: ${v.toFixed(0)} bps`);
      body += text(sx(v) + 4, y + barH - 3, `${v.toFixed(0)}`, { size: 11, fill: C.ink });
    });
  });
  body += `<line x1="${sx(0)}" x2="${sx(0)}" y1="${top - 4}" y2="${top + st.keyChart.length * rowH - 12}" stroke="${C.axis}"/>`;
  body += text(24, H - 14, 'Rotation = worst case: every sniper uses a fresh wallet (STANDARD), so it pays exactly the time-decay fee.', { size: 11, fill: C.muted });
  return svg(W, H, body, 'Launch fee paid by humans vs snipers');
}

/** M16 fee schedules: fee by slot since launch. */
function launchSchedule(st: LaunchStudy): string {
  const W = 820;
  const H = 360;
  const L = 60;
  const R = 200;
  const T = 70;
  const B = 50;
  const xs = st.schedules.map((r) => r.slot);
  const xmax = Math.max(...xs);
  const ymax = 1000;
  const sx = (v: number) => L + (v / xmax) * (W - L - R);
  const sy = (v: number) => T + (1 - v / ymax) * (H - T - B);
  const lines = [
    { k: 'decay' as const, label: 'Time-decay (everyone)', c: '#eb6834', dash: '' },
    { k: 'fairwayToxic' as const, label: 'Fairway TOXIC', c: '#d6455d', dash: '' },
    { k: 'fairwayStandard' as const, label: 'Fairway STANDARD (fresh)', c: '#eda100', dash: '6 3' },
    { k: 'fairwayRetail' as const, label: 'Fairway RETAIL', c: '#1baf7a', dash: '' },
  ];
  let body = text(24, 32, 'Launch fee schedules', { size: 17, fill: C.ink, weight: 600 });
  body += text(24, 52, `Fee (bps) by time since launch; window ${st.config.windowSlots} slots ≈ ${Math.round((st.config.windowSlots * 0.4) / 60)} min. Program defaults.`, { size: 12, fill: C.ink2 });
  for (const t of ticks(0, ymax, 5)) body += `<line x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}" stroke="${C.grid}"/>` + text(L - 6, sy(t) + 4, `${t}`, { size: 11, anchor: 'end', fill: C.muted });
  for (const t of ticks(0, xmax * 0.4, 6)) body += text(sx(t / 0.4), H - B + 18, `${t}s`, { size: 11, anchor: 'middle', fill: C.muted });
  body += `<line x1="${sx(st.config.windowSlots)}" x2="${sx(st.config.windowSlots)}" y1="${T}" y2="${H - B}" stroke="${C.axis}" stroke-dasharray="4 4"/>`;
  lines.forEach((l, i) => {
    const d = st.schedules.map((r, j) => `${j ? 'L' : 'M'}${sx(r.slot).toFixed(1)},${sy(r[l.k]).toFixed(1)}`).join(' ');
    body += `<path d="${d}" fill="none" stroke="${l.c}" stroke-width="2.2" ${l.dash ? `stroke-dasharray="${l.dash}"` : ''}><title>${esc(l.label)}</title></path>`;
    const last = st.schedules[0]!;
    body += text(W - R + 12, T + 14 + i * 20, `${l.label}: ${last[l.k]}→${st.schedules[st.schedules.length - 1]![l.k]} bps`, { size: 11, fill: l.c, weight: 600 });
  });
  return svg(W, H, body, 'Launch fee schedules');
}

const bt = JSON.parse(readFileSync(join(OUT_DIR, 'backtest.json'), 'utf8')) as BacktestOutput;
const launch = JSON.parse(readFileSync(join(OUT_DIR, 'launch.json'), 'utf8')) as LaunchStudy;
const sw = JSON.parse(readFileSync(join(OUT_DIR, 'sweep.json'), 'utf8')) as SweepOutput;
mkdirSync(CHART_DIR, { recursive: true });
const files: Record<string, string> = {
  'regimes.svg': regimeBars(bt),
  'lp-pnl.svg': lpLines(bt),
  'sweep.svg': sweepHeatmap(sw),
  'frontier.svg': frontier(bt, sw),
  'launch-fees.svg': launchKey(launch),
  'launch-schedule.svg': launchSchedule(launch),
};
for (const [f, s] of Object.entries(files)) writeFileSync(join(CHART_DIR, f), s);
// PNG copies (for Devpost / slides). sharp is optional: skip quietly if it is not installed.
try {
  const sharp = (await import('sharp')).default;
  await Promise.all(Object.entries(files).map(([f, s]) => sharp(Buffer.from(s), { density: 144 }).png().toFile(join(CHART_DIR, f.replace('.svg', '.png')))));
  console.log('PNG copies written');
} catch (e) {
  console.log(`PNG export skipped (${(e as Error).message})`);
}
console.log(`charts → ${CHART_DIR}: ${Object.keys(files).join(', ')}`);
