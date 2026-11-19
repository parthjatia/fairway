import { simOutputs } from '@/lib/server/data';
import { PageHeader } from '@/components/ui';
import { BacktestTabs } from '@/components/backtest-tabs';

export const metadata = { title: 'Backtest — Fairway' };

export default function BacktestPage() {
  const { backtest, sweep, sensitivity, lpfirst, launch } = simOutputs();
  const launchData = { regimes: launch.regimes, keyChart: launch.keyChart, paired: launch.paired, schedules: launch.schedules, launches: launch.launches, windowSlots: launch.config.windowSlots, knownShare: launch.config.sniper.knownShare, historyShare: launch.config.retail.historyShare };
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
      <PageHeader eyebrow="Backtest" title="Fair launches, simulated">
        {launch.launches} synthetic token launches with snipers, bundlers, retail buyers and DCA bots, compared under flat fees, a <strong className="text-ink">time-decay-only</strong> anti-sniper fee (what other launchpads do),
        and <strong className="text-ink">Fairway</strong> (fee = tier × time since launch). The liquid-pair tabs show the same engine on SOL/USDC, where arbitrage bots are the toxic flow.
      </PageHeader>
      <BacktestTabs launch={launchData} lpfirst={lp as never} maxDiscount={maxDiscount as never} />
    </>
  );
}
