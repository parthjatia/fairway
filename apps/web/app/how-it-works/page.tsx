import { Card, PageHeader } from '@/components/ui';

export const metadata = { title: 'How it works — Fairway' };

const STEPS = [
  ['QuickNode Stream', 'Solana · Block dataset'],
  ['Filter (JS)', 'swaps on pool vaults'],
  ['Ingest', 'webhook → SQLite'],
  ['Scoring', 'markout + shrinkage'],
  ['Keeper', 'set_scores_batch'],
  ['Fairway program', 'TraderScore PDA'],
  ['Swap', 'tiered fee'],
];

const CHECK_STEPS = [
  ['Stream L', 'every Pump.fun + PumpSwap trade'],
  ['Early buyers', 'buys in the first 60 s of a token'],
  ['Sniper scores', 'repeat early buyers, bundle flags'],
  ['Token metrics', 'sniper share, new wallets, dumped'],
  ['Risk grade', 'Low / Medium / High at /check'],
];

const LAUNCH_STEPS = [
  ['Stream L', 'Pump.fun + PumpSwap blocks'],
  ['pumpfun-filter.js', 'create / buy / sell per mint'],
  ['Sniper scores', 'early buys across ≥ 3 launches'],
  ['Keeper', 'TOXIC before slot 0'],
  ['configure_launch', 'tier × time fee curve'],
  ['Launch swap', 'known sniper 1000 bps, human 30'],
  ['Pool TWAP', 'scores trades after launch'],
];

const ONCHAIN_STEPS = [
  ['Swap', 'queues {price, slot, side, notional} in the signer’s PDA'],
  ['~75 slots later', 'the 30 s markout horizon passes'],
  ['settle_markout', 'anyone cranks; reads Pyth SOL/USD'],
  ['Program math', 'markout, shrinkage K, tier thresholds'],
  ['TraderScore', 'onchain tier, no oracle signer'],
];

export default function HowItWorks() {
  return (
    <>
      <PageHeader eyebrow="Design" title="How Fairway works">
        Public onchain history tells us who trades on information. Fairway turns that into a fee schedule an AMM can enforce.
      </PageHeader>
      <div className="space-y-6">
        <Card title="Fairway Check" subtitle="The same data, for buyers: before you buy a token, see who bought it in its first minute. No wallet, no signup, no fee.">
          <ol className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-stretch">
            {CHECK_STEPS.map(([t, d], i) => (
              <li key={t} className="flex flex-1 items-stretch gap-2">
                <div className="flex flex-1 flex-col justify-center rounded-xl border border-line bg-surface-2 px-3 py-3 text-center">
                  <div className="text-sm font-semibold text-ink">{t}</div>
                  <div className="text-xs text-ink-2">{d}</div>
                </div>
                {i < CHECK_STEPS.length - 1 && <span className="hidden self-center text-muted lg:block" aria-hidden>→</span>}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-ink-2">
            A token is graded High when known snipers hold 30% or more of its early supply (or 15% with at least half already dumped), Medium from 10%, Low below. Snipers get exposed everywhere on Solana, and taxed on Fairway.
          </p>
        </Card>
        <Card title="Fair launches" subtitle="Known snipers are found in Pump.fun history before a token exists, and pay a steeper launch curve. Fresh wallets pay today's time-decay fee; proven humans pay almost nothing.">
          <ol className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-stretch">
            {LAUNCH_STEPS.map(([t, d], i) => (
              <li key={t} className="flex flex-1 items-stretch gap-2">
                <div className="flex flex-1 flex-col justify-center rounded-xl border border-line bg-surface-2 px-3 py-3 text-center">
                  <div className="text-sm font-semibold text-ink">{t}</div>
                  <div className="text-xs text-ink-2">{d}</div>
                </div>
                {i < LAUNCH_STEPS.length - 1 && <span className="hidden self-center text-muted lg:block" aria-hidden>→</span>}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm leading-relaxed text-ink-2">
            Inside the launch window each tier&apos;s fee decays linearly: TOXIC 1000 → 80 bps, STANDARD 300 → 30 (the same as a time-decay launch), RETAIL 30 → 5. A new token has no oracle, so after launch
            the program marks every trade against the pool&apos;s own 25-slot TWAP, 75 slots later, measured from the post-trade price so a buyer&apos;s own impact never counts as information. Bundles (fresh wallets funded by one source just before the launch) are flagged by the same Stream: they pay at least STANDARD, and TOXIC when the funder is a known
            bundler. Limits: snipers on fresh wallets pay the time-decay fee, and funding through an exchange or extra hops is not linked.
          </p>
        </Card>
        <Card title="Pipeline" subtitle="Each arrow is a component in this repo; the Stream and the keeper's devnet mode are the parts that need your accounts.">
          <ol className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-stretch">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="flex flex-1 items-stretch gap-2">
                <div className="flex flex-1 flex-col justify-center rounded-xl border border-line bg-surface-2 px-3 py-3 text-center">
                  <div className="text-sm font-semibold text-ink">{t}</div>
                  <div className="text-xs text-ink-2">{d}</div>
                </div>
                {i < STEPS.length - 1 && <span className="hidden self-center text-muted lg:block" aria-hidden>→</span>}
              </li>
            ))}
          </ol>
        </Card>
        <Card
          title="Onchain verified scores (no trusted oracle)"
          subtitle="For trades on Fairway itself, the program computes the markout score on its own. The keeper's score is only a bootstrap prior."
        >
          <ol className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-stretch">
            {ONCHAIN_STEPS.map(([t, d], i) => (
              <li key={t} className="flex flex-1 items-stretch gap-2">
                <div className="flex flex-1 flex-col justify-center rounded-xl border border-line bg-surface-2 px-3 py-3 text-center">
                  <div className="text-sm font-semibold text-ink">{t}</div>
                  <div className="text-xs text-ink-2">{d}</div>
                </div>
                {i < ONCHAIN_STEPS.length - 1 && <span className="hidden self-center text-muted lg:block" aria-hidden>→</span>}
              </li>
            ))}
          </ol>
          <div className="mt-4 grid gap-3 text-sm leading-relaxed text-ink-2 sm:grid-cols-2">
            <div className="rounded-xl border border-line p-3">
              <b className="text-ink">Bootstrap score</b> (keeper). Computed offchain from a wallet&apos;s history on every venue (Raydium etc., via QuickNode Streams) and written with set_score. Lets a wallet be scored from day one. Trusted: the score authority can write any tier, limited by the TTL.
            </div>
            <div className="rounded-xl border border-line p-3">
              <b className="text-ink">Onchain verified score</b> (program). Once a wallet has ≥ 1,000 USDC and ≥ 5 trades of settled Fairway flow, its onchain tier is used and keeper writes no longer affect its fee. Inputs are the wallet&apos;s own swaps and Pyth (feed id, staleness and confidence checked). The same formula runs in TypeScript and Rust, checked on shared test vectors.
            </div>
          </div>
        </Card>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Why bots can't game it">
            <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-2">
              <li><strong className="text-ink">Fresh wallets pay STANDARD (30 bps), never less.</strong> Rotating wallets only gets a bot back to the baseline fee. The backtest&apos;s rotation regime quantifies this worst case.</li>
              <li><strong className="text-ink">Faking RETAIL costs money.</strong> A bot needs ≥5 trades over ≥3 days with markout ≤ 3 bps. Trading uninformed is exactly giving up its edge.</li>
              <li><strong className="text-ink">No borrowed scores.</strong> The program derives the TraderScore PDA from the swap signer. Passing another wallet&apos;s account fails the seeds constraint (tested).</li>
              <li><strong className="text-ink">Keeper scores expire.</strong> A TTL in slots means a stale or missing bootstrap score falls back to STANDARD.</li>
              <li><strong className="text-ink">No hiding trades.</strong> Each wallet queues up to 4 unsettled trades. If the queue is full, the trade is not scored and gets no RETAIL discount.</li>
              <li><strong className="text-ink">No writing into someone else&apos;s score.</strong> settle_markout only accepts the PDA seeded by the trader it settles (tested).</li>
            </ul>
          </Card>
          <Card title="Trade-offs we state openly">
            <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-2">
              <li>A retail discount is a transfer from LPs. Fairway pays for it by raising the cost to informed flow, and the sweep shows where that nets out.</li>
              <li>A higher toxic fee widens the no-arbitrage band, so the pool price can be staler. We bound p95 staleness when recommending parameters.</li>
              <li>The keeper is trusted for bootstrap scores (all venues). Onchain verified scores replace that trust with Pyth for Fairway&apos;s own flow. Cross-venue history still needs the keeper; ZK proofs of history are future work.</li>
              <li>Settlement is a permissionless crank with no reward yet. If nobody settles within 450 slots, the trade expires unscored and the wallet stays on its current tier.</li>
              <li>Aggregators: the signer is the end user, so scores follow the wallet through routers.</li>
              <li>Unaudited prototype. Mock mode shows simulated data only.</li>
            </ul>
          </Card>
        </div>
        <Card title="Who earns what" subtitle="Bots pay a premium. Part of it goes back to retail, a small part to the protocol, the rest stays with LPs.">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-2">
            <li><strong className="text-ink">Protocol share: 15% of the toxic premium only</strong> (the toxic fee above what STANDARD would pay; admin-set, max 50%). LPs keep every other fee. It stays in the vault, is excluded from LP reserves, and is claimed into the treasury PDA. A further share of the premium (10% by default) is recycled to RETAIL wallets as the <strong className="text-ink">bot-tax rebate</strong>: permissionless <code>update_retail_fee</code> sets it each epoch from the previous epoch&apos;s premium, hard-capped so the rebate can never exceed the premium collected.</li>
            <li><strong className="text-ink">Sponsored score accounts.</strong> The treasury pays the rent (about 0.0023 SOL) of a wallet&apos;s first score account while it holds SOL. If it is empty, the trader pays.</li>
            <li><strong className="text-ink">Good bots pay less.</strong> The fee follows measured markout, not who signs. Flow with no informed edge earns RETAIL pricing and a &quot;Verified fair flow&quot; badge, human or bot.</li>
            <li><strong className="text-ink">Any DEX can read the scores</strong> with one call (<code>getFeeTier</code> in the SDK). Licensing that is the next revenue line.</li>
            <li>In the simulation the LP result versus a flat 30 bps pool is within noise before the protocol share and slightly negative after it: the benefit is a large cut in what bots extract (LVR) and retail never paying more, not a proven LP gain. See the backtest.</li>
          </ul>
        </Card>
        <Card title="Tiers">
          <div className="grid gap-3 sm:grid-cols-3 text-sm text-ink-2">
            <div className="rounded-xl border border-line p-3"><b className="text-ink">RETAIL · 30 bps − rebate</b><br />score ≤ 3 bps, ≥5 trades, ≥3 days</div>
            <div className="rounded-xl border border-line p-3"><b className="text-ink">STANDARD · 30 bps</b><br />unknown, new, or in-between</div>
            <div className="rounded-xl border border-line p-3"><b className="text-ink">TOXIC · 80 bps</b><br />score ≥ 10 bps, ≥5 trades</div>
          </div>
        </Card>
      </div>
    </>
  );
}
