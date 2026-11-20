'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { RiskGrade, TokenCheck } from '@fairway/scoring';
import { ago, localNames, useFairwayTokens, type FwToken } from '@/lib/client/fairway';
import { DevnetBadge, MainnetBadge, VENUES } from './badges';
import { GradedTable, type GradedRow } from './graded-table';

type Pump = { via: 'ingest' | 'snapshot'; updatedAt: number; slot: number | null; tokens: (TokenCheck & { name?: string; symbol?: string; image?: string | null; venue?: string })[] } | null;
type Grade = 'All' | RiskGrade;

const fmtPrice = (v: number) => (v >= 1 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v.toPrecision(3));
const GRADES: Grade[] = ['All', 'Low', 'Medium', 'High'];

function Dashed({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 border border-dashed border-line p-6 text-sm text-ink-2">{children}</div>;
}

export function Explore({ pump, initialTab }: { pump: Pump; initialTab: 'fairway' | 'pump' }) {
  const [tab, setTab] = useState(initialTab);
  const [venue, setVenue] = useState<string>('all');
  const [grade, setGrade] = useState<Grade>('All');
  const { data, error } = useFairwayTokens();
  const [names, setNames] = useState<Record<string, { symbol: string; name: string }>>({});
  useEffect(() => setNames(localNames()), []);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(t);
  }, []);
  const choose = (t: 'fairway' | 'pump') => {
    setTab(t);
    window.history.replaceState(null, '', t === 'pump' ? '/explore?tab=pump' : '/explore');
  };

  const fwRows: GradedRow[] = (data?.tokens ?? []).map((t: FwToken) => {
    const n = t.name.startsWith('Token ') && names[t.mint] ? names[t.mint]! : { symbol: t.symbol, name: t.name };
    return { key: t.mint, href: `/launch/${t.mint}`, mint: t.mint, ...n, check: t.check, age: ago(t.launch?.launchTs ?? t.createdTs, now), extra: `${fmtPrice(t.price)} ${t.quoteSymbol}` };
  });
  const pumpRows: GradedRow[] = (pump?.tokens ?? []).map((t) => ({
    key: t.mint,
    href: `/check/${t.mint}`,
    mint: t.mint,
    venue: t.venue || 'pumpfun',
    symbol: t.symbol || t.mint.slice(0, 4),
    name: t.name || `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`,
    image: t.image,
    check: t,
    extra: t.earlyBuyers ? `${Math.round(t.snipersDumpedPct)}%` : '—',
    // the snapshot/ingest knows the launch slot; 400 ms per slot gives the age
    age: pump?.slot && t.launchSlot ? ago(pump.updatedAt - (pump.slot - t.launchSlot) * 0.4, pump.via === 'ingest' ? now : pump.updatedAt) : '—',
  }));

  const base = tab === 'pump' ? (venue === 'all' ? pumpRows : pumpRows.filter((r) => r.venue === venue)) : fwRows;
  const graded = (g: Grade) => (g === 'All' ? base : base.filter((r) => r.check.earlyBuyers > 0 && r.check.grade === g));
  const shown = graded(grade);
  const venueCount = (v: string) => (v === 'all' ? pumpRows.length : pumpRows.filter((r) => r.venue === v).length);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div role="tablist" aria-label="Token source" className="flex gap-5">
            {(
              [
                ['fairway', 'On Fairway'],
                ['pump', 'Live launches'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => choose(k)}
                className={`py-2 text-[15px] font-medium ${tab === k ? 'text-ink shadow-[inset_0_-2px_0_var(--accent)]' : 'text-ink-2 hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'fairway' ? <DevnetBadge /> : pump ? <MainnetBadge updatedAt={pump.updatedAt} /> : null}
        </div>
        <div role="group" aria-label="Filter by grade" className="flex border border-line">
          {GRADES.map((g) => (
            <button
              key={g}
              onClick={() => setGrade(g)}
              aria-pressed={grade === g}
              className={`border-r border-line px-3.5 py-[7px] font-mono text-xs font-medium uppercase tracking-[0.06em] last:border-r-0 ${grade === g ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-surface-2'}`}
            >
              {g} <span className="opacity-60">{graded(g).length}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === 'pump' && pumpRows.length > 0 && (
        <div role="group" aria-label="Launchpad" className="mt-3.5 flex flex-wrap gap-1.5">
          {[['all', 'All launchpads'] as const, ...(['pumpfun', 'launchlab', 'meteora-dbc'] as const).map((v) => [v, VENUES[v]!.label] as const)].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setVenue(v)}
              aria-pressed={venue === v}
              className={`border px-2.5 py-[5px] font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink ${venue === v ? 'border-accent bg-sky' : 'border-line hover:border-ink'}`}
            >
              {label} <span className="text-ink-2">{venueCount(v)}</span>
            </button>
          ))}
        </div>
      )}

      {tab === 'fairway' ? (
        error && !data ? (
          <Dashed>
            <span className="text-bad">Could not read Fairway pools from devnet: {error}</span>
          </Dashed>
        ) : !data ? (
          <div className="skeleton mt-4 h-64" aria-busy />
        ) : fwRows.length === 0 ? (
          <Dashed>
            No Fairway pools on devnet yet. <Link href="/launch" className="text-accent">Create the first token</Link>.
          </Dashed>
        ) : shown.length ? (
          <GradedTable rows={shown} extraLabel="Price" caption="Tokens trading in Fairway pools on devnet" />
        ) : (
          <Dashed>No tokens with this grade.</Dashed>
        )
      ) : pump && pumpRows.length ? (
        shown.length ? (
          <GradedTable rows={shown} extraLabel="Dumped" caption="Real launches on Solana mainnet with their Fairway Check grade" />
        ) : (
          <Dashed>No launches match these filters in the current data.</Dashed>
        )
      ) : (
        <Dashed>
          <p className="font-semibold text-ink">No real launch data connected yet.</p>
          <p className="mt-1">
            This tab shows real mainnet launches from the ingest service, fed by the QuickNode Stream. Start the Stream and the ingest service in live mode (see <span className="font-mono">docs/SETUP_REMAINING.md</span>) and set{' '}
            <span className="font-mono">INGEST_URL</span>, or export a snapshot with <span className="font-mono">pnpm snapshot:real</span>. We never fill this tab with simulated launches.
          </p>
        </Dashed>
      )}
      <p className="mt-3 font-mono text-[11px] text-ink-2">
        {tab === 'pump'
          ? 'Real mainnet launches from Pump.fun, LetsBonk and the Meteora bonding curve (Bags, Believe, Jupiter), never simulated ones.'
          : 'Tokens trading in Fairway pools on Solana devnet. Test tokens, no real value.'}
      </p>
    </div>
  );
}
