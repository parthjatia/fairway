import Link from 'next/link';
import { ArrowRight, Radio, Gauge, ShieldCheck, Repeat } from 'lucide-react';
import { simOutputs } from '@/lib/server/data';
import { bps, usd } from '@/lib/format';
import { Card, TierBadge } from '@/components/ui';
import { FrontierPanel } from '@/components/frontier-panel';

export default function Home() {
  const { backtest, sweep } = simOutputs();
  const h = backtest.headline;
  const days = backtest.config.hours / 24;
  const m = Object.fromEntries(backtest.regimes.map((r) => [r.regime, r.mean]));
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-medium text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-retail" /> Solana AMM · QuickNode Streams · Anchor
          </div>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-6xl">
            Bots pay more.
            <br />
            <span className="text-accent">Humans pay less.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2">
            Fairway prices every swap by the trader&apos;s measured toxicity. Wallets whose trades are consistently followed by the price moving their way pay more. Wallets with a proven
            uninformed history pay less. A brand-new wallet always pays the standard fee, so bots gain nothing by rotating wallets.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/swap" className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-ink hover:opacity-90">
              Try a swap <ArrowRight size={16} />
            </Link>
            <Link href="/backtest" className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-3 text-sm font-semibold text-ink hover:bg-surface-2">
              See the backtest
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ['RETAIL', 5, 'Proven uninformed flow: ≥5 trades, ≥3 days, markout ≤ 3 bps.'],
              ['STANDARD', 30, 'Unknown or new wallets. The floor for anyone without retail history.'],
              ['TOXIC', 80, 'Proven informed flow: markout ≥ 10 bps at any horizon.'],
            ] as const
          ).map(([t, fee, who]) => (
            <div key={t} className="flex flex-col rounded-2xl border border-line bg-surface p-4">
              <TierBadge tier={t} />
              <div className="mt-4 text-4xl font-semibold tracking-tight text-ink">
                {fee}
                <span className="ml-1 text-base font-medium text-muted">bps</span>
              </div>
              <p className="mt-2 text-[12px] leading-snug text-ink-2">{who}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ['LPs bleed to arbitrage', 'When the price moves on a CEX, bots trade against the stale pool price first. This loss-versus-rebalancing (LVR) comes out of LP pockets.'],
          ['Everyone pays one fee', 'A flat fee has to cover that loss, so a retail swap pays the same price as a bot that just picked off the pool.'],
          ['The history is public', 'Onchain markouts show who is informed. Positive markout means the price moved the trader’s way right after the trade. That is measurable for every wallet.'],
        ].map(([t, d], i) => (
          <div key={t} className="rounded-2xl border border-line bg-surface p-5">
            <div className="text-[12px] font-semibold text-muted">0{i + 1}</div>
            <h3 className="mt-1 text-[15px] font-semibold text-ink">{t}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{d}</p>
          </div>
        ))}
      </section>

      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink">What the backtest shows</h2>
            <p className="mt-1 max-w-3xl text-[14px] text-ink-2">
              Agent-based simulation of a ${(h.tvlUsd / 1e6).toFixed(0)}M SOL-USDC pool: {backtest.seeds.length} seeds × {backtest.config.hours} h, 60% volatility with jumps,
              retail flow plus arbitrageurs and snipers. Fairway at 5 / 30 / 80 bps. Per day, mean across seeds.
            </p>
          </div>
          <Link href="/backtest" className="text-sm font-semibold text-accent hover:underline">
            Explore all parameters →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Headline value={`−${h.retailCostSavedBps.toFixed(1)} bps`} label="Retail execution cost vs a flat 30 bps pool" sub={`${bps(m.flat30!.retailCostBps)} → ${bps(m.fairway!.retailCostBps)}`} />
          <Headline value={`+${usd(h.lpPnlVsFlat5UsdPerDay)}`} label="LPs keep per day vs a flat 5 bps pool (same retail price)" sub={`± ${usd(h.lpPnlVsFlat5StderrUsd)} (paired s.e.)`} />
          <Headline value={`−${h.arbProfitReductionPct.toFixed(0)}%`} label="Arbitrage profit extracted from LPs (LVR proxy) vs flat 30" sub={`${usd(m.flat30!.arbProfitUsd / days)} → ${usd(m.fairway!.arbProfitUsd / days)} per day`} />
          <Headline value={`−${h.rotationRetailCostSavedBps.toFixed(1)} bps`} label="Retail still saves in the worst case: every bot rotates wallets" sub="Bots then pay STANDARD (30), never less" />
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          Honest trade-off: compared with a flat 30 bps pool, LPs earn {usd(-h.lpPnlVsFlat30UsdPerDay)}/day less here, because the retail discount is a transfer from LPs to retail. The point is
          that a flat fee can&apos;t give retail 5 bps without exposing LPs to flat-5 levels of LVR. Fairway can. Tune the trade-off on the backtest page.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card title="The trade-off a flat fee cannot escape" subtitle="Each dot is one fee setting. Up = LPs keep more. Left = retail pays less.">
          <FrontierPanel sweep={sweep} />
        </Card>
        <div className="space-y-3">
          {[
            [Radio, 'QuickNode Streams', 'A Solana block stream with a server-side filter extracts every swap on Raydium, Orca and Fairway pools. It backfills history and keeps it live.'],
            [Gauge, 'Markout scoring', 'Per-wallet notional-weighted markout at 5/30/60 s with Bayesian shrinkage gives a tier.'],
            [ShieldCheck, 'Onchain tiers', 'A keeper writes TraderScore PDAs. The Anchor program reads the PDA derived from the swap signer, so nobody can borrow someone else’s score.'],
            [Repeat, 'Tiered swap', 'Constant-product swap with the fee taken on input: 5 / 30 / 80 bps. Missing or stale score → STANDARD.'],
          ].map(([Icon, t, d]) => {
            const I = Icon as typeof Radio;
            return (
              <div key={t as string} className="flex gap-3 rounded-2xl border border-line bg-surface p-4">
                <I className="mt-0.5 shrink-0 text-accent" size={18} />
                <div>
                  <div className="text-[14px] font-semibold text-ink">{t as string}</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{d as string}</p>
                </div>
              </div>
            );
          })}
          <Link href="/how-it-works" className="block text-sm font-semibold text-accent hover:underline">
            Architecture and anti-gaming argument →
          </Link>
        </div>
      </section>
    </div>
  );
}

function Headline({ value, label, sub }: { value: string; label: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="text-3xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-2 text-[13px] leading-snug text-ink-2">{label}</div>
      <div className="mt-2 text-[12px] text-muted tnum">{sub}</div>
    </div>
  );
}
