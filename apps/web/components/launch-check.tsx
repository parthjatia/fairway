'use client';
import { useMemo } from 'react';
import { DEFAULT_CHECK_CONFIG } from '@fairway/scoring';
import { Card } from './ui';
import { Big, FairLaunchBadge, GradeMark, SniperMeter } from './check/report';
import type { LaunchRun } from '@fairway/sim/launch';
import { launchCheck, SLOT_SEC, type LaunchSimView } from '@/lib/launches';

/** The Fairway Check report for this launch, at the current playback time: the grade moves as the launch plays. */
export function LaunchCheck({ v, run, slot }: { v: LaunchSimView; run: LaunchRun; slot: number }) {
  const r = useMemo(() => launchCheck(v, run, slot), [v, run, slot]);
  const windowSlots = DEFAULT_CHECK_CONFIG.earlyWindowSlots;
  const closed = slot >= windowSlots;
  const secs = Math.round(windowSlots * SLOT_SEC);
  const pct = (x: number) => `${Math.round(x)}%`;
  return (
    <Card title="Fairway Check" subtitle={`The same report buyers see on /check, for this launch. The early window is the first ${secs} seconds${closed ? '.' : ', still open: the grade can change.'}`}>
      {r.earlyBuyers === 0 ? (
        <p className="text-sm text-ink-2">No buys yet. Press play.</p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <GradeMark grade={r.grade} className="shrink-0" />
            <div className="min-w-0">
              <p className="text-lg font-semibold text-ink">{r.verdict}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ink-2">
                {closed && r.fairLaunchVerified ? (
                  <FairLaunchBadge />
                ) : closed ? (
                  <span>Not verified: snipers hold {pct(r.sniperSharePct)} (verified needs under {DEFAULT_CHECK_CONFIG.fairLaunchMaxSniperSharePct}%).</span>
                ) : (
                  <span>Fair-launch verification runs when the window closes.</span>
                )}
              </div>
            </div>
          </div>
          <div className="flush grid grid-cols-2 lg:grid-cols-4">
            <Big label="Sniper share" value={pct(r.sniperSharePct)} hint={`${r.sniperCount} known sniper${r.sniperCount === 1 ? '' : 's'}`} />
            <Big label="New wallets" value={pct(r.freshWalletSharePct)} hint="no history before this launch" />
            <Big label="Dumped already" value={r.sniperCount ? pct(r.snipersDumpedPct) : '0%'} hint={r.sniperCount ? `${r.snipersSold} of ${r.sniperCount} snipers have sold` : 'no snipers to dump'} />
            <Big label="Early buyers" value={String(r.earlyBuyers)} hint={`first ${secs} s`} />
          </div>
          <SniperMeter sharePct={r.sniperSharePct} grade={r.grade} />
          <p className="text-xs text-muted">
            Check counts wallets Fairway already knows as snipers. A sniper on a fresh wallet cannot be identified in advance: it looks like a new wallet here and pays the STANDARD fee, and the &quot;Sniper share of supply&quot; meter above
            counts those too.
          </p>
        </div>
      )}
    </Card>
  );
}
