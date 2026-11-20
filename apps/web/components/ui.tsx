import type { ReactNode } from 'react';
import type { Tier } from '@fairway/scoring';

export function Card({ children, className = '', title, subtitle, action }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`min-w-0 rounded-md border border-line bg-surface p-6 ${className}`}>
      {(title || action) && (
        <header className="-mx-6 -mt-6 mb-6 flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] leading-5 text-ink-2">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <div className="label">{label}</div>
      <div className={`tnum mt-2 text-2xl font-medium tracking-tight ${tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-ink'}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-2">{hint}</div>}
    </div>
  );
}

const TIER_STYLE: Record<Tier, string> = {
  RETAIL: 'border-retail/40 bg-retail/[0.06] text-retail',
  STANDARD: 'border-line-strong bg-surface-2 text-standard',
  TOXIC: 'border-toxic/40 bg-toxic/[0.06] text-toxic',
};
const TIER_GLYPH: Record<Tier, string> = { RETAIL: '●', STANDARD: '◆', TOXIC: '▲' };

/** Tier identity is never colour-alone: glyph + label. */
export function TierBadge({ tier, size = 'sm' }: { tier: Tier; size?: 'sm' | 'lg' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border font-mono font-medium uppercase tracking-wider ${TIER_STYLE[tier]} ${size === 'lg' ? 'px-2.5 py-1 text-xs' : 'px-1.5 py-px text-[11px]'}`}>
      <span aria-hidden className="text-[9px]">{TIER_GLYPH[tier]}</span>
      {tier}
    </span>
  );
}

/** Earned, not claimed: onchain-verified RETAIL-like markout over enough settled trades. Bots can earn it too. */
export function FairFlowBadge({ minTrades, className = '' }: { minTrades: number; className?: string }) {
  return (
    <span
      title={`Verified fair flow: the program measured this wallet's own trades against Pyth and found no informed edge (onchain RETAIL tier) over at least ${minTrades} settled trades. Human or bot, good flow pays less.`}
      className={`inline-flex items-center gap-1.5 rounded-[3px] border border-retail/40 bg-retail/[0.06] px-1.5 py-px font-mono text-[11px] font-medium uppercase tracking-wider text-retail ${className}`}
    >
      <span aria-hidden>✓</span>
      Verified fair flow
    </span>
  );
}

/** Where the fee tier comes from: trustless onchain markout (settle_markout) or the keeper's bootstrap score. */
export function ScoreSourceBadge({ source }: { source: 'onchain' | 'bootstrap' | 'default' }) {
  const s = {
    onchain: { label: 'Onchain verified', title: 'Tier computed by the program from this wallet’s own Fairway trades, marked out against Pyth. The keeper cannot override it.', cls: 'border-retail/40 text-retail', dot: 'bg-retail' },
    bootstrap: { label: 'Bootstrap score', title: 'Tier written by the keeper from offchain history (QuickNode Streams, all venues). Used until the wallet has enough settled onchain notional.', cls: 'border-line text-ink-2', dot: 'bg-muted' },
    default: { label: 'No score yet', title: 'No history: unknown wallets pay STANDARD.', cls: 'border-line text-muted', dot: 'bg-line' },
  }[source];
  return (
    <span title={s.title} className={`inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-px font-mono text-[11px] font-medium uppercase tracking-wider ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

import { TIER_FEE } from '@/lib/fees';
/** fee each tier pays in mock mode: RETAIL = 30 bps minus the (illustrative) bot-tax rebate */
export const TIER_FEE_DEFAULT: Record<Tier, number> = TIER_FEE;

/** Where the numbers come from. Small and quiet: a dot and two words. */
export function DataBadge({ source, className = '' }: { source: 'simulated' | 'live' | 'devnet'; className?: string }) {
  const label = source === 'live' ? 'Real mainnet data via QuickNode Streams' : source === 'devnet' ? 'Devnet' : 'Simulated data';
  const title =
    source === 'live' ? 'Real data: Solana mainnet, delivered by a QuickNode Stream.' : source === 'devnet' ? 'Read from the Fairway program on Solana devnet.' : 'Simulated data: deterministic synthetic fixtures (demo mode).';
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] font-medium uppercase tracking-wider text-ink-2 ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${source === 'live' ? 'bg-good' : source === 'devnet' ? 'bg-accent' : 'bg-warn'}`} aria-hidden />
      {label}
    </span>
  );
}

export const SimBadge = ({ className = '' }: { className?: string }) => <DataBadge source="simulated" className={className} />;

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-8 border-b border-line pb-8">
      {eyebrow && <div className="label mb-3">{eyebrow}</div>}
      <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-[32px] sm:leading-[40px]">{title}</h1>
      {children && <div className="mt-3 max-w-3xl text-[15px] leading-6 text-ink-2">{children}</div>}
    </div>
  );
}

export function Empty({ children, title }: { children?: ReactNode; title?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line-strong bg-surface-2 px-5 py-6 text-left text-sm text-ink-2">
      {title && <div className="mb-1 text-sm font-semibold text-ink">{title}</div>}
      {children}
    </div>
  );
}
