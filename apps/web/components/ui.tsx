import type { ReactNode } from 'react';
import type { Tier } from '@fairway/scoring';

export function Card({ children, className = '', title, subtitle, action }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface p-6 ${className}`}>
      {(title || action) && (
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
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
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight ${tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-ink'}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-2">{hint}</div>}
    </div>
  );
}

const TIER_STYLE: Record<Tier, string> = {
  RETAIL: 'bg-retail/15 text-retail ring-retail/40',
  STANDARD: 'bg-standard/15 text-standard ring-standard/40',
  TOXIC: 'bg-toxic/15 text-toxic ring-toxic/40',
};
const TIER_GLYPH: Record<Tier, string> = { RETAIL: '●', STANDARD: '◆', TOXIC: '▲' };

/** Tier identity is never colour-alone: glyph + label. */
export function TierBadge({ tier, size = 'sm' }: { tier: Tier; size?: 'sm' | 'lg' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset ${TIER_STYLE[tier]} ${size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'}`}>
      <span aria-hidden>{TIER_GLYPH[tier]}</span>
      {tier}
    </span>
  );
}

/** Earned, not claimed: onchain-verified RETAIL-like markout over enough settled trades. Bots can earn it too. */
export function FairFlowBadge({ minTrades, className = '' }: { minTrades: number; className?: string }) {
  return (
    <span
      title={`Verified fair flow: the program measured this wallet's own trades against Pyth and found no informed edge (onchain RETAIL tier) over at least ${minTrades} settled trades. Human or bot, good flow pays less.`}
      className={`inline-flex items-center gap-1.5 rounded-full border border-retail/50 bg-retail/10 px-2.5 py-0.5 text-xs font-semibold text-retail ${className}`}
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
    <span title={s.title} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

import { TIER_FEE } from '@/lib/fees';
/** fee each tier pays in mock mode: RETAIL = 30 bps minus the (illustrative) bot-tax rebate */
export const TIER_FEE_DEFAULT: Record<Tier, number> = TIER_FEE;

/** Where the numbers come from. Small and quiet: a dot and two words. */
export function DataBadge({ source, className = '' }: { source: 'simulated' | 'live'; className?: string }) {
  const live = source === 'live';
  return (
    <span
      title={live ? 'Live data: filled by a QuickNode Stream from Solana mainnet.' : 'Simulated data: deterministic synthetic fixtures and simulator output. See README, "Simulated vs. live".'}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-ink-2 ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-good' : 'bg-warn'}`} aria-hidden />
      {live ? 'Live data' : 'Simulated data'}
    </span>
  );
}

export const SimBadge = ({ className = '' }: { className?: string }) => <DataBadge source="simulated" className={className} />;

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-8">
      {eyebrow && <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent">{eyebrow}</div>}
      <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
      {children && <div className="mt-4 max-w-3xl text-base text-ink-2">{children}</div>}
    </div>
  );
}

export function Empty({ children, title }: { children?: ReactNode; title?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-8 text-center text-sm text-ink-2">
      {title && <div className="mb-1 text-base font-semibold text-ink">{title}</div>}
      {children}
    </div>
  );
}
