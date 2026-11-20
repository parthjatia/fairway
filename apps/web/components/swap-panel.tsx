'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowDownUp, Check, Info, RotateCcw, X } from 'lucide-react';
import { swapQuote, MathError } from '@fairway/sdk/math';
import type { Tier } from '@fairway/scoring';
import { useAppState } from '@/lib/client/state';
import { useWalletView } from '@/lib/client/use-wallet-view';
import { bps, num, short, signed, usd } from '@/lib/format';
import { Card, Empty, FairFlowBadge, ScoreSourceBadge, TierBadge, TIER_FEE_DEFAULT } from './ui';
import { MarkoutBars } from './charts';
import { TwoWallets } from './two-wallets';

const toRaw = (v: number, d: number) => BigInt(Math.floor(v * 10 ** d));
const fromRaw = (v: bigint, d: number) => Number(v) / 10 ** d;

export function SwapPanel() {
  const { persona, pool, applySwap, resetPool, trades, initialPool, pairs, pair, setPairKey } = useAppState();
  const { data: wallet, loading, error } = useWalletView(persona.address);
  const [sellBase, setSellBase] = useState(false);
  const baseSym = pair.baseSymbol;
  const baseDec = pair.baseDecimals;
  const sellToken = sellBase ? baseSym : 'USDC';
  const buyToken = sellBase ? 'USDC' : baseSym;
  const decOf = (tok: string) => (tok === 'USDC' ? 6 : baseDec);
  // display precision: SOL shows 4 dp, a memecoin quoted in millions shows none
  const baseDp = pair.key === 'bonk' ? 0 : 4;
  const dpOf = (tok: string) => (tok === 'USDC' ? 2 : baseDp);
  const [amount, setAmount] = useState('250');
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const tier: Tier = wallet?.tier ?? 'STANDARD';
  const feeBps = TIER_FEE_DEFAULT[tier];
  const price = pool.quote / pool.base;

  const q = useMemo(() => {
    const v = Number(amount);
    if (!amount || !Number.isFinite(v) || v <= 0) return { error: null as string | null, res: null };
    const aToB = sellBase;
    const rin = aToB ? toRaw(pool.base, baseDec) : toRaw(pool.quote, 6);
    const rout = aToB ? toRaw(pool.quote, 6) : toRaw(pool.base, baseDec);
    const amtRaw = toRaw(v, decOf(sellToken));
    try {
      const calc = (fee: number) => swapQuote(amtRaw, rin, rout, fee);
      const mine = calc(feeBps);
      const std = calc(TIER_FEE_DEFAULT.STANDARD);
      const out = fromRaw(mine.amountOut, decOf(buyToken));
      const outStd = fromRaw(std.amountOut, decOf(buyToken));
      const feeTok = fromRaw(mine.fee, decOf(sellToken));
      const feeUsd = sellToken === 'USDC' ? feeTok : feeTok * price;
      const execPrice = sellToken === 'USDC' ? v / out : out / v;
      const impactBps = (Math.abs(execPrice - price) / price) * 10_000 - feeBps;
      const savedUsd = (out - outStd) * (buyToken === 'USDC' ? 1 : price);
      return { error: null, res: { aToB, amtRaw, out, outStd, feeTok, feeUsd, execPrice, impactBps: Math.max(0, impactBps), savedUsd, rawOut: mine.amountOut } };
    } catch (e) {
      const m = e instanceof MathError ? e.message : 'Invalid amount';
      return { error: m === 'InsufficientLiquidity' ? 'Not enough liquidity in the pool' : m === 'InsufficientOutput' ? 'Amount too small' : m, res: null };
    }
  }, [amount, sellBase, sellToken, buyToken, baseDec, pool, feeBps, price]);

  const execute = () => {
    if (!q.res) return;
    const v = Number(amount);
    const next = q.res.aToB ? { base: pool.base + v, quote: pool.quote - q.res.out } : { base: pool.base - q.res.out, quote: pool.quote + v };
    applySwap(next, { persona: persona.name, side: q.res.aToB ? 'sell' : 'buy', amountIn: v, amountOut: q.res.out, feeBps, tier });
    setConfirming(false);
    setDone(`Swapped ${num(v, dpOf(sellToken))} ${sellToken} → ${num(q.res.out, dpOf(buyToken))} ${buyToken} at ${feeBps} bps (${tier}).`);
    setTimeout(() => setDone(null), 4000);
  };

  const mk = (wallet?.trades ?? [])
    .slice(0, 48)
    .reverse()
    .map((t, i) => ({ i, m: t.markouts['30'] ?? 0, label: `${t.venue} ${t.side} $${t.quoteAmount.toFixed(0)}` }));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,440px)_1fr]">
      <div className="space-y-4">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-ink">
              Swap
              <span role="tablist" aria-label="Pair" className="flex rounded-full border border-line bg-surface-2 p-0.5 text-xs font-semibold">
                {pairs.map((p) => (
                  <button
                    key={p.key}
                    role="tab"
                    aria-selected={p.key === pair.key}
                    onClick={() => { setPairKey(p.key); setSellBase(false); setAmount(p.key === 'bonk' ? '100' : '250'); }}
                    className={`rounded-full px-2.5 py-1 ${p.key === pair.key ? 'bg-surface text-ink' : 'text-ink-2 hover:text-ink'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </span>
            </span>
            <span className="text-xs text-muted tnum">1 {baseSym} = {usd(price, pair.key === 'bonk' ? 8 : 2)}</span>
          </div>
          <TokenBox label="You pay" token={sellToken}>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="w-full bg-transparent text-3xl font-semibold tracking-tight text-ink outline-none tnum"
              aria-label="Amount to pay"
            />
          </TokenBox>
          <div className="relative z-10 -my-3 flex justify-center">
            <button
              onClick={() => {
                setSellBase((b) => !b);
                setAmount(q.res ? String(Number(q.res.out.toFixed(dpOf(buyToken)))) : amount);
              }}
              aria-label="Switch direction"
              className="rounded-xl border border-line bg-surface p-2 text-ink-2 hover:text-ink"
            >
              <ArrowDownUp size={16} />
            </button>
          </div>
          <TokenBox label="You receive" token={buyToken}>
            <div className="text-3xl font-semibold tracking-tight text-ink tnum">{q.res ? num(q.res.out, dpOf(buyToken)) : '—'}</div>
          </TokenBox>

          <div className="mt-4 space-y-2 rounded-xl bg-surface-2 p-3 text-sm">
            <Row k="Your tier">{loading ? <span className="text-muted">loading…</span> : <TierBadge tier={tier} />}</Row>
            <Row k="Your fee">
              <span className="font-semibold text-ink tnum">{feeBps} bps</span>
              <span className="ml-2 text-muted">vs standard 30 bps</span>
            </Row>
            {q.res && (
              <>
                <Row k="Fee paid">
                  <span className="tnum">{usd(q.res.feeUsd, 2)}</span>
                </Row>
                <Row k={q.res.savedUsd >= 0 ? 'Saved vs STANDARD' : 'Extra vs STANDARD'}>
                  <span className={`font-semibold tnum ${q.res.savedUsd >= 0 ? 'text-good' : 'text-bad'}`}>{usd(Math.abs(q.res.savedUsd), 2)}</span>
                </Row>
                <Row k="Price impact">
                  <span className="tnum">{bps(q.res.impactBps)}</span>
                </Row>
              </>
            )}
          </div>
          {q.error && <p className="mt-3 text-sm text-bad">{q.error}</p>}
          <button
            disabled={!q.res}
            onClick={() => setConfirming(true)}
            className="mt-4 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {q.res ? `Review swap as ${persona.name}` : 'Enter an amount'}
          </button>
          {done && (
            <p role="status" className="mt-3 flex items-center gap-2 text-sm text-good">
              <Check size={14} /> {done}
            </p>
          )}
        </Card>

        <Card
          title="This session"
          subtitle="Simulated swaps update the mock pool reserves."
          action={
            <button onClick={resetPool} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-ink-2 hover:text-ink">
              <RotateCcw size={12} /> Reset pool
            </button>
          }
        >
          <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-ink-2 tnum">
            <div>
              {baseSym} reserve <span className="font-semibold text-ink">{num(pool.base, pair.key === 'bonk' ? 0 : 2)}</span>
              {pool.base !== initialPool.base && <span className="ml-1 text-muted">({signed(pool.base - initialPool.base, pair.key === 'bonk' ? 0 : 2)})</span>}
            </div>
            <div>
              USDC reserve <span className="font-semibold text-ink">{num(pool.quote, 0)}</span>
            </div>
          </div>
          {trades.length === 0 ? (
            <Empty>No swaps yet. Try the same trade as Retail Rita and as Arb Bot 7 and compare the fees.</Empty>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {trades.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2">
                  <span className="text-ink-2">
                    <span className="font-semibold text-ink">{t.persona}</span> {t.side === 'buy' ? 'bought' : 'sold'} {t.side === 'buy' ? `${num(t.amountOut, baseDp)} ${baseSym}` : `${num(t.amountIn, baseDp)} ${baseSym}`}
                  </span>
                  <span className="flex items-center gap-2">
                    <TierBadge tier={t.tier as Tier} />
                    <span className="tnum text-ink-2">{t.feeBps} bps</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card
          title={
            <span className="flex items-center gap-2">
              Your tier and why <TierBadge tier={tier} size="lg" />
            </span>
          }
          subtitle={
            <>
              {persona.name} · <span className="font-mono">{short(persona.address, 6)}</span>
            </>
          }
          action={
            wallet?.known ? (
              <Link href={`/wallet/${persona.address}`} className="text-sm font-semibold text-accent hover:underline">
                Full score →
              </Link>
            ) : null
          }
        >
          {error && <p className="text-sm text-bad">Couldn&apos;t load the score: {error}</p>}
          {loading && !wallet && <div className="h-40 animate-pulse rounded-xl bg-surface-2" />}
          {wallet && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2"><ScoreSourceBadge source={wallet.scoreSource} />{wallet.onchain.fairFlow && <FairFlowBadge minTrades={wallet.onchain.fairFlowMinTrades} />}</div>
              <p className="text-sm leading-relaxed text-ink-2">{wallet.explanation}</p>
              {wallet.known && wallet.score ? (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Mini k="Markout (30 s)" v={`${signed(wallet.score.scoreBps)} bps`} />
                    <Mini k="Max horizon" v={`${signed(wallet.score.maxScoreBps)} bps`} />
                    <Mini k="Trades" v={String(wallet.score.trades)} />
                    <Mini k="History" v={`${wallet.score.historyDays.toFixed(1)} days`} />
                  </div>
                  <div className="mt-5">
                    <div className="mb-1 flex items-center justify-between text-xs text-muted">
                      <span>30 s markout of the last {mk.length} trades</span>
                      <span className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <i className="inline-block h-2 w-2 rounded-sm bg-[#e34948]" /> price moved your way
                        </span>
                        <span className="flex items-center gap-1">
                          <i className="inline-block h-2 w-2 rounded-sm bg-[#3987e5]" /> against you
                        </span>
                      </span>
                    </div>
                    <MarkoutBars data={mk} />
                  </div>
                </>
              ) : (
                <div className="mt-4 flex gap-3 rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink-2">
                  <Info size={16} className="mt-0.5 shrink-0 text-accent" />
                  <span>
                    No trading history on any watched venue. Fairway charges unknown wallets the STANDARD fee, never less. A bot that spins up a fresh wallet to escape its TOXIC
                    tier lands here, and it would have to <em>lose</em> money for days to earn RETAIL.
                  </span>
                </div>
              )}
            </>
          )}
        </Card>
        <Card title="Same trade, every tier" subtitle={`What ${amount || 0} ${sellToken} gets you right now on ${pair.label}, by tier.`}>
          <TierCompare amount={Number(amount)} sellBase={sellBase} baseSym={baseSym} baseDec={baseDec} baseDp={baseDp} pool={pool} current={tier} />
        </Card>
      </div>

      <div className="lg:col-span-2">
        <TwoWallets amount={Number(amount)} sellBase={sellBase} />
      </div>

      {confirming && q.res && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Confirm swap">
          <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-ink">Confirm swap</h3>
              <button onClick={() => setConfirming(false)} aria-label="Close" className="text-muted hover:text-ink">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <Row k="Pay">
                {amount} {sellToken}
              </Row>
              <Row k="Receive (min)">
                {num(q.res.out, dpOf(buyToken))} {buyToken}
              </Row>
              <Row k="Tier">
                <TierBadge tier={tier} />
              </Row>
              <Row k="Fee">
                {feeBps} bps · {usd(q.res.feeUsd, 2)}
              </Row>
              <Row k="Signer">
                <span className="font-mono">{short(persona.address, 6)}</span>
              </Row>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Onchain this is <code>swap(amount_in, min_amount_out, a_to_b)</code>. The fee tier comes from the PDA <code>[&quot;score&quot;, signer]</code>. Mock mode: no wallet,
              simulated execution.
            </p>
            <button onClick={execute} className="mt-4 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-accent-ink hover:opacity-90">
              Confirm swap
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TokenBox({ label, token, children }: { label: string; token: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <div className="mb-1 text-xs text-muted">{label}</div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <span className="rounded-full border border-line bg-surface px-3 py-1 text-sm font-semibold text-ink">{token}</span>
      </div>
    </div>
  );
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-ink-2">{k}</span>
    <span className="text-right text-ink">{children}</span>
  </div>
);

const Mini = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-xl bg-surface-2 px-3 py-2">
    <div className="text-xs text-muted">{k}</div>
    <div className="text-base font-semibold text-ink tnum">{v}</div>
  </div>
);

function TierCompare({ amount, sellBase, baseSym, baseDec, baseDp, pool, current }: { amount: number; sellBase: boolean; baseSym: string; baseDec: number; baseDp: number; pool: { base: number; quote: number }; current: Tier }) {
  if (!(amount > 0)) return <Empty>Enter an amount to compare.</Empty>;
  const aToB = sellBase;
  const rin = aToB ? toRaw(pool.base, baseDec) : toRaw(pool.quote, 6);
  const rout = aToB ? toRaw(pool.quote, 6) : toRaw(pool.base, baseDec);
  const outDec = aToB ? 6 : baseDec;
  const rows = (['RETAIL', 'STANDARD', 'TOXIC'] as Tier[]).map((t) => {
    try {
      const r = swapQuote(toRaw(amount, aToB ? baseDec : 6), rin, rout, TIER_FEE_DEFAULT[t]);
      return { t, out: fromRaw(r.amountOut, outDec) };
    } catch {
      return { t, out: NaN };
    }
  });
  const std = rows[1]!.out;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="pb-2 font-semibold">Tier</th>
          <th className="pb-2 font-semibold">Fee</th>
          <th className="pb-2 text-right font-semibold">You receive</th>
          <th className="pb-2 text-right font-semibold">vs STANDARD</th>
        </tr>
      </thead>
      <tbody className="tnum">
        {rows.map((r) => (
          <tr key={r.t} className={`border-t border-line ${r.t === current ? 'bg-surface-2' : ''}`}>
            <td className="py-2">
              <TierBadge tier={r.t} />
            </td>
            <td className="py-2 text-ink-2">{TIER_FEE_DEFAULT[r.t]} bps</td>
            <td className="py-2 text-right text-ink">{Number.isFinite(r.out) ? num(r.out, aToB ? 2 : baseDp) : '—'}</td>
            <td className={`py-2 text-right ${r.out - std > 0 ? 'text-good' : r.out - std < 0 ? 'text-bad' : 'text-muted'}`}>
              {Number.isFinite(r.out) ? `${signed(r.out - std, aToB ? 2 : baseDp)} ${aToB ? 'USDC' : baseSym}` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
