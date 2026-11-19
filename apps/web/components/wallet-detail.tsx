'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { useWalletView } from '@/lib/client/use-wallet-view';
import { Card, Empty, PageHeader, ScoreSourceBadge, Stat, TierBadge, TIER_FEE_DEFAULT } from './ui';
import { Histogram, MarkoutBars, ScoreTimeline } from './charts';
import { WalletSearch } from './wallet-search';
import { bps, num, short, signed, time, usd } from '@/lib/format';

export function WalletDetail({ address }: { address: string }) {
  const { data, error, loading } = useWalletView(address);
  const primary = data?.config.primaryHorizon ?? 30;

  const bars = useMemo(
    () =>
      (data?.trades ?? [])
        .slice()
        .reverse()
        .map((t, i) => ({ i, m: t.markouts[primary] ?? 0, ok: t.markouts[primary] != null, label: `${time(t.ts)} · ${t.side}` }))
        .filter((b) => b.ok),
    [data, primary],
  );
  const hist = useMemo(() => {
    const vals = bars.map((b) => b.m);
    if (!vals.length) return [];
    const edges = [-Infinity, -40, -20, -10, -5, 0, 5, 10, 20, 40, Infinity];
    const lbl = (a: number, b: number) => (a === -Infinity ? `<${b}` : b === Infinity ? `>${a}` : `${a}…${b}`);
    return edges.slice(0, -1).map((a, i) => {
      const b = edges[i + 1]!;
      return { bin: lbl(a, b), n: vals.filter((v) => v >= a && v < b).length, mid: a === -Infinity ? -50 : b === Infinity ? 50 : (a + b) / 2 };
    });
  }, [bars]);

  if (loading && !data) return <Empty>Loading score…</Empty>;
  if (error) return <Empty>Could not load this wallet: {error}</Empty>;
  if (!data) return null;
  const cfg = data.config;

  return (
    <>
      <PageHeader eyebrow="Wallet" title={<span className="break-all font-mono text-2xl sm:text-3xl">{short(address, 8)}</span>}>
        <div className="flex flex-wrap items-center gap-3">
          <TierBadge tier={data.tier} size="lg" />
          <span>pays {TIER_FEE_DEFAULT[data.tier]} bps</span>
          <ScoreSourceBadge source={data.scoreSource} />
          {data.label && <span className="text-muted">· {data.label}</span>}
          {data.agentClass && <span className="text-muted">· fixture class: {data.agentClass}</span>}
        </div>
        <p className="mt-3">{data.explanation}</p>
      </PageHeader>
      <div className="space-y-6">
        <OnchainCard data={data} />
        {!data.known || !data.score ? (
          <Empty>
            No swap history for this wallet. Unknown wallets are always STANDARD (30 bps), so a fresh wallet can never beat a proven retail one. <Link className="text-accent" href="/wallet">Try an example</Link>.
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label={`Score (${primary}s)`} value={`${signed(data.score.scoreBps)} bps`} hint={`max over horizons ${signed(data.score.maxScoreBps)}`} />
              <Stat label="Trades" value={data.score.trades} hint={`min ${cfg.minTrades} to leave STANDARD`} />
              <Stat label="Notional" value={usd(data.score.totalNotional)} hint={`prior K = ${usd(cfg.priorNotional)}`} />
              <Stat label="History" value={`${num(data.score.historyDays, 1)} d`} hint={`RETAIL needs ≥ ${cfg.retailMinHistoryDays} d`} />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="Markout per trade" subtitle={`${primary}s horizon. Warm = price moved the trader's way afterwards.`}>
                <MarkoutBars data={bars} height={160} />
              </Card>
              <Card title="Markout distribution" subtitle="bps, all scored trades">
                <Histogram data={hist} height={160} />
              </Card>
            </div>
            <Card title="Tier timeline" subtitle="The score and tier this wallet would have had after each trade.">
              <ScoreTimeline data={data.timeline.map((t) => ({ t: t.ts, score: t.scoreBps, max: t.maxScoreBps }))} toxic={cfg.toxicScoreBps} retail={cfg.retailScoreBps} />
              <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-ink-2">
                {data.timeline.length > 0 && <>Latest: <TierBadge tier={data.timeline.at(-1)!.tier} /></>}
              </div>
            </Card>
            <Card title="Per-horizon scores">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {Object.entries(data.score.byHorizon).map(([h, v]) => (
                  <div key={h} className="rounded-xl border border-line p-3">
                    <div className="text-[12px] text-muted">{h}s horizon</div>
                    <div className="text-xl font-semibold text-ink tnum">{signed(v.scoreBps)} bps</div>
                    <div className="text-[12px] text-ink-2">raw {signed(v.rawBps)} · {v.scoredTrades} trades</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Trades" subtitle={`${data.trades.length} total (${data.source === 'ingest' ? 'from ingest service' : 'computed in-process from fixtures'})`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px] tnum">
                  <thead className="text-[12px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="py-2 pr-4">Time (UTC)</th><th className="pr-4">Side</th><th className="pr-4">Notional</th><th className="pr-4">Price</th><th className="pr-4">Fee</th><th>Markout {primary}s</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.trades.slice(0, 40).map((t) => (
                      <tr key={t.sig + t.pool}>
                        <td className="py-2 pr-4 text-ink-2">{time(t.ts)}</td>
                        <td className="pr-4">{t.side}</td>
                        <td className="pr-4">{usd(t.quoteAmount)}</td>
                        <td className="pr-4">{num(t.execPrice)}</td>
                        <td className="pr-4">{t.feeBps != null ? `${t.feeBps} bps` : '—'}</td>
                        <td className={t.markouts[primary] == null ? 'text-muted' : (t.markouts[primary] as number) > 0 ? 'text-bad' : 'text-ink'}>{t.markouts[primary] == null ? '—' : bps(t.markouts[primary] as number)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
        <Card title="How this score is computed">
          <ol className="list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-ink-2">
            <li>For each trade, markout = side × (mid(t+h) − execPrice) / execPrice × 10⁴ bps, using the pre-fee price. We measure information, not cost.</li>
            <li>Wallet score = Σ(notional × markout) / (Σ notional + K), with K = {usd(cfg.priorNotional)}. The prior shrinks small samples toward zero, so one lucky trade proves nothing.</li>
            <li>TOXIC if score ≥ {cfg.toxicScoreBps} bps and ≥ {cfg.minTrades} trades. RETAIL if score ≤ {cfg.retailScoreBps} bps, ≥ {cfg.minTrades} trades and ≥ {cfg.retailMinHistoryDays} days of history. Otherwise STANDARD.</li>
            <li>Bootstrap: a keeper writes the offchain tier (all venues, via QuickNode Streams) to a TraderScore PDA seeded by the wallet. The swap program reads only the PDA derived from the signer.</li>
            <li>Onchain verified: every Fairway swap is queued in the same PDA. After {data.onchain.markoutSlots} slots (~30 s) anyone can call settle_markout, which reads the Pyth mid and applies the same formula and thresholds onchain. Once settled notional reaches {usd(data.onchain.thresholdNotional)} over at least {data.onchain.minTrades} trades, the onchain tier wins and the keeper can no longer change this wallet&apos;s fee.</li>
          </ol>
        </Card>
        <WalletSearch />
      </div>
    </>
  );
}

function OnchainCard({ data }: { data: NonNullable<ReturnType<typeof useWalletView>['data']> }) {
  const o = data.onchain;
  const pct = Math.min(100, (o.notional / o.thresholdNotional) * 100);
  return (
    <Card
      title="Onchain verified score"
      subtitle="Computed by the Fairway program from this wallet's Fairway trades, marked out against Pyth. No oracle operator involved."
      action={<ScoreSourceBadge source={data.scoreSource} />}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Settled trades" value={o.tradeCount} hint={`needs ${o.minTrades} · horizon ${o.markoutSlots} slots`} />
        <Stat label="Onchain score" value={o.tradeCount ? `${signed(o.scoreBps)} bps` : '—'} hint="integer bps, same shrinkage" />
        <Stat label="Onchain tier" value={o.tradeCount ? <TierBadge tier={o.tier} /> : '—'} hint={o.verified ? 'in force' : 'not in force yet'} />
        <Stat label="Keeper (bootstrap) tier" value={<TierBadge tier={data.bootstrapTier} />} hint={o.verified ? 'overridden' : 'in force'} />
      </div>
      <div className="mt-4">
        <div className="flex justify-between text-[12px] text-ink-2">
          <span>Settled notional {usd(o.notional)}</span>
          <span>
            {o.verified
              ? 'Threshold reached: onchain score wins'
              : o.notional < o.thresholdNotional
                ? `${usd(o.thresholdNotional - o.notional)} more until the onchain score takes over`
                : `${o.minTrades - o.tradeCount} more settled trades until the onchain score takes over`}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${o.verified ? 'bg-retail' : 'bg-muted'}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Card>
  );
}
