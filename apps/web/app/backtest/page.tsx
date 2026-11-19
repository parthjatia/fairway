import { simOutputs } from '@/lib/server/data';
import { PageHeader } from '@/components/ui';
import { BacktestExplorer } from '@/components/backtest-explorer';

export const metadata = { title: 'Backtest — Fairway' };

export default function BacktestPage() {
  const { backtest, sweep, sensitivity } = simOutputs();
  const slim = {
    sweep: { toxic: sweep.toxic, retail: sweep.retail, cells: sweep.cells, flatCurve: sweep.flatCurve, baseline: sweep.baseline, context: sweep.context, recommended: sweep.recommended, stalenessBoundBps: sweep.stalenessBoundBps, hours: sweep.config.hours, seeds: sweep.seeds.length },
    series: backtest.series,
    sensitivity: sensitivity.rows,
  };
  return (
    <>
      <PageHeader eyebrow="Backtest" title="Move the fees, watch the pool">
        Agent-based simulation: GBM price with jumps, Poisson retail flow, arbitrageurs and momentum snipers. Choose the toxic and retail fee (STANDARD stays 30 bps). The{' '}
        <strong className="text-ink">rotation</strong> regime is the worst case where every bot uses fresh wallets and therefore pays STANDARD.
      </PageHeader>
      <BacktestExplorer data={slim as never} />
    </>
  );
}
