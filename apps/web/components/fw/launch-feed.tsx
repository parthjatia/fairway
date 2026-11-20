'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { ago, localNames, useDemo, useFairwayTokens, type FwToken } from '@/lib/client/fairway';
import { DEMO_LAUNCHES } from '@/lib/launches';
import { short } from '@/lib/format';
import { LaunchWizard } from '../launch-wizard';
import { LaunchList } from '../launch-list';
import { DevnetBadge, RiskBadge, TokenIcon } from './badges';

export function phaseLabel(t: FwToken): { text: string; tone: string } {
  const l = t.launch;
  if (!l) return { text: 'Normal fees', tone: 'text-ink-2' };
  if (l.phase === 'not-started') return { text: 'Opens soon', tone: 'text-warn' };
  if (l.phase === 'window') return { text: `Launch window · ${Math.round(l.progressPct)}%`, tone: 'text-accent' };
  return { text: 'Window closed · normal fees', tone: 'text-ink-2' };
}

function Card({ t, name, now }: { t: FwToken; name: { symbol: string; name: string }; now: number }) {
  const ph = phaseLabel(t);
  return (
    <Link href={`/launch/${t.mint}`} className="block rounded-md border border-line bg-surface p-4 hover:border-ink-2">
      <div className="flex items-start gap-3">
        <TokenIcon symbol={name.symbol} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-base font-semibold text-ink">{name.symbol}</span>
            <span className="shrink-0 text-xs text-muted tnum">{ago(t.launch?.launchTs ?? t.createdTs, now)}</span>
          </div>
          <div className="truncate text-xs text-ink-2">
            {name.name} · <span className="font-mono">{short(t.mint)}</span>
          </div>
        </div>
      </div>
      {t.launch && t.launch.phase === 'window' && (
        <div className="mt-3 h-1 overflow-hidden rounded-none bg-surface-2" aria-hidden>
          <div className="h-full bg-accent" style={{ width: `${t.launch.progressPct}%` }} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={`font-semibold ${ph.tone}`}>{ph.text}</span>
        <RiskBadge check={t.check} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-ink-2">
        <span>Sniper share {t.check.earlyBuyers ? `${Math.round(t.check.sniperSharePct)}%` : '—'}</span>
        <span className="tnum">{t.swaps} swap{t.swaps === 1 ? '' : 's'}</span>
      </div>
    </Link>
  );
}

export function LaunchFeed() {
  const demo = useDemo();
  const { data, error } = useFairwayTokens();
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<Record<string, { symbol: string; name: string }>>({});
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    setNames(localNames());
    const t = setInterval(() => setNow(Date.now() / 1000), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  if (demo)
    return (
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <LaunchWizard />
        <LaunchList demo={DEMO_LAUNCHES} />
      </div>
    );
  const launches = (data?.tokens ?? []).filter((t) => t.isLaunch).sort((a, b) => (b.launch?.launchTs ?? 0) - (a.launch?.launchTs ?? 0));
  const nameOf = (t: FwToken) => (t.name.startsWith('Token ') && names[t.mint] ? names[t.mint]! : { symbol: t.symbol, name: t.name });
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-ink">Launches</h2>
          <DevnetBadge />
        </div>
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover">
          <Plus size={15} /> Create token
        </button>
      </div>
      {error && !data ? (
        <p className="rounded-md border border-dashed border-line p-6 text-sm text-bad">Could not read launches from devnet: {error}</p>
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-40 rounded-md" aria-hidden />)}
        </div>
      ) : launches.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-6 text-sm text-ink-2">No launches on devnet yet. Be the first: create a token.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {launches.map((t) => (
            <li key={t.mint}>
              <Card t={t} name={nameOf(t)} now={now} />
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 px-4 py-[6vh]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-modal aria-label="Create token" className="relative mx-auto max-w-2xl">
            <button onClick={() => setOpen(false)} aria-label="Close" className="absolute right-3 top-3 z-10 rounded-[4px] p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink">
              <X size={16} />
            </button>
            <LaunchWizard />
          </div>
        </div>
      )}
    </div>
  );
}
