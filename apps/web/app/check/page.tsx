import Link from 'next/link';
import { DataBadge } from '@/components/ui';
import { CheckSearch } from '@/components/check/client';
import { short } from '@/lib/format';
import { tokenList, type NamedToken } from '@/lib/server/check';
import type { RiskGrade } from '@fairway/scoring';

export const metadata = { title: 'Check a token' };
export const dynamic = 'force-dynamic';

const DOT: Record<RiskGrade, string> = { Low: 'bg-good', Medium: 'bg-warn', High: 'bg-bad' };

/** One example of each grade, so the three outcomes are one click away. */
function examples(tokens: NamedToken[]): NamedToken[] {
  const out: NamedToken[] = [];
  for (const g of ['High', 'Medium', 'Low'] as RiskGrade[]) {
    const t = tokens.find((x) => x.grade === g && x.earlyBuyers >= 10 && !out.includes(x));
    if (t) out.push(t);
  }
  return out;
}

export default async function CheckIndex({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const demo = (await searchParams).demo === '1';
  const r = await tokenList(24, demo);
  const ok = r.status === 200 && 'tokens' in r.body;
  const source = ok ? (r.body as { source: 'live' | 'simulated' }).source : 'live';
  const ex = ok ? examples((r.body as { tokens: NamedToken[] }).tokens) : [];
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center py-8 text-center sm:py-16">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Fairway Check</span>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Know who you are buying from</h1>
      <p className="mt-4 text-base text-ink-2">See who bought a Solana token in its first minute, how much of the early supply went to snipers, and whether they have already sold.</p>
      <div className="mt-8 w-full text-left">
        <CheckSearch autoFocus />
      </div>
      <div className="mt-6 w-full text-left">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Try an example</h2>
          <DataBadge source={source} />
        </div>
        {ex.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-3">
            {ex.map((t) => (
              <li key={t.mint}>
                <Link href={`/check/${t.mint}${demo ? '?demo=1' : ''}`} className="block rounded-xl border border-line bg-surface p-4 hover:border-ink-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <span className={`h-2 w-2 rounded-full ${DOT[t.grade]}`} aria-hidden />
                    {t.grade} risk
                  </span>
                  <span className="mt-2 block text-sm text-ink">{t.name ?? 'Recent launch'}</span>
                  <span className="mt-1 block font-mono text-xs text-muted">{short(t.mint, 4)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line p-6 text-sm text-ink-2">
            <>No real Pump.fun launches are indexed yet (the QuickNode Stream feeds them). Paste any mint above: Fairway tokens on devnet work now, or browse them in <Link href="/explore" className="text-accent hover:underline">Explore</Link>.</>
          </p>
        )}
      </div>
    </div>
  );
}
