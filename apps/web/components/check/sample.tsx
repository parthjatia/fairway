import Link from 'next/link';
import type { TokenCheck } from '@fairway/scoring';
import { DataBadge } from '../ui';
import { GradeMark, SniperMeter } from './report';
import { short } from '@/lib/format';

/** A real report, in small: the landing page's proof that the product works. */
export function SampleReport({ t, source }: { t: TokenCheck & { name?: string }; source: 'live' | 'simulated' }) {
  return (
    <Link href={`/check/${t.mint}`} className="block rounded-xl border border-line bg-surface p-6 hover:border-ink-2" aria-label={`Open the report for ${t.name ?? short(t.mint, 4)}`}>
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Sample report</span>
        <DataBadge source={source} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold text-ink">{t.name ?? `Token ${short(t.mint, 4)}`}</div>
          <div className="font-mono text-xs text-muted">{short(t.mint, 6)}</div>
        </div>
        <GradeMark grade={t.grade} className="shrink-0 !px-4 !py-3" />
      </div>
      <p className="mt-4 text-sm text-ink">{t.verdict}</p>
      <div className="mt-6">
        <SniperMeter sharePct={t.sniperSharePct} grade={t.grade} />
      </div>
      <span className="mt-4 inline-block text-sm font-semibold text-accent">Open the full report →</span>
    </Link>
  );
}
