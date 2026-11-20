import Link from 'next/link';
import { Check, ChevronDown } from 'lucide-react';
import { DEFAULT_CHECK_CONFIG, type CheckBuyer, type RiskGrade, type TokenCheck, type WalletCheck } from '@fairway/scoring';
import { Card, DataBadge, TierBadge } from '../ui';
import { CopyButton } from './client';
import { TokenIcon } from '../fw/badges';
import { short } from '@/lib/format';

const GRADE: Record<RiskGrade, { text: string; bar: string; ring: string }> = {
  Low: { text: 'text-good', bar: 'bg-good', ring: 'border-good/40 bg-good/10' },
  Medium: { text: 'text-warn', bar: 'bg-warn', ring: 'border-warn/40 bg-warn/10' },
  High: { text: 'text-bad', bar: 'bg-bad', ring: 'border-bad/40 bg-bad/10' },
};
const SLOT_SEC = 0.4;
type Src = 'live' | 'simulated' | 'devnet';
const pct = (x: number) => `${Math.round(x)}%`;

export function GradeMark({ grade, className = '' }: { grade: RiskGrade; className?: string }) {
  return (
    <div className={`inline-flex flex-col rounded-md border px-6 py-4 ${GRADE[grade].ring} ${className}`}>
      <span className="label text-ink-2">Risk grade</span>
      <span className={`text-4xl font-semibold tracking-tight ${GRADE[grade].text}`}>{grade}</span>
    </div>
  );
}

export function FairLaunchBadge() {
  return (
    <span
      title={`Fair launch verified: known snipers bought under ${DEFAULT_CHECK_CONFIG.fairLaunchMaxSniperSharePct}% of the early supply, across at least ${DEFAULT_CHECK_CONFIG.fairLaunchMinBuyers} early buyers.`}
      className="inline-flex items-center gap-1.5 rounded-[3px] border border-good/40 bg-good/10 px-3 py-1 text-xs font-semibold text-good"
    >
      <Check size={12} aria-hidden />
      Fair launch verified
    </span>
  );
}

export function Big({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <div className="label">{label}</div>
      <div className="tnum mt-2 text-2xl font-medium tracking-tight text-ink">{value}</div>
      <div className="mt-1 text-sm text-ink-2">{hint}</div>
    </div>
  );
}

/** Share of early supply that went to snipers, with the grade thresholds marked on the track. */
export function SniperMeter({ sharePct, grade }: { sharePct: number; grade: RiskGrade }) {
  const c = DEFAULT_CHECK_CONFIG;
  const w = Math.max(0, Math.min(100, sharePct));
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold text-ink">Sniper share of early supply</h2>
        <span className={`text-sm font-semibold ${GRADE[grade].text}`}>{pct(sharePct)}</span>
      </div>
      <div
        role="meter"
        aria-label="Sniper share of early supply"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(w)}
        aria-valuetext={`${pct(sharePct)} of early supply bought by known snipers`}
        className="relative h-3 overflow-hidden rounded-none bg-surface-2"
      >
        <div className={`h-full rounded-none ${GRADE[grade].bar}`} style={{ width: `${w}%` }} />
        {[c.mediumSniperSharePct, c.highSniperSharePct].map((t) => (
          <span key={t} className="absolute top-0 h-full w-px bg-bg" style={{ left: `${t}%` }} aria-hidden />
        ))}
      </div>
      <div className="relative mt-2 h-4 text-xs text-muted" aria-hidden>
        <span className="absolute -translate-x-1/2" style={{ left: `${c.mediumSniperSharePct}%` }}>
          <span className="hidden sm:inline">Medium </span>
          {c.mediumSniperSharePct}%
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${c.highSniperSharePct}%` }}>
          <span className="hidden sm:inline">High </span>
          {c.highSniperSharePct}%
        </span>
      </div>
      <p className="mt-3 text-sm text-ink-2">
        Known snipers bought {pct(sharePct)} of the tokens sold in the first 60 seconds. Medium from {c.mediumSniperSharePct}%, High from {c.highSniperSharePct}%.
      </p>
    </div>
  );
}

const entry = (b: CheckBuyer) => (b.firstBlock ? 'Block 0' : `+${(b.entrySlots * SLOT_SEC).toFixed(1)} s`);

function BuyersTable({ buyers, self }: { buyers: CheckBuyer[]; self?: string }) {
  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Top early buyers, largest first</caption>
        <thead className="label">
          <tr>
            <th scope="col" className="py-2 pr-4 font-semibold">Wallet</th>
            <th scope="col" className="hidden py-2 pr-4 font-semibold sm:table-cell">Tier</th>
            <th scope="col" className="hidden py-2 pr-4 font-semibold sm:table-cell">Entry</th>
            <th scope="col" className="py-2 pr-4 text-right font-semibold">Supply</th>
            <th scope="col" className="py-2 text-right font-semibold">Sold</th>
          </tr>
        </thead>
        <tbody>
          {buyers.map((b) => (
            <tr key={b.wallet} className={`border-t border-line ${b.wallet === self ? 'bg-surface-2' : ''}`}>
              <td className="py-3 pr-4">
                <Link href={`/check/${b.wallet}`} className="font-mono text-ink hover:text-accent" title={b.wallet}>
                  {short(b.wallet, 4)}
                </Link>
                {b.fresh && <span className="ml-2 text-xs text-muted">new wallet</span>}
                <span className="mt-2 flex flex-wrap items-center gap-2 sm:hidden">
                  <TierBadge tier={b.tier} />
                  <span className="text-xs text-muted">{entry(b)}</span>
                </span>
              </td>
              <td className="hidden py-3 pr-4 sm:table-cell">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <TierBadge tier={b.tier} />
                  {b.bundle && (
                    <span title="Funded by a known bundler shortly before the launch." className="rounded-[3px] border border-[color:var(--s-bundle)] px-2 py-0.5 text-xs font-semibold text-[color:var(--s-bundle)]">
                      bundle
                    </span>
                  )}
                </span>
              </td>
              <td className="hidden py-3 pr-4 text-ink-2 sm:table-cell">{entry(b)}</td>
              <td className="py-3 pr-4 text-right text-ink">{b.sharePct.toFixed(1)}%</td>
              <td className="py-3 text-right">
                {b.sold ? <span className="font-semibold text-ink">{pct(b.soldPct)}</span> : <span className="text-muted">No</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HowComputed({ kind }: { kind: 'token' | 'wallet' }) {
  const c = DEFAULT_CHECK_CONFIG;
  return (
    <details className="group rounded-md border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md p-6 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
        How this is computed
        <ChevronDown size={18} className="shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-4 border-t border-line p-6 text-sm text-ink-2">
        {kind === 'token' ? (
          <ol className="list-decimal space-y-2 pl-5">
            <li>QuickNode Streams delivers every Pump.fun and PumpSwap trade. We keep the buys in the first 60 seconds ({c.earlyWindowSlots} slots) after the token&apos;s launch.</li>
            <li>
              Each wallet is scored across all launches: it counts as a <strong className="font-semibold text-ink">sniper (TOXIC)</strong> if it bought early in at least 3 different launches and the price rose after it bought
              (a shrunk markout of at least 500 bps), or if it was funded by a known bundler.
            </li>
            <li>
              <strong className="font-semibold text-ink">Sniper share</strong> is the tokens bought by snipers divided by all tokens bought in the window.{' '}
              <strong className="font-semibold text-ink">New wallets</strong> are early buyers with no trade on any other token before this launch.{' '}
              <strong className="font-semibold text-ink">Dumped</strong> is the share of the snipers&apos; early bags they have already sold.
            </li>
            <li>
              <strong className="font-semibold text-ink">Grade:</strong> High if snipers hold {c.highSniperSharePct}% or more, or {c.highWithDumpSharePct}% or more with at least {c.highDumpedPct}% already dumped. Medium from {c.mediumSniperSharePct}%. Low below that.
              &quot;Fair launch verified&quot; needs under {c.fairLaunchMaxSniperSharePct}% and at least {c.fairLaunchMinBuyers} early buyers.
            </li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-2 pl-5">
            <li>We follow every early buy (within 10 seconds of a launch) the wallet made on Pump.fun and PumpSwap.</li>
            <li>The <strong className="font-semibold text-ink">markout</strong> of a buy is how far the token&apos;s price moved in the following 30 seconds, in basis points.</li>
            <li>Across launches the markouts are averaged with a prior (5 SOL of neutral volume), so one lucky buy never labels a wallet. TOXIC needs at least 3 launches and a score of at least 500 bps.</li>
          </ol>
        )}
        <p>
          Limits: a score reflects behaviour seen on these two programs only; a sniper can switch to a new wallet (it then looks new, and pays the STANDARD fee on Fairway); a human who happens to buy early in several launches that pump can
          be mislabelled. This is evidence, not a verdict. Details: <Link href="/how-it-works" className="text-accent underline-offset-2 hover:underline">How it works</Link>.
        </p>
      </div>
    </details>
  );
}

function HowComputedDevnet() {
  return (
    <details className="group rounded-md border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md p-6 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
        How this is computed
        <ChevronDown size={18} className="shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-3 border-t border-line p-6 text-sm text-ink-2">
        <p>
          Built from this pool&apos;s <span className="font-mono">SwapExecuted</span> events on Solana devnet: every buy in the first 60 seconds after the launch slot, with the tier the program charged the buyer. Buyers the program
          charged as TOXIC count as snipers; buyers with no score account count as new wallets.
        </p>
        <p>Grades use the same thresholds as Fairway Check on Pump.fun. A pool with few buyers gets a low-confidence grade.</p>
      </div>
    </details>
  );
}

export function MintHeader({ eyebrow, title, mint, source, children, symbol, image }: { eyebrow: string; title: string; mint: string; source: Src; children?: React.ReactNode; symbol?: string; image?: string | null }) {
  return (
    <header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="label">{eyebrow}</span>
        <DataBadge source={source} />
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-3">
        {(image || symbol) && <TokenIcon symbol={symbol ?? title} image={image} size={44} />}
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
          {symbol && symbol !== title && <p className="tnum text-sm text-ink-2">${symbol}</p>}
        </div>
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2">
        <code className="min-w-0 truncate rounded-[4px] bg-surface-2 px-3 py-1.5 font-mono text-sm text-ink-2" title={mint}>
          {mint}
        </code>
        <CopyButton value={mint} />
      </div>
      {children}
    </header>
  );
}

export function TokenReport({ r, name, source, unit = 'SOL', embedded = false, symbol, image }: { r: TokenCheck; name?: string; source: Src; unit?: string; embedded?: boolean; symbol?: string; image?: string | null }) {
  const sec = (slots: number) => Math.round(slots * SLOT_SEC);
  return (
    <div className="space-y-6">
      {!embedded && <MintHeader eyebrow="Fairway Check · Token" title={name ?? `Token ${short(r.mint, 4)}`} mint={r.mint} source={source} symbol={symbol} image={image} />}
      <Card className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <GradeMark grade={r.grade} className="shrink-0" />
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink">{r.verdict}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ink-2">
            {r.fairLaunchVerified && <FairLaunchBadge />}
            <span>
              First {sec(r.earlyWindowSlots)} s after launch, {r.earlyBuyers} early buyer{r.earlyBuyers === 1 ? '' : 's'}.
            </span>
          </div>
          {r.lowConfidence && (
            <p className="mt-3 text-sm text-warn" role="note">
              Only {r.earlyBuyers} early buyer{r.earlyBuyers === 1 ? '' : 's'} were captured, so treat this grade as a weak signal.
            </p>
          )}
        </div>
      </Card>
      <div className="flush grid grid-cols-2 lg:grid-cols-4">
        <Big label="Sniper share" value={pct(r.sniperSharePct)} hint={`${r.sniperCount} known sniper${r.sniperCount === 1 ? '' : 's'}`} />
        <Big label="New wallets" value={pct(r.freshWalletSharePct)} hint="no history before this launch" />
        <Big label="Dumped already" value={r.sniperCount ? pct(r.snipersDumpedPct) : '0%'} hint={r.sniperCount ? `${r.snipersSold} of ${r.sniperCount} snipers have sold` : 'no snipers to dump'} />
        <Big label="Early buyers" value={String(r.earlyBuyers)} hint={`${r.earlyBuyVolumeSol.toFixed(1)} ${unit} in ${sec(r.earlyWindowSlots)} s`} />
      </div>
      <Card>
        <SniperMeter sharePct={r.sniperSharePct} grade={r.grade} />
      </Card>
      <Card title="Top early buyers" subtitle="Largest buyers in the first 60 seconds. Click a wallet to check it.">
        <BuyersTable buyers={r.topBuyers} />
      </Card>
      {source === 'devnet' ? <HowComputedDevnet /> : <HowComputed kind="token" />}
    </div>
  );
}

export function WalletReport({ r, source }: { r: WalletCheck; source: Src }) {
  const mk = r.avgMarkoutBps;
  return (
    <div className="space-y-6">
      <MintHeader eyebrow="Fairway Check · Wallet" title={`Wallet ${short(r.wallet, 4)}`} mint={r.wallet} source={source} />
      <Card className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="shrink-0">
          <TierBadge tier={r.tier} size="lg" />
        </div>
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink">{r.verdict}</p>
          {r.bundle && <p className="mt-2 text-sm text-ink-2">Flagged as funded by a known bundler.</p>}
        </div>
      </Card>
      <div className="flush grid grid-cols-2 lg:grid-cols-4">
        <Big label="Launches" value={String(r.launches)} hint={`${r.earlyLaunches} bought early`} />
        <Big label="First-block buys" value={String(r.firstBlockBuys)} hint="bought in the launch slot" />
        <Big label="Avg markout" value={`${mk > 0 ? '+' : mk < 0 ? '−' : ''}${Math.abs(Math.round(mk))} bps`} hint="30 s after its early buys" />
        <Big label="Score" value={`${Math.round(r.scoreBps)} bps`} hint="shrunk; TOXIC from 500" />
      </div>
      {r.recent.length > 0 && (
        <Card title="Recent trades" subtitle="Click a token to see who else bought it.">
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[420px] text-left text-sm">
              <caption className="sr-only">Recent launch trades by this wallet</caption>
              <thead className="label">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-semibold">Token</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Side</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">After launch</th>
                  <th scope="col" className="py-2 text-right font-semibold">SOL</th>
                </tr>
              </thead>
              <tbody>
                {r.recent.map((t, i) => (
                  <tr key={`${t.mint}-${i}`} className="border-t border-line">
                    <td className="py-3 pr-4">
                      <Link href={`/check/${t.mint}`} className="font-mono text-ink hover:text-accent">
                        {short(t.mint, 4)}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 capitalize text-ink-2">{t.kind}</td>
                    <td className="py-3 pr-4 text-ink-2">{t.slotsAfterLaunch === 0 ? 'Block 0' : `+${(t.slotsAfterLaunch * SLOT_SEC).toFixed(1)} s`}</td>
                    <td className="py-3 text-right text-ink">{t.sol.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <HowComputed kind="wallet" />
    </div>
  );
}
