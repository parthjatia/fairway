import type { ReactNode } from 'react';
import type { Tier } from '@fairway/scoring';

export function Card({ children, className = '', title, subtitle, action }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`min-w-0 border border-line bg-surface p-6 ${className}`}>
      {(title || action) && (
        <header className="-mx-6 -mt-6 mb-6 flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
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
    <div className="border border-line bg-surface p-4">
      <div className="label">{label}</div>
      <div className={`display mt-1.5 text-[36px] leading-none ${tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-ink'}`}>{value}</div>
      {hint && <div className="mt-1.5 text-[13px] text-ink-2">{hint}</div>}
    </div>
  );
}

const TIER_TEXT: Record<Tier, string> = { RETAIL: 'text-retail', STANDARD: 'text-standard', TOXIC: 'text-toxic' };

/** Tier identity is never colour-alone: a square swatch plus the tier name. */
export function TierBadge({ tier, size = 'sm' }: { tier: Tier; size?: 'sm' | 'lg' }) {
  return (
    <span className={`inline-flex items-center gap-[7px] whitespace-nowrap font-mono font-medium uppercase tracking-[0.04em] ${TIER_TEXT[tier]} ${size === 'lg' ? 'text-sm' : 'text-xs'}`}>
      <span aria-hidden className={`swatch ${size === 'lg' ? '!h-2.5 !w-2.5' : ''}`} />
      {tier}
    </span>
  );
}

/** Earned, not claimed: onchain-verified RETAIL-like markout over enough settled trades. Bots can earn it too. */
export function FairFlowBadge({ minTrades, className = '' }: { minTrades: number; className?: string }) {
  return (
    <span
      title={`Verified fair flow: the program measured this wallet's own trades against Pyth and found no informed edge (onchain RETAIL tier) over at least ${minTrades} settled trades. Human or bot, good flow pays less.`}
      className={`inline-flex items-center gap-1.5 border border-retail/50 bg-retail/[0.08] px-1.5 py-px font-mono text-[11px] font-medium uppercase tracking-wider text-retail ${className}`}
    >
      <span aria-hidden>✓</span>
      Verified fair flow
    </span>
  );
}

/** Where the fee tier comes from: trustless onchain markout (settle_markout) or the keeper's bootstrap score. */
export function ScoreSourceBadge({ source }: { source: 'onchain' | 'bootstrap' | 'default' }) {
  const s = {
    onchain: { label: 'Onchain verified', title: 'Tier computed by the program from this wallet’s own Fairway trades, marked out against Pyth. The keeper cannot override it.', cls: 'border-retail/50 text-retail', dot: 'bg-retail' },
    bootstrap: { label: 'Bootstrap score', title: 'Tier written by the keeper from offchain history (QuickNode Streams, all venues). Used until the wallet has enough settled onchain notional.', cls: 'border-line text-ink-2', dot: 'bg-muted' },
    default: { label: 'No score yet', title: 'No history: unknown wallets pay STANDARD.', cls: 'border-line text-muted', dot: 'bg-line' },
  }[source];
  return (
    <span title={s.title} className={`inline-flex items-center gap-1.5 border px-1.5 py-px font-mono text-[11px] font-medium uppercase tracking-wider ${s.cls}`}>
      <span className={`h-1.5 w-1.5 ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

import { TIER_FEE } from '@/lib/fees';
/** fee each tier pays in mock mode: RETAIL = 30 bps minus the (illustrative) bot-tax rebate */
export const TIER_FEE_DEFAULT: Record<Tier, number> = TIER_FEE;

/** Where the numbers come from. Small and quiet: a square and a few words. */
export function DataBadge({ source, className = '' }: { source: 'simulated' | 'live' | 'devnet'; className?: string }) {
  const label = source === 'live' ? 'Real mainnet data via QuickNode Streams' : source === 'devnet' ? 'Devnet' : 'Simulated data';
  const title =
    source === 'live' ? 'Real data: Solana mainnet, delivered by a QuickNode Stream.' : source === 'devnet' ? 'Read from the Fairway program on Solana devnet.' : 'Simulated data: deterministic synthetic fixtures (demo mode).';
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink-2 ${className}`}>
      <span className={`h-1.5 w-1.5 ${source === 'live' ? 'bg-good' : source === 'devnet' ? 'bg-accent' : 'bg-warn'}`} aria-hidden />
      {label}
    </span>
  );
}

export const SimBadge = ({ className = '' }: { className?: string }) => <DataBadge source="simulated" className={className} />;

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** Page title block: a mono eyebrow ("02 · Launch"), a Newsreader headline, and an optional lede. */
export function PageHeader({ eyebrow, title, children, aside, ruled = true }: { eyebrow?: string; title: ReactNode; children?: ReactNode; aside?: ReactNode; ruled?: boolean }) {
  return (
    <div className={`fw-in flex flex-wrap items-end justify-between gap-4 ${ruled ? 'mb-8 border-b border-ink pb-6' : 'mb-6'}`}>
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <div className="label">{eyebrow}</div>}
        <h1 className="mt-2.5 text-balance text-[40px] leading-[1.05] text-ink sm:text-[48px]">{title}</h1>
        {children && <div className="mt-3.5 max-w-[640px] text-base text-ink-2">{children}</div>}
      </div>
      {aside}
    </div>
  );
}

export function Empty({ children, title }: { children?: ReactNode; title?: ReactNode }) {
  return (
    <div className="border border-dashed border-line bg-surface-2 px-5 py-6 text-left text-sm text-ink-2">
      {title && <div className="mb-1 text-sm font-semibold text-ink">{title}</div>}
      {children}
    </div>
  );
}
