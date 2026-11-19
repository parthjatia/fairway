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

export default function HowItWorks() {
  return (
    <>
      <PageHeader eyebrow="Design" title="How Fairway works">
        Public onchain history tells us who trades on information. Fairway turns that into a fee schedule an AMM can enforce.
      </PageHeader>
      <div className="space-y-6">
        <Card title="Pipeline" subtitle="Each arrow is a component in this repo; the Stream and the keeper's devnet mode are the parts that need your accounts.">
          <ol className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-center">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="flex flex-1 items-center gap-2">
                <div className="flex-1 rounded-xl border border-line bg-surface-2 px-3 py-3 text-center">
                  <div className="text-[13px] font-semibold text-ink">{t}</div>
                  <div className="text-[11px] text-ink-2">{d}</div>
                </div>
                {i < STEPS.length - 1 && <span className="hidden text-muted lg:block" aria-hidden>→</span>}
              </li>
            ))}
          </ol>
        </Card>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Why bots can't game it">
            <ul className="list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-ink-2">
              <li><strong className="text-ink">Fresh wallets pay STANDARD (30 bps), never less.</strong> Rotating wallets only gets a bot back to the baseline fee. The backtest&apos;s rotation regime quantifies this worst case.</li>
              <li><strong className="text-ink">Faking RETAIL costs money.</strong> A bot needs ≥5 trades over ≥3 days with markout ≤ 3 bps. Trading uninformed is exactly giving up its edge.</li>
              <li><strong className="text-ink">No borrowed scores.</strong> The program derives the TraderScore PDA from the swap signer. Passing another wallet&apos;s account fails the seeds constraint (tested).</li>
              <li><strong className="text-ink">Scores expire.</strong> A TTL in slots means a stale or missing score falls back to STANDARD.</li>
            </ul>
          </Card>
          <Card title="Trade-offs we state openly">
            <ul className="list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-ink-2">
              <li>A retail discount is a transfer from LPs. Fairway pays for it by raising the cost to informed flow, and the sweep shows where that nets out.</li>
              <li>A higher toxic fee widens the no-arbitrage band, so the pool price can be staler. We bound p95 staleness when recommending parameters.</li>
              <li>The score oracle is trusted for writes. Inputs are public and recomputable; TTL limits damage; ZK proofs of history are future work.</li>
              <li>Aggregators: the signer is the end user, so scores follow the wallet through routers.</li>
              <li>Unaudited prototype. Mock mode shows simulated data only.</li>
            </ul>
          </Card>
        </div>
        <Card title="Tiers">
          <div className="grid gap-3 sm:grid-cols-3 text-[13px] text-ink-2">
            <div className="rounded-xl border border-line p-3"><b className="text-ink">RETAIL · 5 bps</b><br />score ≤ 3 bps, ≥5 trades, ≥3 days</div>
            <div className="rounded-xl border border-line p-3"><b className="text-ink">STANDARD · 30 bps</b><br />unknown, new, or in-between</div>
            <div className="rounded-xl border border-line p-3"><b className="text-ink">TOXIC · 80 bps</b><br />score ≥ 10 bps, ≥5 trades</div>
          </div>
        </Card>
      </div>
    </>
  );
}
