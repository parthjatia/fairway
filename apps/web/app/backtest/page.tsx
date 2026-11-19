import { simOutputs } from '@/lib/server/data';
import { PageHeader } from '@/components/ui';
import { BacktestTabs } from '@/components/backtest-tabs';

export const metadata = { title: 'Backtest — Fairway' };

export default function BacktestPage() {
  const { backtest, sweep, sensitivity, lpfirst } = simOutputs();
  const maxDiscount = {
    sweep: { toxic: sweep.toxic, retail: sweep.retail, cells: sweep.cells, flatCurve: sweep.flatCurve, baseline: sweep.baseline, context: sweep.context, recommended: sweep.recommended, stalenessBoundBps: sweep.stalenessBoundBps, hours: sweep.config.hours, seeds: sweep.seeds.length },
    series: backtest.series,
    sensitivity: sensitivity.rows,
  };
  const lp = {
    cells: lpfirst.cells,
    protocolOptions: lpfirst.protocolOptions,
    recommended: lpfirst.recommended,
    noiseSigmas: lpfirst.noiseSigmas,
    elasticityExtra: lpfirst.elasticityExtra,
    rebate: lpfirst.rebate,
    baseline: { flat30: lpfirst.baseline.flat30 },
    hours: lpfirst.config.hours,
    seeds: lpfirst.seeds.length,
  };
  return (
    <>
      <PageHeader eyebrow="Backtest" title="Move the fees, watch the pool">
        Agent-based simulation: GBM price with jumps, Poisson retail flow, arbitrageurs and momentum snipers. The default view is the <strong className="text-ink">LP-first</strong> model: retail and standard pay 30 bps,
        proven-toxic wallets pay more, and part of that premium is rebated to proven retail. The <strong className="text-ink">rotation</strong> case is the worst one, where every bot uses fresh wallets and pays STANDARD.
      </PageHeader>
      <BacktestTabs lpfirst={lp as never} maxDiscount={maxDiscount as never} />
    </>
  );
}
