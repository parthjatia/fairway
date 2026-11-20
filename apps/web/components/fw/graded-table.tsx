'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { RiskGrade, TokenCheck } from '@fairway/scoring';
import { short } from '@/lib/format';
import { RiskBadge, TokenIcon, VenueBadge } from './badges';

export type GradedRow = {
  key: string;
  href: string;
  symbol: string;
  name: string;
  mint: string;
  check: Pick<TokenCheck, 'grade' | 'earlyBuyers' | 'lowConfidence' | 'sniperSharePct'>;
  age: string;
  extra?: string;
  image?: string | null;
  venue?: string;
};

const BAR: Record<RiskGrade, string> = { Low: 'bg-good', Medium: 'bg-warn', High: 'bg-bad' };
const th = 'border-b border-ink py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-2';
const td = 'border-b border-line py-3';

/** Every token with its Fairway Check grade: who bought early, how much snipers took, and what they did next. */
export function GradedTable({ rows, extraLabel, caption }: { rows: GradedRow[]; extraLabel?: string; caption: string }) {
  const router = useRouter();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={th}>Token</th>
            <th scope="col" className={th}>Launched</th>
            <th scope="col" className={`${th} text-right`}>Early buyers</th>
            <th scope="col" className={`${th} w-[34%] px-4`}>Sniper share</th>
            {extraLabel && <th scope="col" className={`${th} text-right`}>{extraLabel}</th>}
            <th scope="col" className={`${th} text-right`}>Grade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const graded = r.check.earlyBuyers > 0;
            const share = Math.round(r.check.sniperSharePct);
            return (
              <tr key={r.key} onClick={() => router.push(r.href)} className="cursor-pointer hover:bg-surface-2">
                <td className={td}>
                  <Link href={r.href} className="inline-flex min-w-0 items-center gap-2.5 no-underline" onClick={(e) => e.stopPropagation()}>
                    <TokenIcon symbol={r.symbol} image={r.image} size={26} />
                    <span className="min-w-0">
                      <span className="font-semibold text-ink">{r.name !== short(r.mint) ? r.name : r.symbol}</span>{' '}
                      <span className="font-mono text-xs text-ink-2">${r.symbol}</span>
                    </span>
                  </Link>
                  {r.venue && <VenueBadge venue={r.venue} className="ml-2" />}
                </td>
                <td className={`${td} whitespace-nowrap font-mono text-[13px] text-ink-2`}>{r.age}</td>
                <td className={`${td} text-right font-mono text-[13px]`}>{r.check.earlyBuyers}</td>
                <td className={`${td} px-4`}>
                  <div className="flex items-center gap-2.5">
                    <div className="h-1.5 flex-1 bg-line" aria-hidden>
                      {graded && <div className={`fw-bar h-full ${BAR[r.check.grade]}`} style={{ width: `${Math.min(100, share)}%` }} />}
                    </div>
                    <span className="w-9 text-right font-mono text-[13px] font-medium">{graded ? `${share}%` : '—'}</span>
                  </div>
                </td>
                {extraLabel && <td className={`${td} whitespace-nowrap text-right font-mono text-[13px]`}>{r.extra ?? '—'}</td>}
                <td className={`${td} text-right`}>
                  <RiskBadge check={r.check} suffix={false} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
