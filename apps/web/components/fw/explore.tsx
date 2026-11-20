'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { TokenCheck } from '@fairway/scoring';
import { ago, localNames, useFairwayTokens, type FwToken } from '@/lib/client/fairway';
import { short } from '@/lib/format';
import { DevnetBadge, MainnetBadge, RiskBadge, TokenIcon } from './badges';

type Pump = { via: 'ingest' | 'snapshot'; updatedAt: number; slot: number | null; tokens: (TokenCheck & { name?: string; symbol?: string; image?: string | null })[] } | null;
type Row = { key: string; href: string; symbol: string; name: string; mint: string; check: TokenCheck; age: string; extra?: string; image?: string | null };

const pct = (x: number) => `${Math.round(x)}%`;

function Table({ rows, extraLabel }: { rows: Row[]; extraLabel?: string }) {
  const router = useRouter();
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line label">
          <tr>
            <th className="px-4 py-3 font-semibold">Token</th>
            <th className="px-4 py-3 font-semibold">Risk</th>
            <th className="hidden px-4 py-3 text-right font-semibold sm:table-cell">Sniper share</th>
            <th className="hidden px-4 py-3 text-right font-semibold md:table-cell">Early buyers</th>
            {extraLabel && <th className="hidden px-4 py-3 text-right font-semibold lg:table-cell">{extraLabel}</th>}
            <th className="px-4 py-3 text-right font-semibold">Age</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} onClick={() => router.push(r.href)} className="cursor-pointer border-t border-line first:border-t-0 hover:bg-surface-2">
              <td className="px-4 py-3">
                <Link href={r.href} className="flex min-w-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  <TokenIcon symbol={r.symbol} image={r.image} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{r.symbol}</span>
                    <span className="block truncate text-xs text-ink-2">
                      {r.name !== r.symbol && r.name !== short(r.mint) ? `${r.name} · ` : ''}
                      <span className="font-mono">{short(r.mint)}</span>
                    </span>
                  </span>
                </Link>
              </td>
              <td className="px-4 py-3"><RiskBadge check={r.check} /></td>
              <td className="hidden px-4 py-3 text-right tnum sm:table-cell">{r.check.earlyBuyers ? pct(r.check.sniperSharePct) : '—'}</td>
              <td className="hidden px-4 py-3 text-right tnum md:table-cell">{r.check.earlyBuyers}</td>
              {extraLabel && <td className="hidden px-4 py-3 text-right tnum lg:table-cell">{r.extra}</td>}
              <td className="whitespace-nowrap px-4 py-3 text-right tnum text-ink-2">{r.age}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const fmtPrice = (v: number) => (v >= 1 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v.toPrecision(3));

export function Explore({ pump, initialTab }: { pump: Pump; initialTab: 'fairway' | 'pump' }) {
  const [tab, setTab] = useState(initialTab);
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

  const fwRows: Row[] = (data?.tokens ?? []).map((t: FwToken) => {
    const n = t.name.startsWith('Token ') && names[t.mint] ? names[t.mint]! : { symbol: t.symbol, name: t.name };
    return {
      key: t.mint, href: `/launch/${t.mint}`, mint: t.mint, ...n, check: t.check, age: ago(t.launch?.launchTs ?? t.createdTs, now),
      extra: `${fmtPrice(t.price)} ${t.quoteSymbol}`,
    };
  });
  const pumpRows: Row[] = (pump?.tokens ?? []).map((t) => ({
    key: t.mint, href: `/check/${t.mint}`, mint: t.mint, symbol: t.symbol || t.mint.slice(0, 4), name: t.name || `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`, image: t.image, check: t,
    // the snapshot/ingest knows the launch slot; 400 ms per slot gives the age
    age: pump?.slot && t.launchSlot ? ago(pump.updatedAt - (pump.slot - t.launchSlot) * 0.4, pump.via === 'ingest' ? now : pump.updatedAt) : '—',
  }));

  const tabCls = (on: boolean) => `rounded-[4px] px-3 py-1.5 text-sm font-semibold ${on ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'}`;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="flex gap-1 rounded-md border border-line bg-surface p-1">
          <button role="tab" aria-selected={tab === 'fairway'} onClick={() => choose('fairway')} className={tabCls(tab === 'fairway')}>
            On Fairway
          </button>
          <button role="tab" aria-selected={tab === 'pump'} onClick={() => choose('pump')} className={tabCls(tab === 'pump')}>
            Live on Pump.fun
          </button>
        </div>
        {tab === 'fairway' ? <DevnetBadge /> : pump ? <MainnetBadge updatedAt={pump.updatedAt} /> : null}
      </div>
      {tab === 'fairway' ? (
        error && !data ? (
          <p className="rounded-md border border-dashed border-line p-6 text-sm text-bad">Could not read Fairway pools from devnet: {error}</p>
        ) : !data ? (
          <div className="skeleton h-64 rounded-md" aria-busy />
        ) : fwRows.length === 0 ? (
          <p className="rounded-md border border-dashed border-line p-6 text-sm text-ink-2">No Fairway pools on devnet yet. <Link href="/launch" className="text-accent hover:underline">Create the first token</Link>.</p>
        ) : (
          <Table rows={fwRows} extraLabel="Price" />
        )
      ) : pump && pumpRows.length ? (
        <Table rows={pumpRows} />
      ) : (
        <div className="rounded-md border border-dashed border-line p-6 text-sm text-ink-2">
          <p className="font-semibold text-ink">No real Pump.fun data connected yet.</p>
          <p className="mt-1">
            This tab shows real mainnet launches from the ingest service, fed by the QuickNode Stream. Start the Stream and the ingest service in live mode (see <span className="font-mono">docs/SETUP_REMAINING.md</span>) and set{' '}
            <span className="font-mono">INGEST_URL</span>, or export a snapshot with <span className="font-mono">pnpm snapshot:real</span>. We never fill this tab with simulated launches.
          </p>
        </div>
      )}
    </div>
  );
}
