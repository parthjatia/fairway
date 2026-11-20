import Link from 'next/link';
import { ArrowRight, Radio, Gauge, ShieldCheck, Repeat } from 'lucide-react';
import { simOutputs } from '@/lib/server/data';
import { usd } from '@/lib/format';
import { TierBadge } from '@/components/ui';
import { CheckSearch } from '@/components/check/client';
import { SampleReport } from '@/components/check/sample';
import { tokenList, type NamedToken } from '@/lib/server/check';

export default async function Home() {
  const { lpfirst, launch } = simOutputs();
  const rec = lpfirst.cells.find((c) => c.id === lpfirst.recommended.id)!;
  const L = launch;
  const lr = (id: string) => L.regimes.find((r) => r.id === id)!.metrics;
  const list = await tokenList(24);
  const listBody = list.status === 200 ? (list.body as { source: 'live' | 'simulated'; tokens: NamedToken[] }) : null;
  const sample = listBody?.tokens.find((t) => t.grade === 'High' && t.earlyBuyers >= 10 && t.snipersDumpedPct >= 50) ?? listBody?.tokens.find((t) => t.grade === 'High') ?? null;
  const sampleSource = listBody?.source ?? 'simulated';
  return (
    <div className="space-y-12">
      <section className="grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <span className="label">Fairway Check · Fairway Launch</span>
          <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-ink">
            Know who you are buying from.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-ink-2">
            Snipers get exposed everywhere, and taxed on Fairway. Paste any Solana token to see who bought it in its first minute, how much of the early supply they hold, and whether they have already sold.
          </p>
          <div className="mt-6 max-w-xl">
            <CheckSearch />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Link href="/swap" className="font-semibold text-accent hover:underline">
              Trade on Fairway (devnet)
            </Link>
            <Link href="/explore" className="font-semibold text-ink-2 hover:text-ink">
              Explore graded tokens
            </Link>
            <Link href="/launch" className="font-semibold text-ink-2 hover:text-ink">
              Launch a token with sniper protection
            </Link>
          </div>
        </div>
        {sample ? <SampleReport t={sample} source={sampleSource} /> : null}
      </section>

      <section className="flush grid md:grid-cols-3">
        {[
          ['Snipers take the launch', 'Bots buy in block 0, before any human can click. Then they sell into the crowd. Retail buys their bags at a markup.'],
          ['Anti-sniper taxes hit humans too', 'Launchpads answer with a high fee that decays over time. It applies to everyone, so a human who buys early pays the same 3% as the bot.'],
          ['Sniper history is public', 'The same wallets snipe launch after launch. QuickNode Streams extracts every early buy on Pump.fun, and markouts show who keeps winning right after buying.'],
        ].map(([t, d], i) => (
          <div key={t} className="rounded-md border border-line bg-surface p-6">
            <div className="text-xs font-semibold text-muted">0{i + 1}</div>
            <h3 className="mt-1 text-base font-semibold text-ink">{t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{d}</p>
          </div>
        ))}
      </section>

      <section className="space-y-8">
        <div className="max-w-3xl">
          <span className="label">Fairway Launch</span>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Known snipers pay more. Humans pay less.</h2>
          <p className="mt-4 text-base text-ink-2">
            Other launchpads tax everyone who is early. Fairway taxes snipers: wallets that keep buying in the first seconds and dumping on the crowd pay up to 10%. Fresh wallets pay 3%, so switching wallets gains nothing. Wallets with a
            clean history pay 0.3% from block 0.
          </p>
        </div>
        <div className="flush grid sm:grid-cols-2">
          <div className="rounded-md border border-line bg-surface p-6">
            <div className="tnum text-4xl font-medium tracking-tight text-good">−{L.paired.humanFeeCutPct.toFixed(0)}%</div>
            <div className="mt-2 text-sm text-ink-2">Humans pay {L.paired.humanFeeCutPct.toFixed(0)}% less than under a time-decay-only launch fee</div>
          </div>
          <div className="rounded-md border border-line bg-surface p-6">
            <div className="tnum text-4xl font-medium tracking-tight text-ink">
              {(lr('decay').sniperShareOfWindowSupply.mean * 100).toFixed(0)}% → <span className="text-accent">{(lr('fairway').sniperShareOfWindowSupply.mean * 100).toFixed(0)}%</span>
            </div>
            <div className="mt-2 text-sm text-ink-2">Sniper share of early supply (launch window), time-decay → Fairway</div>
          </div>
          <p className="px-5 py-3 font-mono text-[11px] leading-4 text-muted sm:col-span-2">
            {L.launches} simulated launches. Snipers pay about the same in total ({L.paired.sniperFeeRatio.toFixed(2)}×) because this is deterrence: known snipers face a 10% fee and mostly skip the launch, which is why their share of
            supply falls. The ones who still buy pay {L.paired.knownSniperFeeRatio.toFixed(2)}× per dollar. Simulated data.
          </p>
        </div>
        <div className="flush grid sm:grid-cols-3">
          {(
            [
              ['RETAIL', '30 → 5', 'A clean history: at least 5 trades, markout at most 3 bps. Low fee from block 0.'],
              ['STANDARD', '300 → 30', 'Unknown or fresh wallets. The same fee other launchpads charge everyone.'],
              ['TOXIC', '1000 → 80', 'Known snipers: they repeatedly buy first and the price moves their way right after.'],
            ] as const
          ).map(([t, fee, who]) => (
            <div key={t} className="flex flex-col rounded-md border border-line bg-surface p-6">
              <div>
                <TierBadge tier={t} />
              </div>
              <div className="mt-4 text-2xl font-semibold tracking-tight text-ink">
                {fee}
                <span className="ml-1 text-sm font-semibold text-muted">bps</span>
              </div>
              <p className="mt-2 text-sm text-ink-2">{who}</p>
            </div>
          ))}
          <p className="px-5 py-3 font-mono text-[11px] leading-4 text-muted sm:col-span-3">Fee by tier, decaying over the launch window (default 5 minutes). After the window, normal pool fees apply.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/launch" className="inline-flex h-11 items-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold text-accent-ink hover:bg-accent-hover">
            Launch a token <ArrowRight size={16} aria-hidden />
          </Link>
          <Link href="/launch/frog" className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-5 text-sm font-semibold text-ink hover:bg-surface-2">
            Watch a launch
          </Link>
          <Link href="/backtest" className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-5 text-sm font-semibold text-ink hover:bg-surface-2">
            See the backtest
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink">What the launch simulation shows</h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-2">
              {L.launches} synthetic launches with snipers ({Math.round(L.config.sniper.knownShare * 100)}% already known), bundlers, retail buyers and DCA bots. Fairway (tier × time) is compared with time-decay-only, where everyone
              pays 300→30 bps.
            </p>
          </div>
          <Link href="/backtest" className="text-sm font-semibold text-accent hover:underline">
            Explore the launch backtest →
          </Link>
        </div>
        <div className="flush grid sm:grid-cols-2">
          <Headline value={`${L.paired.sniperFeeRatio.toFixed(2)}×`} label="Snipers' total fees vs time-decay: about the same, because known snipers stay out (deterrence)" sub={`those who still buy pay ${L.paired.knownSniperFeeRatio.toFixed(2)}× per dollar`} />
          <Headline value={`${(lr('fairway').humanHighFeeShare.mean * 100).toFixed(0)}%`} label="Humans who paid a ≥ 1% fee" sub={`vs ${(lr('decay').humanHighFeeShare.mean * 100).toFixed(0)}% under time-decay-only`} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Honest read: snipers on fresh wallets pay exactly what time-decay charges (the rotation worst case), and humans still pay less. Creators earn less in fees than under time-decay (
          {usd(lr('fairway').creatorFeesUsd.mean)} vs {usd(lr('decay').creatorFeesUsd.mean)} per launch) because humans pay less; what they get is a holder base with fewer snipers. Simulated data.
        </p>
      </section>

      <section className="space-y-6">
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold tracking-tight text-ink">How it works</h2>
          <p className="mt-2 text-sm text-ink-2">
            The same scoring also runs on a liquid SOL/USDC pool, where arbitrage bots are the toxic flow: in the simulation Fairway cuts what they extract from LPs by {rec.lvrReductionPct.mean.toFixed(0)}% and retail never pays more
            than a normal pool. LPs do not come out ahead of a flat 30 bps pool beyond the noise band, and that is stated on the{' '}
            <Link href="/backtest" className="font-semibold text-accent hover:underline">
              backtest page
            </Link>
            . Simulated data.
          </p>
        </div>
        <div className="flush grid sm:grid-cols-2">
          {[
            [Radio, 'QuickNode Streams', 'A Solana block stream with a server-side filter extracts every Pump.fun and PumpSwap trade, and swaps on configured liquid pools. It backfills history and keeps it live.'],
            [Gauge, 'Markout scoring', 'Per-wallet markouts with Bayesian shrinkage give a tier: repeat early buyers whose price rises are TOXIC.'],
            [ShieldCheck, 'Onchain tiers', 'A keeper writes TraderScore PDAs. The Anchor program reads the PDA derived from the swap signer, so nobody can borrow someone else’s score.'],
            [Repeat, 'Tiered swap', 'Constant-product swap with the fee taken on input, by tier and by time since launch. Missing or stale score: STANDARD.'],
          ].map(([Icon, t, d]) => {
            const I = Icon as typeof Radio;
            return (
              <div key={t as string} className="flex gap-4 rounded-md border border-line bg-surface p-6">
                <I className="mt-0.5 shrink-0 text-accent" size={18} aria-hidden />
                <div>
                  <div className="text-sm font-semibold text-ink">{t as string}</div>
                  <p className="mt-1 text-sm text-ink-2">{d as string}</p>
                </div>
              </div>
            );
          })}
        </div>
        <Link href="/how-it-works" className="inline-block text-sm font-semibold text-accent hover:underline">
          Architecture and anti-gaming argument →
        </Link>
      </section>
    </div>
  );
}

function Headline({ value, label, sub }: { value: string; label: string; sub: string }) {
  return (
    <div className="rounded-md border border-line bg-surface p-6">
      <div className="tnum text-3xl font-medium tracking-tight text-ink">{value}</div>
      <div className="mt-2 text-sm leading-snug text-ink-2">{label}</div>
      <div className="mt-2 text-xs text-muted tnum">{sub}</div>
    </div>
  );
}
