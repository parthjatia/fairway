import { pairs, poolView, simOutputs, sniperTimeToToxic } from '@/lib/server/data';
import { Card, PageHeader, Stat, TierBadge, TIER_FEE_DEFAULT } from '@/components/ui';
import { TierStackClient, UsdBars } from '@/components/pool-client';
import { bps, num, short, signed, time, usd, usdCompact } from '@/lib/format';
import Link from 'next/link';

export const metadata = { title: 'Pool — Fairway' };

export default async function PoolPage({ searchParams }: { searchParams: Promise<{ pool?: string }> }) {
  const key = (await searchParams).pool === 'bonk' ? 'bonk' : 'sol';
  const p = poolView(key);
  const e = p.economics;
  const sniperRows = key === 'bonk' ? sniperTimeToToxic() : [];
  const { backtest, lpfirst } = simOutputs();
  const rec = lpfirst.cells.find((c) => c.id === lpfirst.recommended.id)!;
  const after = rec.lpAfterProtocol[lpfirst.recommended.protocolOption]!;
  const lfDays = lpfirst.config.hours / 24;
  const usdSigned = (v: number) => `${v >= 0 ? '+' : '−'}${usd(Math.abs(v))}`;
  const days = backtest.config.hours / 24;
  const m = Object.fromEntries(backtest.regimes.map((r) => [r.regime, r.mean]));
  const tiers = ['RETAIL', 'STANDARD', 'TOXIC'] as const;
  const totalFees = tiers.reduce((a, t) => a + p.feesByTier[t], 0);
  const totalVol = tiers.reduce((a, t) => a + p.volumeByTier[t], 0);
  return (
    <>
      <PageHeader eyebrow="Liquidity" title={p.label}>
        Reserves and flow replayed from the fixture swap history. Fees are re-priced under the current default schedule (retail 30 bps minus the bot-tax rebate, standard 30, toxic 80). Fees by tier show who actually pays LPs.
      </PageHeader>
      <div className="space-y-6">
        <nav aria-label="Pool" className="flex flex-wrap gap-2 text-sm">
          {pairs().map((x) => (
            <Link key={x.key} href={x.key === 'sol' ? '/pool' : `/pool?pool=${x.key}`} aria-current={x.key === key ? 'page' : undefined} className={`rounded-full border px-3 py-1.5 font-semibold ${x.key === key ? 'border-accent bg-surface-2 text-ink' : 'border-line text-ink-2 hover:text-ink'}`}>
              {x.label}
            </Link>
          ))}
        </nav>
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="grid gap-5 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">Extra fees earned from bots</div>
              <div className="mt-1 text-4xl font-semibold tracking-tight text-ink tnum">{usd(e.botExtraFeesUsd)}</div>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">What TOXIC-tier flow paid above a flat 30 bps fee on the same volume ({p.tradesByTier.TOXIC} swaps). A flat-fee pool would have left this on the table.</p>
            </div>
            <Stat label="Bot-tax rebate to retail" value={usd(e.retailSavedUsd)} hint={`about ${e.rebateBps} bps off the 30 bps retail fee`} tone="good" />
            <Stat label="Protocol revenue" value={usd(e.protocolRevenueUsd)} hint={`${e.protocolFeeBps / 100}% of the toxic premium → treasury (nothing from other fees)`} />
            <Stat label="LPs keep" value={usd(e.lpFeesUsd)} hint="all fees except the protocol's premium share" />
          </div>
          <p className="mt-3 text-xs text-muted">
            Fixture replay on synthetic data, volume held fixed (no behaviour change). The rebate is capped onchain at a share of the previous epoch's toxic premium, so it can never exceed what bots paid. The treasury also pays the rent of each new wallet&apos;s score account (about 0.0023 SOL, {num(e.sponsoredRentSol, 2)} SOL for {p.uniqueTraders} wallets here) while it holds SOL;
            otherwise the trader pays.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="TVL" value={usdCompact(p.tvlUsd)} hint={`${usdCompact(p.reserves.base)} ${p.baseSymbol} · ${usdCompact(p.reserves.quote)} USDC`.replace('$', '')} />
          <Stat label="Pool price" value={usd(p.price, key === 'bonk' ? 8 : 2)} hint={`USDC per ${p.baseSymbol}`} />
          <Stat label="Volume" value={usdCompact(totalVol)} hint={`${p.trades} swaps · ${p.uniqueTraders} wallets`} />
          <Stat label="LP fees" value={usdCompact(totalFees)} hint={`${bps((totalFees / totalVol) * 1e4)} blended`} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Fees by tier, per day" subtitle="USD earned by LPs">
            <TierStackClient data={p.daily} />
          </Card>
          <Card title="Volume and fees by tier">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] whitespace-nowrap text-sm tnum">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
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
            </div>
          </Card>
        </div>
        {key === 'bonk' && (
          <Card title="Snipers score TOXIC fastest on memecoins" subtitle="Settled Fairway trades until a wallet's running onchain score first reaches TOXIC (≥ 10 bps, shrunk with K = 2,000). Test mint, synthetic data.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] whitespace-nowrap text-left text-sm tnum">
                <thead className="text-xs uppercase tracking-wide text-muted"><tr><th className="py-2">Wallet</th><th>Here (BONK-test)</th><th>On SOL / USDC</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {sniperRows.map((r) => (
                    <tr key={r.address}>
                      <td className="py-2"><Link className="font-mono text-accent" href={`/wallet/${r.address}`}>{short(r.address)}</Link> <span className="text-muted">{r.label}</span></td>
                      <td>{r.meme != null ? `TOXIC after ${r.meme} trades` : 'not TOXIC'}</td>
                      <td className="text-ink-2">{r.sol == null ? (r.solTrades ? `not TOXIC (${r.solTrades} trades)` : 'no trades') : `TOXIC after ${r.sol} trades`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted">A pump or dump moves a memecoin far more than 30 s of normal SOL drift, so an informed trade here earns a bigger markout per trade and the score crosses the threshold sooner.</p>
          </Card>
        )}
        <Card title="LP economics (simulator, LP-first default)" subtitle={`Per day on a $${(backtest.headline.tvlUsd / 1e6).toFixed(0)}M pool; ${lpfirst.seeds.length} paired seeds. LVR proxy = profit arbitrageurs and snipers extract at the CEX mid.`}>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="LVR cut vs flat 30" value={`−${rec.lvrReductionPct.mean.toFixed(0)}%`} hint={`${usd(lpfirst.baseline.flat30.arbProfitUsd / lfDays)} → ${usd((lpfirst.baseline.flat30.arbProfitUsd / lfDays) * (1 - rec.lvrReductionPct.mean / 100))}/d`} tone="good" />
            <Stat label="LP vs flat 30, before protocol" value={`${usdSigned(rec.lpBeforeProtocol.mean)} ± ${usd(rec.lpBeforeProtocol.stderr)}`} hint="per day · within noise" />
            <Stat label="LP vs flat 30, after protocol" value={`${usdSigned(after.mean)} ± ${usd(after.stderr)}`} hint="per day · 15% of the toxic premium" />
            <Stat label="Retail cost vs flat 30" value={`${signed(rec.retailCostBps.vsFlat30Bps.mean, 1)} bps`} hint="never higher" tone="good" />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <div className="mb-1 text-sm font-semibold text-ink">LP PnL vs HODL ($/day)</div>
              <UsdBars rows={backtest.regimes.map((r) => ({ regime: r.regime, value: r.mean.lpPnlVsHodlUsd / days }))} />
            </div>
            <div>
              <div className="mb-1 text-sm font-semibold text-ink">LVR proxy: arbitrage profit ($/day)</div>
              <UsdBars rows={backtest.regimes.map((r) => ({ regime: r.regime, value: r.mean.arbProfitUsd / days }))} />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">Bars below show the previous 5 / 30 / 80 design (&quot;max retail discount&quot;), which cuts arbitrage profit from {usd(m.flat30!.arbProfitUsd / days)} to {usd(m.fairway!.arbProfitUsd / days)} per day but costs LPs about {usd(-(m.fairway!.lpPnlVsHodlUsd - m.flat30!.lpPnlVsHodlUsd) / days)}/day versus flat 30. <Link href="/backtest" className="text-accent">Explore parameters →</Link></p>
        </Card>
        <Card title="Recent swaps">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] whitespace-nowrap text-left text-sm tnum">
              <thead className="text-xs uppercase tracking-wide text-muted"><tr><th className="py-2">Time (UTC)</th><th>Trader</th><th>Side</th><th>Size</th><th>Tier</th><th>Fee</th></tr></thead>
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
