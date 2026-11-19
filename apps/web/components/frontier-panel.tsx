'use client';
import type { SweepOutput } from '@fairway/sim';
import { Frontier } from './charts';

export function FrontierPanel({ sweep, selected, height }: { sweep: SweepOutput; selected?: { toxicBps: number; retailBps: number }; height?: number }) {
  const days = sweep.config.hours / 24;
  const flat = sweep.flatCurve.map((f) => ({ x: f.metrics.retailCostBps, y: f.metrics.lpPnlVsHodlUsd / days, label: `Flat ${f.feeBps} bps` }));
  const fairway = sweep.cells.map((c) => ({ x: c.fairway.retailCostBps, y: c.fairway.lpPnlVsHodlUsd / days, label: `Fairway ${c.retailBps}/30/${c.toxicBps}` }));
  const rotation = sweep.cells
    .filter((c) => c.toxicBps === (selected?.toxicBps ?? 80))
    .map((c) => ({ x: c.rotation.retailCostBps, y: c.rotation.lpPnlVsHodlUsd / days, label: `Rotation worst case, retail ${c.retailBps}` }));
  const sel = selected && sweep.cells.find((c) => c.toxicBps === selected.toxicBps && c.retailBps === selected.retailBps);
  return (
    <Frontier
      flat={flat}
      fairway={fairway}
      rotation={rotation}
      highlight={sel ? { x: sel.fairway.retailCostBps, y: sel.fairway.lpPnlVsHodlUsd / days, label: `Selected: Fairway ${sel.retailBps}/30/${sel.toxicBps}` } : undefined}
      height={height}
    />
  );
}
