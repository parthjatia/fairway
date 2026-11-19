import { poolView, simOutputs } from '@/lib/server/data';
import { Card, PageHeader, Stat, TierBadge, TIER_FEE_DEFAULT } from '@/components/ui';
import { TierStackClient, UsdBars } from '@/components/pool-client';
import { bps, num, short, time, usd, usdCompact } from '@/lib/format';
import Link from 'next/link';

export const metadata = { title: 'Pool — Fairway' };

export default function PoolPage() {
  const p = poolView();
  const { backtest } = simOutputs();
  const days = backtest.config.hours / 24;
  const m = Object.fromEntries(backtest.regimes.map((r) => [r.regime, r.mean]));
  const tiers = ['RETAIL', 'STANDARD', 'TOXIC'] as const;
  const totalFees = tiers.reduce((a, t) => a + p.feesByTier[t], 0);
  const totalVol = tiers.reduce((a, t) => a + p.volumeByTier[t], 0);
  return (
    <>
      <PageHeader eyebrow="Liquidity" title={p.label}>
        Reserves and flow replayed from the fixture swap history. Fees by tier show who actually pays LPs: toxic flow pays the most per dollar, retail the least.
      </PageHeader>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="TVL" value={usdCompact(p.tvlUsd)} hint={`${num(p.reserves.base, 0)} SOL · ${usdCompact(p.reserves.quote)} USDC`} />
          <Stat label="Pool price" value={usd(p.price, 2)} hint="quote per SOL" />
          <Stat label="Volume" value={usdCompact(totalVol)} hint={`${p.trades} swaps · ${p.uniqueTraders} wallets`} />
          <Stat label="LP fees" value={usdCompact(totalFees)} hint={`${bps((totalFees / totalVol) * 1e4)} blended`} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Fees by tier, per day" subtitle="USD earned by LPs">
            <TierStackClient data={p.daily} />
          </Card>
          <Card title="Volume and fees by tier">
            <table className="w-full text-[13px] tnum">
              <thead className="text-left text-[12px] uppercase tracking-wide text-muted">
                <tr><th className="py-2">Tier</th><th>Fee</th><th>Swaps</th><th>Volume</th><th>Fees</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tiers.map((t) => (
                  <tr key={t}>
                    <td className="py-2.5"><TierBadge tier={t} /></td>
                    <td>{TIER_FEE_DEFAULT[t]} bps</td>
                    <td>{p.tradesByTier[t]}</td>
                    <td>{usdCompact(p.volumeByTier[t])}</td>
                    <td>{usd(p.feesByTier[t])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <Card title="LP economics (simulator)" subtitle={`Per day on a $${(backtest.headline.tvlUsd / 1e6).toFixed(0)}M pool; mean of ${backtest.seeds.length} seeds. LVR proxy = profit arbitrageurs and snipers extract at the CEX mid.`}>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <div className="mb-1 text-[13px] font-medium text-ink">LP PnL vs HODL ($/day)</div>
              <UsdBars rows={backtest.regimes.map((r) => ({ regime: r.regime, value: r.mean.lpPnlVsHodlUsd / days }))} />
            </div>
            <div>
              <div className="mb-1 text-[13px] font-medium text-ink">LVR proxy: arbitrage profit ($/day)</div>
              <UsdBars rows={backtest.regimes.map((r) => ({ regime: r.regime, value: r.mean.arbProfitUsd / days }))} />
            </div>
          </div>
          <p className="mt-3 text-[12px] text-muted">Fairway cuts arbitrage profit from {usd(m.flat30!.arbProfitUsd / days)} to {usd(m.fairway!.arbProfitUsd / days)} per day. <Link href="/backtest" className="text-accent">Explore parameters →</Link></p>
        </Card>
        <Card title="Recent swaps">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] tnum">
              <thead className="text-[12px] uppercase tracking-wide text-muted"><tr><th className="py-2">Time (UTC)</th><th>Trader</th><th>Side</th><th>Size</th><th>Tier</th><th>Fee</th></tr></thead>
              <tbody className="divide-y divide-line">
                {p.recent.map((s) => (
                  <tr key={s.sig}>
                    <td className="py-2 text-ink-2">{time(s.ts)}</td>
                    <td><Link className="font-mono text-accent" href={`/wallet/${s.trader}`}>{short(s.trader)}</Link> {s.label && <span className="text-muted">{s.label}</span>}</td>
                    <td>{s.side}</td><td>{usd(s.quoteAmount)}</td>
                    <td>{s.tier && <TierBadge tier={s.tier} />}</td><td>{s.feeBps ?? '—'} bps</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
