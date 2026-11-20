import type { RiskGrade, TokenCheck } from '@fairway/scoring';

const DOT: Record<RiskGrade, string> = { Low: 'bg-good', Medium: 'bg-warn', High: 'bg-bad' };
const TXT: Record<RiskGrade, string> = { Low: 'text-good', Medium: 'text-warn', High: 'text-bad' };
const BORDER: Record<RiskGrade, string> = { Low: 'border-good/40 bg-good/[0.06]', Medium: 'border-warn/40 bg-warn/[0.06]', High: 'border-bad/40 bg-bad/[0.06]' };

const quiet = 'inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] font-medium uppercase tracking-wider text-ink-2';

/** Trading screens run against the devnet program. */
export function DevnetBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`${quiet} ${className}`} title="Trades settle on Solana devnet against the deployed Fairway program. Test tokens, no real value.">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
      Devnet
    </span>
  );
}

/** Pump.fun data comes from mainnet through the QuickNode Stream. */
export function MainnetBadge({ updatedAt, className = '' }: { updatedAt: number | null; className?: string }) {
  const t = updatedAt ? new Date(updatedAt * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  return (
    <span className={`${quiet} ${className}`} title="Solana mainnet Pump.fun / PumpSwap trades, delivered by a QuickNode Stream to the Fairway ingest service.">
      <span className="h-1.5 w-1.5 rounded-full bg-good" aria-hidden />
      Real mainnet data via QuickNode Streams · updated <span className="tnum normal-case">{t}</span>
    </span>
  );
}

/** Fairway Check grade in one chip. With no early buys there is nothing to grade, so it says so instead of "Low". */
export function RiskBadge({ check, className = '' }: { check: Pick<TokenCheck, 'grade' | 'earlyBuyers' | 'lowConfidence'>; className?: string }) {
  if (!check.earlyBuyers)
    return (
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border border-line px-1.5 py-px font-mono text-[11px] font-medium uppercase tracking-wider text-muted ${className}`} title="No buys in the first 60 seconds after launch: nothing to grade yet.">
        Not graded
      </span>
    );
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border px-1.5 py-px font-mono text-[11px] font-medium uppercase tracking-wider ${TXT[check.grade]} ${BORDER[check.grade]} ${className}`}
      title={check.lowConfidence ? `${check.grade} risk (few early buyers: low confidence)` : `${check.grade} risk`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[check.grade]}`} aria-hidden />
      {check.grade} risk{check.lowConfidence ? '*' : ''}
    </span>
  );
}

export function TokenIcon({ symbol, size = 32 }: { symbol: string; size?: number }) {
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-medium text-white"
      style={{ width: size, height: size, background: `oklch(0.58 0.12 ${h})` }}
    >
      {symbol.slice(0, 3)}
    </span>
  );
}
