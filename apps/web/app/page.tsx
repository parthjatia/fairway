import Link from 'next/link';
import { ArrowRight, Radio, Gauge, ShieldCheck, Repeat } from 'lucide-react';
import { simOutputs } from '@/lib/server/data';
import { bps, signed, usd } from '@/lib/format';
import { Card, TierBadge } from '@/components/ui';
import { MOCK_RETAIL_REBATE_BPS } from '@/lib/fees';
import { FrontierPanel } from '@/components/frontier-panel';

export default function Home() {
  const { backtest, sweep, lpfirst } = simOutputs();
  const rec = lpfirst.cells.find((c) => c.id === lpfirst.recommended.id)!;
  const opt = lpfirst.recommended.protocolOption;
  const after = rec.lpAfterProtocol[opt]!;
  const lfDays = lpfirst.config.hours / 24;
  const flatArb = lpfirst.baseline.flat30.arbProfitUsd / lfDays;
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
            Fairway is built for liquidity providers first. Retail and new wallets pay a normal 30 bps. Wallets whose trades are consistently followed by the price moving their way pay more, and part of
            that bot tax is rebated to wallets with a proven uninformed history. A brand-new wallet never pays less than 30 bps, so bots gain nothing by rotating wallets.
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
              ['RETAIL', `30 − ${MOCK_RETAIL_REBATE_BPS}`, 'Proven uninformed flow: ≥5 trades, ≥3 days, markout ≤ 3 bps. Pays 30 bps minus the bot-tax rebate (about 2 bps here).'],
              ['STANDARD', 30, 'Unknown or new wallets. The floor for anyone without retail history.'],
              ['TOXIC', 80, 'Proven informed flow: markout ≥ 10 bps at any horizon.'],
            ] as const
          ).map(([t, fee, who]) => (
            <div key={t} className="flex flex-col rounded-2xl border border-line bg-surface p-4">
              <TierBadge tier={t} />
              <div className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
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
          ['Everyone pays one fee', 'A flat fee has to cover that loss, so a retail swap pays the same price as a bot that just picked off the pool. Fairway charges the bot more and gives some of it back to retail.'],
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
              Agent-based simulation of a ${(h.tvlUsd / 1e6).toFixed(0)}M SOL-USDC pool: {lpfirst.seeds.length} paired seeds × {lpfirst.config.hours} h, 60% volatility with jumps, retail flow plus arbitrageurs and
              snipers. Default: retail and standard 30 bps, toxic {rec.fees.TOXIC} bps, {Math.round(rec.rebateShare * 100)}% of the toxic premium rebated to retail. Per day, versus a flat 30 bps pool.
            </p>
          </div>
          <Link href="/backtest" className="text-sm font-semibold text-accent hover:underline">
            Explore all settings →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Headline value={`−${rec.lvrReductionPct.mean.toFixed(0)}%`} label="Arbitrage profit extracted from LPs (LVR proxy) vs flat 30" sub={`${usd(flatArb)} → ${usd(flatArb * (1 - rec.lvrReductionPct.mean / 100))} per day`} />
          <Headline value={`${rec.retailCostBps.vsFlat30Bps.mean <= 0 ? '' : '+'}${signed(rec.retailCostBps.vsFlat30Bps.mean, 1)} bps`} label="Retail cost vs a flat 30 bps pool: never higher, thanks to the bot-tax rebate" sub={`± ${rec.retailCostBps.vsFlat30Bps.stderr.toFixed(1)} bps (s.e.)`} />
          <Headline value={`${rec.lpBeforeProtocol.mean >= 0 ? '+' : '−'}${usd(Math.abs(rec.lpBeforeProtocol.mean))}`} label="LP PnL per day vs flat 30 before the protocol share" sub={`± ${usd(rec.lpBeforeProtocol.stderr)}: within noise, not a proven gain`} />
          <Headline value={`${after.mean >= 0 ? '+' : '−'}${usd(Math.abs(after.mean))}`} label="LP PnL per day vs flat 30 after the protocol keeps 15% of the toxic premium" sub={`± ${usd(after.stderr)}: a small, measurable cost to LPs`} />
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          Honest read: Fairway cuts what bots extract from LPs by about {rec.lvrReductionPct.mean.toFixed(0)}% and retail never pays more than a normal pool, but LPs do not come out ahead of a flat 30 bps pool beyond the
          noise band in this simulation: the fees arbitrageurs used to pay shrink along with their profit. Bots pay {usd(rec.botExtraFeesUsdPerDay)}/day in extra fees; {usd(rec.rebateUsdPerDay)} of it is rebated to
          retail, {usd(rec.protocolUsdPerDay[opt]!)} goes to the protocol and the rest stays with LPs. The previous 5 / 30 / 80 design is kept as the &quot;max retail discount&quot; variant on the backtest page.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card title="The max-retail-discount variant (5 / 30 / 80)" subtitle="Each dot is one fee setting of the previous design. Up = LPs keep more. Left = retail pays less.">
          <FrontierPanel sweep={sweep} />
        </Card>
        <div className="space-y-3">
          {[
            [Radio, 'QuickNode Streams', 'A Solana block stream with a server-side filter extracts every swap on the configured pools (Raydium SOL-USDC today; Orca, Meteora and Fairway by adding their vaults). It backfills history and keeps it live.'],
            [Gauge, 'Markout scoring', 'Per-wallet notional-weighted markout at 5/30/60 s with Bayesian shrinkage gives a tier.'],
            [ShieldCheck, 'Onchain tiers', 'A keeper writes TraderScore PDAs. The Anchor program reads the PDA derived from the swap signer, so nobody can borrow someone else’s score.'],
            [Repeat, 'Tiered swap', 'Constant-product swap with the fee taken on input: 30 bps (retail minus a rebate), 30 standard, 80 toxic. The protocol keeps 15% of the toxic premium only. Missing or stale score → STANDARD.'],
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
