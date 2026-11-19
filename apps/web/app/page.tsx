import Link from 'next/link';
import { ArrowRight, Radio, Gauge, ShieldCheck, Repeat } from 'lucide-react';
import { simOutputs } from '@/lib/server/data';
import { signed, usd } from '@/lib/format';
import { Card, TierBadge } from '@/components/ui';
import { FrontierPanel } from '@/components/frontier-panel';

export default function Home() {
  const { backtest, sweep, lpfirst, launch } = simOutputs();
  const rec = lpfirst.cells.find((c) => c.id === lpfirst.recommended.id)!;
  const opt = lpfirst.recommended.protocolOption;
  const after = rec.lpAfterProtocol[opt]!;
  const lfDays = lpfirst.config.hours / 24;
  const flatArb = lpfirst.baseline.flat30.arbProfitUsd / lfDays;
  const h = backtest.headline;
  const L = launch;
  const lr = (id: string) => L.regimes.find((r) => r.id === id)!.metrics;
  const lk = (id: string) => L.keyChart.find((r) => r.id === id)!;
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-medium text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-retail" /> Fairway Launch · Solana · QuickNode Streams · Anchor
          </div>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-6xl">
            Known snipers pay more.
            <br />
            <span className="text-accent">Humans pay less.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2">
            Fair token launches on Solana. <strong className="text-ink">Other launchpads tax everyone who&apos;s early. Fairway taxes snipers.</strong> The launch fee depends on who you are and how early you are: wallets that
            keep buying in the first seconds and dumping on the crowd pay up to 10%. Fresh wallets pay 3%, so switching wallets gains nothing. Wallets with a clean history pay 0.3% from block 0.
          </p>
          <div className="mt-6 grid max-w-xl grid-cols-2 gap-3">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="text-3xl font-semibold tracking-tight text-retail tnum">−{L.paired.humanFeeCutPct.toFixed(0)}%</div>
              <div className="mt-1 text-[13px] leading-snug text-ink-2">Humans pay {L.paired.humanFeeCutPct.toFixed(0)}% less than under a time-decay-only launch fee</div>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="text-3xl font-semibold tracking-tight text-ink tnum">
                {(lr('decay').sniperShareOfWindowSupply.mean * 100).toFixed(0)}% → <span className="text-accent">{(lr('fairway').sniperShareOfWindowSupply.mean * 100).toFixed(0)}%</span>
              </div>
              <div className="mt-1 text-[13px] leading-snug text-ink-2">Sniper share of early supply (launch window), time-decay → Fairway</div>
            </div>
            <p className="col-span-2 text-[12px] leading-relaxed text-muted">
              {L.launches} simulated launches. Snipers pay about the same in total ({L.paired.sniperFeeRatio.toFixed(2)}×) because this is deterrence: known snipers face a 10% fee and mostly skip the launch, which is why their
              share of supply falls. The ones who still buy pay {L.paired.knownSniperFeeRatio.toFixed(2)}× per dollar. Simulated data.
            </p>
          </div>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/launch" className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-ink hover:opacity-90">
              Launch a token <ArrowRight size={16} />
            </Link>
            <Link href="/launch/frog" className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-3 text-sm font-semibold text-ink hover:bg-surface-2">
              Watch a live launch
            </Link>
            <Link href="/backtest" className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-3 text-sm font-semibold text-ink hover:bg-surface-2">
              See the backtest
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ['RETAIL', '30 → 5', 'A clean history: ≥ 5 trades, markout ≤ 3 bps. Low fee from block 0.'],
              ['STANDARD', '300 → 30', 'Unknown or fresh wallets. The same fee other launchpads charge everyone.'],
              ['TOXIC', '1000 → 80', 'Known snipers: they repeatedly buy first and the price moves their way right after.'],
            ] as const
          ).map(([t, fee, who]) => (
            <div key={t} className="flex flex-col rounded-2xl border border-line bg-surface p-4">
              <TierBadge tier={t} />
              <div className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                {fee}
                <span className="ml-1 text-sm font-medium text-muted">bps</span>
              </div>
              <p className="mt-2 text-[12px] leading-snug text-ink-2">{who}</p>
            </div>
          ))}
          <p className="col-span-3 text-[12px] text-muted">Fee by tier, decaying over the launch window (default 5 minutes). After the window, normal pool fees apply.</p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ['Snipers take the launch', 'Bots buy in block 0, before any human can click. Then they sell into the crowd. Retail buys their bags at a markup.'],
          ['Anti-sniper taxes hit humans too', 'Launchpads answer with a high fee that decays over time. It applies to everyone, so a human who buys early pays the same 3% as the bot.'],
          ['Sniper history is public', 'The same wallets snipe launch after launch. QuickNode Streams extracts every early buy on Pump.fun, and markouts show who keeps winning right after buying.'],
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
            <h2 className="text-2xl font-semibold tracking-tight text-ink">What the launch simulation shows</h2>
            <p className="mt-1 max-w-3xl text-[14px] text-ink-2">
              {L.launches} synthetic launches with snipers ({Math.round(L.config.sniper.knownShare * 100)}% already known), bundlers, retail buyers and DCA bots. Fairway (tier × time) is compared with time-decay-only, where everyone
              pays 300→30 bps.
            </p>
          </div>
          <Link href="/backtest" className="text-sm font-semibold text-accent hover:underline">
            Explore the launch backtest →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Headline value={`−${L.paired.humanFeeCutPct.toFixed(0)}%`} label="Launch fee humans pay vs time-decay-only" sub={`${lk('fairway').humanFeeBps.toFixed(0)} vs ${lk('decay').humanFeeBps.toFixed(0)} bps, volume-weighted`} />
          <Headline value={`${(lr('decay').sniperShareOfWindowSupply.mean * 100).toFixed(0)}% → ${(lr('fairway').sniperShareOfWindowSupply.mean * 100).toFixed(0)}%`} label="Sniper + bundler share of early (launch-window) supply, time-decay → Fairway" sub={`${(lr('flat').sniperShareOfWindowSupply.mean * 100).toFixed(0)}% with a flat fee`} />
          <Headline value={`${L.paired.sniperFeeRatio.toFixed(2)}×`} label="Snipers' total fees vs time-decay: about the same, because known snipers stay out (deterrence)" sub={`those who still buy pay ${L.paired.knownSniperFeeRatio.toFixed(2)}× per dollar`} />
          <Headline value={`${(lr('fairway').humanHighFeeShare.mean * 100).toFixed(0)}%`} label="Humans who paid a ≥ 1% fee" sub={`vs ${(lr('decay').humanHighFeeShare.mean * 100).toFixed(0)}% under time-decay-only`} />
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          Honest read: snipers on fresh wallets pay exactly what time-decay charges (the rotation worst case), and humans still pay less. Creators earn less in fees than under time-decay (
          {usd(lr('fairway').creatorFeesUsd.mean)} vs {usd(lr('decay').creatorFeesUsd.mean)} per launch) because humans pay less; what they get is a holder base with fewer snipers. Simulated data.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight text-ink">The engine also works on liquid pairs</h2>
        <p className="mt-1 max-w-3xl text-[14px] text-ink-2">
          The same scoring, onchain markouts and tiered fees run on a SOL/USDC pool, where arbitrage bots are the toxic flow. This is secondary evidence: it shows the engine generalises beyond launches.
        </p>
      </section>

      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-ink">Liquid-pair backtest (SOL/USDC)</h3>
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
          <Headline value={`−${rec.lvrReductionPct.mean.toFixed(0)}%`} label="Arbitrage profit extracted from LPs (LVR proxy) vs flat 30. LP-neutral within noise." sub={`${usd(flatArb)} → ${usd(flatArb * (1 - rec.lvrReductionPct.mean / 100))} per day`} />
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
