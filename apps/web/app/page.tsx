import Link from 'next/link';
import { simOutputs } from '@/lib/server/data';
import { usd } from '@/lib/format';
import { TierBadge } from '@/components/ui';
import { CheckLanding } from '@/components/check/landing';

export const dynamic = 'force-dynamic';

const h2 = 'display text-[36px] leading-[1.1] text-ink';
const btn = 'inline-flex h-11 items-center gap-2 px-5 text-sm font-medium no-underline';

export default async function Home() {
  const { lpfirst, launch: L } = simOutputs();
  const rec = lpfirst.cells.find((c) => c.id === lpfirst.recommended.id)!;
  const lr = (id: string) => L.regimes.find((r) => r.id === id)!.metrics;
  return (
    <div className="space-y-16">
      <CheckLanding />

      <section className="grid border-y border-line md:grid-cols-3">
        {[
          ['Snipers take the launch', 'Bots buy in block 0, before any human can click. Then they sell into the crowd. Retail buys their bags at a markup.'],
          ['Anti-sniper taxes hit humans too', 'Launchpads answer with a high fee that decays over time. It applies to everyone, so a human who buys early pays the same 3% as the bot.'],
          ['Sniper history is public', 'The same wallets snipe launch after launch. QuickNode Streams extracts every early buy on Pump.fun, and markouts show who keeps winning right after buying.'],
        ].map(([t, d], i) => (
          <div key={t} className={`py-6 md:px-6 md:first:pl-0 ${i ? 'border-t border-line md:border-l md:border-t-0' : ''}`}>
            <div className="font-mono text-[11px] text-ink-2">0{i + 1}</div>
            <h3 className="mt-1 text-base font-semibold text-ink">{t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{d}</p>
          </div>
        ))}
      </section>

      <section>
        <div className="max-w-3xl">
          <span className="label">Fairway Launch</span>
          <h2 className={`mt-2 ${h2}`}>Known snipers pay more. Humans pay less.</h2>
          <p className="mt-4 text-base text-ink-2">
            Other launchpads tax everyone who is early. Fairway taxes snipers: wallets that keep buying in the first seconds and dumping on the crowd pay up to 10%. Fresh wallets pay 3%, so switching wallets gains nothing. Wallets with a
            clean history pay 0.3% from block 0.
          </p>
        </div>
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left">
            <caption className="sr-only">Launch fee by tier</caption>
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2">
                <th scope="col" className="border-b border-ink py-2 font-medium">Tier</th>
                <th scope="col" className="border-b border-ink py-2 font-medium">Who</th>
                <th scope="col" className="border-b border-ink py-2 text-right font-medium">Launch fee, bps</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['RETAIL', '30 → 5', 'A clean history: at least 5 trades, markout at most 3 bps. Low fee from block 0.'],
                  ['STANDARD', '300 → 30', 'Unknown or fresh wallets. The same fee other launchpads charge everyone.'],
                  ['TOXIC', '1000 → 80', 'Known snipers: they repeatedly buy first and the price moves their way right after.'],
                ] as const
              ).map(([t, fee, who]) => (
                <tr key={t}>
                  <td className="border-b border-line py-3.5 pr-4">
                    <TierBadge tier={t} />
                  </td>
                  <td className="border-b border-line py-3.5 pr-4 text-sm text-ink-2">{who}</td>
                  <td className="display border-b border-line py-3.5 text-right text-xl">{fee}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 font-mono text-[11px] text-ink-2">Fee by tier, decaying over the launch window (default 5 minutes). After the window, normal pool fees apply.</p>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/launch" className={`${btn} bg-accent text-accent-ink hover:bg-accent-hover hover:text-accent-ink`}>
            Launch a token →
          </Link>
          <Link href="/launch/frog" className={`${btn} border border-ink text-ink hover:bg-surface-2`}>
            Watch a simulated launch
          </Link>
          <Link href="/backtest" className={`${btn} border border-line text-ink hover:border-ink`}>
            See the backtest
          </Link>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className={h2}>What the launch simulation shows</h2>
            <p className="mt-2 max-w-3xl text-sm text-ink-2">
              {L.launches} synthetic launches with snipers ({Math.round(L.config.sniper.knownShare * 100)}% already known), bundlers, retail buyers and DCA bots. Fairway (tier × time) is compared with time-decay-only, where everyone
              pays 300→30 bps.
            </p>
          </div>
          <Link href="/backtest" className="font-mono text-xs font-medium uppercase tracking-[0.08em] no-underline">
            Launch backtest →
          </Link>
        </div>
        <div className="mt-5 grid border-y border-line sm:grid-cols-2">
          <Headline value={`${L.paired.sniperFeeRatio.toFixed(2)}×`} label="Snipers' total fees vs time-decay: about the same, because known snipers stay out (deterrence)" sub={`those who still buy pay ${L.paired.knownSniperFeeRatio.toFixed(2)}× per dollar`} />
          <Headline
            value={`${(lr('fairway').humanHighFeeShare.mean * 100).toFixed(0)}%`}
            label="Humans who paid a ≥ 1% fee"
            sub={`vs ${(lr('decay').humanHighFeeShare.mean * 100).toFixed(0)}% under time-decay-only`}
            divided
          />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-2">
          Honest read: snipers on fresh wallets pay exactly what time-decay charges (the rotation worst case), and humans still pay less. Creators earn less in fees than under time-decay ({usd(lr('fairway').creatorFeesUsd.mean)} vs{' '}
          {usd(lr('decay').creatorFeesUsd.mean)} per launch) because humans pay less; what they get is a holder base with fewer snipers. Simulated data.
        </p>
      </section>

      <section>
        <div className="max-w-3xl">
          <h2 className={h2}>How it works</h2>
          <p className="mt-2 text-sm text-ink-2">
            The same scoring also runs on a liquid SOL/USDC pool, where arbitrage bots are the toxic flow: in the simulation Fairway cuts what they extract from LPs by {rec.lvrReductionPct.mean.toFixed(0)}% and retail never pays more
            than a normal pool. LPs do not come out ahead of a flat 30 bps pool beyond the noise band, and that is stated on the <Link href="/backtest" className="text-accent">backtest page</Link>. Simulated data.
          </p>
        </div>
        <ol className="mt-6 grid border-t border-ink sm:grid-cols-2">
          {[
            ['QuickNode Streams', 'A Solana block stream with a server-side filter extracts every Pump.fun and PumpSwap trade, and swaps on configured liquid pools. It backfills history and keeps it live.'],
            ['Markout scoring', 'Per-wallet markouts with Bayesian shrinkage give a tier: repeat early buyers whose price rises are TOXIC.'],
            ['Onchain tiers', 'A keeper writes TraderScore PDAs. The Anchor program reads the PDA derived from the swap signer, so nobody can borrow someone else’s score.'],
            ['Tiered swap', 'Constant-product swap with the fee taken on input, by tier and by time since launch. Missing or stale score: STANDARD.'],
          ].map(([t, d], i) => (
            <li key={t} className={`flex gap-4 border-b border-line py-5 ${i % 2 ? 'sm:border-l sm:pl-6' : 'sm:pr-6'}`}>
              <span className="font-mono text-[11px] text-ink-2">0{i + 1}</span>
              <div>
                <div className="text-sm font-semibold text-ink">{t}</div>
                <p className="mt-1 text-sm text-ink-2">{d}</p>
              </div>
            </li>
          ))}
        </ol>
        <Link href="/how-it-works" className="mt-5 inline-block font-mono text-xs font-medium uppercase tracking-[0.08em] no-underline">
          Architecture and anti-gaming argument →
        </Link>
      </section>
    </div>
  );
}

function Headline({ value, label, sub, divided = false }: { value: string; label: string; sub: string; divided?: boolean }) {
  return (
    <div className={`py-6 ${divided ? 'border-t border-line sm:border-l sm:border-t-0 sm:pl-6' : 'sm:pr-6'}`}>
      <div className="display text-[40px] leading-none text-ink">{value}</div>
      <div className="mt-2 text-sm leading-snug text-ink-2">{label}</div>
      <div className="mt-2 font-mono text-xs text-ink-2">{sub}</div>
    </div>
  );
}
