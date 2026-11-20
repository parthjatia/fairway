'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { RiskGrade } from '@fairway/scoring';
import { ago, localNames, useDemo, useFairwayTokens, type FwToken } from '@/lib/client/fairway';
import { DEMO_LAUNCHES } from '@/lib/launches';
import { LaunchWizard } from '../launch-wizard';
import { LaunchList } from '../launch-list';
import { DevnetBadge, RiskBadge, TokenIcon } from './badges';
import { LaunchSchedule } from './launch-schedule';

export function phaseLabel(t: FwToken): { text: string; tone: string } {
  const l = t.launch;
  if (!l) return { text: 'Normal fees', tone: 'text-ink-2' };
  if (l.phase === 'not-started') return { text: 'Opens soon', tone: 'text-warn' };
  if (l.phase === 'window') return { text: `Launch window · ${Math.round(l.progressPct)}%`, tone: 'text-accent' };
  return { text: 'Window closed · normal fees', tone: 'text-ink-2' };
}

const BAR: Record<RiskGrade, string> = { Low: 'bg-good', Medium: 'bg-warn', High: 'bg-bad' };

function Card({ t, name, now }: { t: FwToken; name: { symbol: string; name: string }; now: number }) {
  const ph = phaseLabel(t);
  const prog = !t.launch ? 100 : t.launch.phase === 'not-started' ? 0 : t.launch.phase === 'window' ? t.launch.progressPct : 100;
  return (
    <Link href={`/launch/${t.mint}`} className="block h-full border-b border-r border-line p-[18px] no-underline hover:bg-surface-2">
      <div className="flex items-center gap-2.5">
        <TokenIcon symbol={name.symbol} size={34} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-ink">{name.symbol}</div>
          <div className="truncate text-xs text-ink-2">{name.name}</div>
        </div>
        <span className="shrink-0 font-mono text-xs text-ink-2">{ago(t.launch?.launchTs ?? t.createdTs, now)}</span>
      </div>
      <div className="mt-3.5 h-1 bg-line" aria-hidden>
        <div className="h-full bg-accent" style={{ width: `${prog}%` }} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 font-mono text-xs font-medium">
        <span className={ph.tone}>{ph.text}</span>
        <RiskBadge check={t.check} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-ink-2">
        <span className="flex items-center gap-1.5">
          Sniper share {t.check.earlyBuyers ? `${Math.round(t.check.sniperSharePct)}%` : '—'}
          {t.check.earlyBuyers > 0 && <span className={`inline-block h-1.5 w-1.5 ${BAR[t.check.grade]}`} aria-hidden />}
        </span>
        <span className="font-mono">
          {t.swaps} swap{t.swaps === 1 ? '' : 's'}
        </span>
      </div>
    </Link>
  );
}

/** Launch, as on the plate: create on the left, the fee schedule on the right, the devnet launches below. */
export function LaunchFeed() {
  const demo = useDemo();
  const { data, error } = useFairwayTokens();
  const [names, setNames] = useState<Record<string, { symbol: string; name: string }>>({});
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    setNames(localNames());
    const t = setInterval(() => setNow(Date.now() / 1000), 15_000);
    return () => clearInterval(t);
  }, []);

  const launches = (data?.tokens ?? []).filter((t) => t.isLaunch).sort((a, b) => (b.launch?.launchTs ?? 0) - (a.launch?.launchTs ?? 0));
  const nameOf = (t: FwToken) => (t.name.startsWith('Token ') && names[t.mint] ? names[t.mint]! : { symbol: t.symbol, name: t.name });
  return (
    <div className="-mt-8 sm:-mt-12">
      <section className="fw-in grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))]">
        <div className="py-12 sm:pr-10">
          <div className="label">02 · Launch</div>
          <h1 className="mt-3.5 text-balance text-[40px] leading-[1.05] sm:text-[48px]">Launch without the snipers.</h1>
          <p className="mt-3 max-w-[460px] text-base text-ink-2">Known snipers start at 10%, fresh wallets at 3%, so switching wallets gains nothing, and wallets with a clean history pay 0.3% from block 0.</p>
          <div className="mt-7 max-w-[520px]">
            <LaunchWizard />
          </div>
          {!demo && <p className="mt-2.5 font-mono text-xs text-ink-2">0.05 SOL launch fee · mint, pool and configure in three transactions</p>}
        </div>
        <div className="border-line pb-10 sm:border-l sm:pl-10 sm:pt-12">
          <LaunchSchedule />
        </div>
      </section>

      <section className="border-t border-line pt-8">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="display text-[28px] leading-tight">{demo ? 'Simulated launches' : 'Launches on Fairway'}</h2>
          {!demo && <DevnetBadge />}
        </div>
        {demo ? (
          <div className="mt-4">
            <LaunchList demo={DEMO_LAUNCHES} />
          </div>
        ) : error && !data ? (
          <p className="mt-4 border border-dashed border-line p-6 text-sm text-bad">Could not read launches from devnet: {error}</p>
        ) : !data ? (
          <div className="mt-4 grid gap-px sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-40" aria-hidden />
            ))}
          </div>
        ) : launches.length === 0 ? (
          <p className="mt-4 border border-dashed border-line p-6 text-sm text-ink-2">No launches on devnet yet. Be the first: create a token above.</p>
        ) : (
          <ul className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] border-l border-t border-l-line border-t-ink">
            {launches.map((t) => (
              <li key={t.mint}>
                <Card t={t} name={nameOf(t)} now={now} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
