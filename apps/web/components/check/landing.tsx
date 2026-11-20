import Link from 'next/link';
import { simOutputs } from '@/lib/server/data';
import { pumpTokens, tokenList, type NamedToken } from '@/lib/server/check';
import { ago } from '@/lib/format';
import { DataBadge } from '../ui';
import { MarshalPlate } from '../marshal';
import { GradedTable, type GradedRow } from '../fw/graded-table';
import { CheckSearch } from './client';

const SLOT_SEC = 0.4;

function rowOf(t: NamedToken, age: string, demo: boolean): GradedRow {
  return {
    key: t.mint,
    href: `/check/${t.mint}${demo ? '?demo=1' : ''}`,
    mint: t.mint,
    symbol: t.symbol || t.mint.slice(0, 4),
    name: t.name || `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`,
    image: t.image,
    venue: t.venue,
    check: t,
    age,
    extra: t.earlyBuyers ? `${Math.round(t.snipersDumpedPct)}%` : '—',
  };
}

/** Recent graded launches: real mainnet data (live ingest or snapshot), or the fixtures behind ?demo=1. */
async function recent(demo: boolean, limit: number): Promise<{ rows: GradedRow[]; source: 'live' | 'simulated'; updatedAt: number | null }> {
  if (demo) {
    const r = await tokenList(limit, true);
    const tokens = r.status === 200 && 'tokens' in r.body ? r.body.tokens : [];
    return { rows: tokens.map((t) => rowOf(t, '—', true)), source: 'simulated', updatedAt: null };
  }
  const p = await pumpTokens(limit);
  if (!p) return { rows: [], source: 'live', updatedAt: null };
  const now = p.via === 'ingest' ? Date.now() / 1000 : p.updatedAt;
  const age = (t: NamedToken) => (p.slot && t.launchSlot ? ago(p.updatedAt - (p.slot - t.launchSlot) * SLOT_SEC, now) : '—');
  return { rows: p.tokens.map((t) => rowOf(t, age(t), false)), source: 'live', updatedAt: p.updatedAt };
}

/** Fairway Check, the front door: paste a mint, or open one of the latest graded launches. */
export async function CheckLanding({ demo = false, autoFocus = false }: { demo?: boolean; autoFocus?: boolean }) {
  const { launch: L } = simOutputs();
  const share = (id: string) => Math.round(L.regimes.find((r) => r.id === id)!.metrics.sniperShareOfWindowSupply.mean * 100);
  const { rows, source, updatedAt } = await recent(demo, 6);
  return (
    <div className="-mt-8 sm:-mt-12">
      <section className="fw-in grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] border-b border-line">
        <div className="py-12 pr-0 sm:pr-10">
          <div className="label">Fairway Check</div>
          <h1 className="mt-3.5 text-balance text-[44px] leading-[1.02] tracking-[-0.025em] sm:text-[58px]">Know who you are buying from.</h1>
          <p className="mt-[18px] max-w-[470px] text-base text-ink-2">See who bought a Solana token in its first 60 seconds, how much the snipers hold, and whether they have already sold.</p>
          <div className="mt-7">
            <CheckSearch autoFocus={autoFocus} />
          </div>
        </div>
        <div className="border-line pb-8 sm:border-l sm:pl-10 sm:pt-10">
          <MarshalPlate mood="watch" tag="Buteo fairway">
            Watches the first 60 seconds of every launch and remembers who keeps showing up early.
          </MarshalPlate>
        </div>
      </section>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] border-b border-line">
        <div className="py-6 pr-6">
          <div className="display text-[40px] leading-none text-good">−{L.paired.humanFeeCutPct.toFixed(0)}%</div>
          <div className="mt-2 text-[13px] text-ink-2">fees paid by humans, vs a time-decay launch fee</div>
        </div>
        <div className="border-line py-6 sm:border-l sm:px-6">
          <div className="display text-[40px] leading-none">
            <span className="text-bad">{share('decay')}</span> → <span className="text-accent">{share('fairway')}%</span>
          </div>
          <div className="mt-2 text-[13px] text-ink-2">early supply bought by snipers</div>
        </div>
        <div className="border-line py-6 sm:border-l sm:px-6">
          <div className="display text-[40px] leading-none">
            <span className="text-bad">10%</span> / <span className="text-good">0.3%</span>
          </div>
          <div className="mt-2 text-[13px] text-ink-2">opening fee for a known sniper vs a clean wallet</div>
        </div>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 font-mono text-[11px] text-ink-2">
        <span>Mean of {L.launches} simulated launches.</span>
        <Link href="/backtest" className="no-underline hover:text-ink">
          See the launch backtest →
        </Link>
      </div>

      <section className="pt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="display m-0 text-[28px] leading-tight">Recent launches</h2>
          <Link href={`/explore?tab=pump`} className="font-mono text-xs font-medium uppercase tracking-[0.08em] no-underline">
            All launches →
          </Link>
        </div>
        {rows.length > 0 ? (
          <div className="mt-3">
            <GradedTable rows={rows} extraLabel="Dumped" caption="Recent launches with their Fairway Check grade" />
          </div>
        ) : (
          <p className="mt-3 border border-dashed border-line p-6 text-sm text-ink-2">
            No real launches are indexed yet (the QuickNode Stream feeds them). Paste any mint above: Fairway tokens on devnet work now, or browse them in{' '}
            <Link href="/explore" className="text-accent">
              Explore
            </Link>
            .
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <DataBadge source={source} />
          {updatedAt && source === 'live' && (
            <span className="font-mono text-[11px] text-ink-2">updated {new Date(updatedAt * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC</span>
          )}
        </div>
      </section>
    </div>
  );
}
