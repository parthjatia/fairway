import Link from 'next/link';
import { Check, ChevronDown } from 'lucide-react';
import { DEFAULT_CHECK_CONFIG, type CheckBuyer, type RiskGrade, type Tier, type TokenCheck, type WalletCheck } from '@fairway/scoring';
import { DataBadge, TierBadge } from '../ui';
import { CopyButton } from './client';
import { TokenIcon, VenueBadge } from '../fw/badges';
import { Marshal, moodFor } from '../marshal';
import { short } from '@/lib/format';

const GRADE: Record<RiskGrade, { text: string; bar: string; box: string }> = {
  Low: { text: 'text-good', bar: 'bg-good', box: 'border-good bg-good/10 text-good' },
  Medium: { text: 'text-warn', bar: 'bg-warn', box: 'border-warn bg-warn/10 text-warn' },
  High: { text: 'text-bad', bar: 'bg-bad', box: 'border-bad bg-bad/10 text-bad' },
};
const TIER_BOX: Record<Tier, string> = { RETAIL: 'border-retail bg-retail/10 text-retail', STANDARD: 'border-standard bg-standard/10 text-standard', TOXIC: 'border-toxic bg-toxic/10 text-toxic' };
const SLOT_SEC = 0.4;
type Src = 'live' | 'simulated' | 'devnet';
const pct = (x: number) => `${Math.round(x)}%`;
const th = 'border-b border-ink py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-2';

/** The grade in a ruled box tinted with its colour, as on the plate. */
export function GradeMark({ grade, className = '' }: { grade: RiskGrade; className?: string }) {
  return (
    <div className={`inline-flex flex-col border px-4 py-2 text-right ${GRADE[grade].box} ${className}`}>
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em]">Risk grade</span>
      <span className="display text-[32px] leading-[1.05]">{grade}</span>
    </div>
  );
}

export function FairLaunchBadge() {
  return (
    <span
      title={`Fair launch verified: known snipers bought under ${DEFAULT_CHECK_CONFIG.fairLaunchMaxSniperSharePct}% of the early supply, across at least ${DEFAULT_CHECK_CONFIG.fairLaunchMinBuyers} early buyers.`}
      className="inline-flex items-center gap-1.5 border border-good px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-good"
    >
      <Check size={12} aria-hidden />
      Fair launch verified
    </span>
  );
}

/** One figure in a stat strip: mono label, Newsreader value, a quiet hint. */
export function Big({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="border-b border-line py-5 pr-5">
      <div className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-2">{label}</div>
      <div className={`display mt-1.5 text-[36px] leading-none ${tone ?? 'text-ink'}`}>{value}</div>
      <div className="mt-1.5 text-[13px] text-ink-2">{hint}</div>
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
        <h2 className="text-sm font-semibold text-ink">Sniper share of early supply</h2>
        <span className={`font-mono text-sm font-medium ${GRADE[grade].text}`}>{pct(sharePct)}</span>
      </div>
      <div
        role="meter"
        aria-label="Sniper share of early supply"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(w)}
        aria-valuetext={`${pct(sharePct)} of early supply bought by known snipers`}
        className="relative h-[22px] bg-line"
      >
        <div className={`fw-bar h-full ${GRADE[grade].bar}`} style={{ width: `${w}%` }} />
        {[c.mediumSniperSharePct, c.highSniperSharePct].map((t) => (
          <span key={t} className="absolute top-0 h-full w-0.5 bg-bg" style={{ left: `${t}%` }} aria-hidden />
        ))}
      </div>
      <p className="mt-2.5 font-mono text-xs text-ink-2">
        Known snipers bought {pct(sharePct)} of the tokens sold in the first 60 seconds. Medium from {c.mediumSniperSharePct}%, High from {c.highSniperSharePct}%.
      </p>
    </div>
  );
}

/** Early supply split three ways: known snipers, wallets with no history, everyone else. */
function SupplyBar({ r }: { r: TokenCheck }) {
  const c = DEFAULT_CHECK_CONFIG;
  const t = Math.max(0, Math.min(100, r.sniperSharePct));
  const s = Math.max(0, Math.min(100 - t, r.freshWalletSharePct));
  const o = Math.max(0, 100 - t - s);
  const parts = [
    { w: t, cls: 'bg-toxic', label: 'Known snipers' },
    { w: s, cls: 'bg-standard', label: 'New wallets' },
    { w: o, cls: 'bg-retail', label: 'Everyone else' },
  ];
  return (
    <div className="border-b border-line py-6">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <h2 className="font-semibold">Early supply, by buyer</h2>
        <span className="text-ink-2">{r.sniperCount ? `${r.snipersSold} of ${r.sniperCount} sniper${r.sniperCount === 1 ? ' has' : 's have'} sold` : 'No known snipers bought early'}</span>
      </div>
      <div
        className="fw-bar mt-3 flex h-[22px] gap-0.5"
        role="img"
        aria-label={`Known snipers ${pct(t)}, new wallets ${pct(s)}, everyone else ${pct(o)} of the early supply`}
      >
        {parts.map((p) => (p.w > 0 ? <div key={p.label} className={p.cls} style={{ width: `${p.w}%` }} /> : null))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5 font-mono text-xs">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5">
            <span className={`h-[9px] w-[9px] ${p.cls}`} aria-hidden />
            {p.label} {pct(p.w)}
          </span>
        ))}
        <span className="text-ink-2">
          Grade: Medium from {c.mediumSniperSharePct}% snipers, High from {c.highSniperSharePct}%
        </span>
      </div>
    </div>
  );
}

const entry = (b: CheckBuyer) => (b.firstBlock ? 'Block 0' : `+${(b.entrySlots * SLOT_SEC).toFixed(1)} s`);

function BuyersTable({ buyers, self }: { buyers: CheckBuyer[]; self?: string }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <caption className="sr-only">Top early buyers, largest first</caption>
        <thead>
          <tr>
            <th scope="col" className={th}>Wallet</th>
            <th scope="col" className={th}>Tier</th>
            <th scope="col" className={th}>Entry</th>
            <th scope="col" className={`${th} text-right`}>Supply</th>
            <th scope="col" className={`${th} text-right`}>Sold</th>
          </tr>
        </thead>
        <tbody className="font-mono text-[13px]">
          {buyers.map((b) => (
            <tr key={b.wallet} className={`hover:bg-surface-2 ${b.wallet === self ? 'bg-surface-2' : ''}`}>
              <td className="border-b border-line py-2.5 pr-4">
                <Link href={`/check/${b.wallet}`} className="text-ink no-underline hover:text-bad" title={b.wallet}>
                  {short(b.wallet, 4)}
                </Link>
                {b.fresh && <span className="ml-2 font-sans text-xs text-ink-2">new wallet</span>}
              </td>
              <td className="border-b border-line py-2.5 pr-4">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <TierBadge tier={b.tier} />
                  {b.bundle && (
                    <span title="Funded by a known bundler shortly before the launch." className="border border-[color:var(--s-bundle)] px-1.5 py-px text-[11px] uppercase text-[color:var(--s-bundle)]">
                      bundle
                    </span>
                  )}
                </span>
              </td>
              <td className="border-b border-line py-2.5 pr-4 text-ink-2">{entry(b)}</td>
              <td className="border-b border-line py-2.5 pr-4 text-right">{b.sharePct.toFixed(1)}%</td>
              <td className={`border-b border-line py-2.5 text-right ${b.sold ? 'text-ink' : 'text-ink-2'}`}>{b.sold ? pct(b.soldPct) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Details({ children }: { children: React.ReactNode }) {
  return (
    <details className="group border-y border-ink">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
        How this is computed
        <ChevronDown size={18} className="shrink-0 text-ink-2 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-4 pb-6 text-sm text-ink-2">{children}</div>
    </details>
  );
}

export function HowComputed({ kind }: { kind: 'token' | 'wallet' }) {
  const c = DEFAULT_CHECK_CONFIG;
  return (
    <Details>
      {kind === 'token' ? (
        <ol className="list-decimal space-y-2 pl-5">
          <li>QuickNode Streams delivers every Pump.fun and PumpSwap trade. We keep the buys in the first 60 seconds ({c.earlyWindowSlots} slots) after the token&apos;s launch.</li>
          <li>
            Each wallet is scored across all launches: it counts as a <strong className="font-semibold text-ink">sniper (TOXIC)</strong> if it bought early in at least 3 different launches and the price rose after it bought (a
            shrunk markout of at least 500 bps), or if it was funded by a known bundler.
          </li>
          <li>
            <strong className="font-semibold text-ink">Sniper share</strong> is the tokens bought by snipers divided by all tokens bought in the window. <strong className="font-semibold text-ink">New wallets</strong> are early buyers
            with no trade on any other token before this launch. <strong className="font-semibold text-ink">Dumped</strong> is the share of the snipers&apos; early bags they have already sold.
          </li>
          <li>
            <strong className="font-semibold text-ink">Grade:</strong> High if snipers hold {c.highSniperSharePct}% or more, or {c.highWithDumpSharePct}% or more with at least {c.highDumpedPct}% already dumped. Medium from{' '}
            {c.mediumSniperSharePct}%. Low below that. &quot;Fair launch verified&quot; needs under {c.fairLaunchMaxSniperSharePct}% and at least {c.fairLaunchMinBuyers} early buyers.
          </li>
        </ol>
      ) : (
        <ol className="list-decimal space-y-2 pl-5">
          <li>We follow every early buy (within 10 seconds of a launch) the wallet made on Pump.fun and PumpSwap.</li>
          <li>
            The <strong className="font-semibold text-ink">markout</strong> of a buy is how far the token&apos;s price moved in the following 30 seconds, in basis points.
          </li>
          <li>Across launches the markouts are averaged with a prior (5 SOL of neutral volume), so one lucky buy never labels a wallet. TOXIC needs at least 3 launches and a score of at least 500 bps.</li>
        </ol>
      )}
      <p>
        Limits: a score reflects behaviour seen on these programs only; a sniper can switch to a new wallet (it then looks new, and pays the STANDARD fee on Fairway); a human who happens to buy early in several launches that pump can be
        mislabelled. This is evidence, not a verdict. Details: <Link href="/how-it-works" className="text-accent">How it works</Link>.
      </p>
    </Details>
  );
}

function HowComputedDevnet() {
  return (
    <Details>
      <p>
        Built from this pool&apos;s <span className="font-mono">SwapExecuted</span> events on Solana devnet: every buy in the first 60 seconds after the launch slot, with the tier the program charged the buyer. Buyers the program
        charged as TOXIC count as snipers; buyers with no score account count as new wallets.
      </p>
      <p>Grades use the same thresholds as Fairway Check on Pump.fun. A pool with few buyers gets a low-confidence grade.</p>
    </Details>
  );
}

/** Report title row: eyebrow with the short address and badges, a Newsreader title, and a ruled grade box on the right. */
export function MintHeader({
  eyebrow, title, mint, source, children, symbol, image, venue, aside,
}: { eyebrow: string; title: string; mint: string; source: Src; children?: React.ReactNode; symbol?: string; image?: string | null; venue?: string; aside?: React.ReactNode }) {
  return (
    <header className="fw-in border-b border-ink pb-5">
      <div className="flex flex-wrap items-end gap-5">
        <div className="mr-auto min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="label">
              {eyebrow} · {short(mint, 4)}
            </span>
            <VenueBadge venue={venue} />
            <DataBadge source={source} />
          </div>
          <div className="mt-2 flex min-w-0 items-center gap-3">
            {image && <TokenIcon symbol={symbol ?? title} image={image} size={40} />}
            <h1 className="min-w-0 truncate text-[36px] leading-none sm:text-[44px]">
              {title}
              {symbol && symbol !== title && <span className="ml-2 text-2xl text-ink-2">${symbol}</span>}
            </h1>
          </div>
          <div className="mt-3 flex min-w-0 items-center gap-2">
            <code className="min-w-0 truncate bg-surface-2 px-3 py-1.5 font-mono text-[13px] text-ink-2" title={mint}>
              {mint}
            </code>
            <CopyButton value={mint} />
          </div>
        </div>
        {aside}
      </div>
      {children}
    </header>
  );
}

/** Marshal's line under the title: the verdict in plain words, with the hawk reacting to the grade. */
function Verdict({ grade, children }: { grade?: RiskGrade; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-line py-4">
      <div className="shrink-0 border border-line bg-sky p-1">
        <Marshal mood={moodFor(grade)} size={56} />
      </div>
      <div className="min-w-0">
        <span className="font-serif text-[15px] italic">Marshal</span>
        <div className="mt-0.5 text-[15px] text-ink">{children}</div>
      </div>
    </div>
  );
}

export function TokenReport({ r, name, source, unit = 'SOL', embedded = false, symbol, image }: { r: TokenCheck & { venue?: string }; name?: string; source: Src; unit?: string; embedded?: boolean; symbol?: string; image?: string | null }) {
  const sec = (slots: number) => Math.round(slots * SLOT_SEC);
  return (
    <div>
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink pb-4">
          <h2 className="display text-[28px] leading-tight">Fairway Check</h2>
          <GradeMark grade={r.grade} />
        </div>
      ) : (
        <MintHeader eyebrow="Report" title={name ?? `Token ${short(r.mint, 4)}`} mint={r.mint} source={source} symbol={symbol} image={image} venue={r.venue} aside={<GradeMark grade={r.grade} />} />
      )}
      <Verdict grade={r.grade}>
        <p>{r.verdict}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
          {r.fairLaunchVerified && <FairLaunchBadge />}
          <span>
            First {sec(r.earlyWindowSlots)} s after launch, {r.earlyBuyers} early buyer{r.earlyBuyers === 1 ? '' : 's'}.
          </span>
        </div>
        {r.lowConfidence && (
          <p className="mt-2 text-[13px] text-warn" role="note">
            Only {r.earlyBuyers} early buyer{r.earlyBuyers === 1 ? '' : 's'} were captured, so treat this grade as a weak signal.
          </p>
        )}
      </Verdict>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))]">
        <Big label="Sniper share" value={pct(r.sniperSharePct)} hint={`${r.sniperCount} known sniper${r.sniperCount === 1 ? '' : 's'}`} tone={GRADE[r.grade].text} />
        <Big label="Dumped already" value={r.sniperCount ? pct(r.snipersDumpedPct) : '0%'} hint={r.sniperCount ? 'of the snipers’ early bags' : 'no snipers to dump'} />
        <Big label="New wallets" value={pct(r.freshWalletSharePct)} hint="no history before launch" />
        <Big label="Early buyers" value={String(r.earlyBuyers)} hint={`${r.earlyBuyVolumeSol.toFixed(1)} ${unit} in ${sec(r.earlyWindowSlots)} s`} />
      </div>
      <SupplyBar r={r} />
      <section className="pb-8 pt-6">
        <h2 className="text-sm font-semibold">Top early buyers</h2>
        <BuyersTable buyers={r.topBuyers} />
        <p className="mt-4 max-w-[720px] text-[13px] text-ink-2">
          A wallet is Toxic when it bought in the first seconds of 3+ launches and the price rose right after. A sniper on a fresh wallet looks Standard, so this is evidence, not a verdict. Click a wallet to check it.
        </p>
      </section>
      {source === 'devnet' ? <HowComputedDevnet /> : <HowComputed kind="token" />}
    </div>
  );
}

export function WalletReport({ r, source }: { r: WalletCheck & { venues?: Record<string, number> }; source: Src }) {
  const mk = r.avgMarkoutBps;
  const tierBox = (
    <div className={`inline-flex flex-col border px-4 py-2 text-right ${TIER_BOX[r.tier]}`}>
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em]">Tier</span>
      <span className="display text-[32px] leading-[1.05]">{r.tier.charAt(0) + r.tier.slice(1).toLowerCase()}</span>
    </div>
  );
  const grade: RiskGrade = r.tier === 'TOXIC' ? 'High' : 'Medium';
  return (
    <div>
      <MintHeader eyebrow="Wallet" title={`Wallet ${short(r.wallet, 4)}`} mint={r.wallet} source={source} aside={tierBox} />
      <Verdict grade={grade}>
        <p>{r.verdict}</p>
        {r.bundle && <p className="mt-1 text-[13px] text-ink-2">Flagged as funded by a known bundler.</p>}
        {r.venues && Object.keys(r.venues).length > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2">
            Rating based on trades from:
            {Object.entries(r.venues).map(([v, n]) => (
              <span key={v} className="inline-flex items-center gap-1">
                <VenueBadge venue={v} />
                <span className="font-mono text-xs">{n}</span>
              </span>
            ))}
          </p>
        )}
      </Verdict>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))]">
        <Big label="Launches" value={String(r.launches)} hint={`${r.earlyLaunches} bought early`} />
        <Big label="First-block buys" value={String(r.firstBlockBuys)} hint="bought in the launch slot" />
        <Big label="Avg markout" value={`${mk > 0 ? '+' : mk < 0 ? '−' : ''}${Math.abs(Math.round(mk))} bps`} hint="30 s after its early buys" />
        <Big label="Score" value={`${Math.round(r.scoreBps)} bps`} hint="shrunk; TOXIC from 500" />
      </div>
      {r.recent.length > 0 && (
        <section className="pb-8 pt-6">
          <h2 className="text-sm font-semibold">Recent trades</h2>
          <p className="text-[13px] text-ink-2">Click a token to see who else bought it.</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left">
              <caption className="sr-only">Recent launch trades by this wallet</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>Token</th>
                  <th scope="col" className={th}>Side</th>
                  <th scope="col" className={th}>After launch</th>
                  <th scope="col" className={`${th} text-right`}>SOL</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px]">
                {r.recent.map((t, i) => (
                  <tr key={`${t.mint}-${i}`} className="hover:bg-surface-2">
                    <td className="border-b border-line py-2.5 pr-4">
                      <Link href={`/check/${t.mint}`} className="text-ink no-underline hover:text-bad">
                        {short(t.mint, 4)}
                      </Link>
                    </td>
                    <td className="border-b border-line py-2.5 pr-4 capitalize text-ink-2">{t.kind}</td>
                    <td className="border-b border-line py-2.5 pr-4 text-ink-2">{t.slotsAfterLaunch === 0 ? 'Block 0' : `+${(t.slotsAfterLaunch * SLOT_SEC).toFixed(1)} s`}</td>
                    <td className="border-b border-line py-2.5 text-right">{t.sol.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <HowComputed kind="wallet" />
    </div>
  );
}
