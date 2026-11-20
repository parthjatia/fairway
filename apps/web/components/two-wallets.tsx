'use client';
import { swapQuote } from '@fairway/sdk/math';
import type { Tier } from '@fairway/scoring';
import { useAppState } from '@/lib/client/state';
import { useWalletView } from '@/lib/client/use-wallet-view';
import { num, usd } from '@/lib/format';
import { Card, Empty, ScoreSourceBadge, TierBadge, TIER_FEE_DEFAULT } from './ui';

const toRaw = (v: number, d: number) => BigInt(Math.floor(v * 10 ** d));
const fromRaw = (v: bigint, d: number) => Number(v) / 10 ** d;

type Props = { amount: number; sellBase: boolean };

/** "Same trade, two wallets": the identical swap quoted for Retail Rita and Arb Bot 7, with the fee in dollars. */
export function TwoWallets({ amount, sellBase }: Props) {
  const { personas, pool, pair } = useAppState();
  const rita = personas.find((p) => p.key === 'rita');
  const bot = personas.find((p) => p.key === 'arb7');
  const a = useWalletView(rita?.address ?? null);
  const b = useWalletView(bot?.address ?? null);
  const price = pool.quote / pool.base;
  const baseDec = pair.baseDecimals;
  const sellSym = sellBase ? pair.baseSymbol : 'USDC';
  const buySym = sellBase ? 'USDC' : pair.baseSymbol;
  const buyDp = sellBase ? 2 : pair.key === 'bonk' ? 0 : 4;

  function quote(tier: Tier | undefined) {
    if (!tier || !(amount > 0)) return null;
    try {
      const rin = sellBase ? toRaw(pool.base, baseDec) : toRaw(pool.quote, 6);
      const rout = sellBase ? toRaw(pool.quote, 6) : toRaw(pool.base, baseDec);
      const r = swapQuote(toRaw(amount, sellBase ? baseDec : 6), rin, rout, TIER_FEE_DEFAULT[tier]);
      const feeTok = fromRaw(r.fee, sellBase ? baseDec : 6);
      return { out: fromRaw(r.amountOut, sellBase ? 6 : baseDec), feeUsd: sellBase ? feeTok * price : feeTok, feeBps: TIER_FEE_DEFAULT[tier] };
    } catch {
      return null;
    }
  }
  const qa = quote(a.data?.tier);
  const qb = quote(b.data?.tier);
  const tradeUsd = sellBase ? amount * price : amount;

  const cols = [
    { name: rita?.name ?? 'Retail Rita', data: a.data, q: qa, loading: a.loading },
    { name: bot?.name ?? 'Arb Bot 7', data: b.data, q: qb, loading: b.loading },
  ];
  return (
    <Card title="Same trade, two wallets" subtitle={`${num(amount || 0, sellBase ? (pair.key === 'bonk' ? 0 : 4) : 2)} ${sellSym} → ${buySym} on ${pair.label}, quoted for each wallet's tier right now.`}>
      {!(amount > 0) || !qa || !qb ? (
        <Empty>Enter an amount to compare the two wallets.</Empty>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {cols.map((c) => (
              <div key={c.name} className="rounded-md border border-line bg-surface-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{c.name}</span>
                  {c.data ? <TierBadge tier={c.data.tier} /> : <span className="text-xs text-muted">{c.loading ? 'loading…' : '—'}</span>}
                </div>
                {c.data && <div className="mt-1"><ScoreSourceBadge source={c.data.scoreSource} /></div>}
                <div className="mt-3 text-xs text-muted">Fee on this trade</div>
                <div className="text-3xl font-semibold tracking-tight text-ink tnum">{usd(c.q!.feeUsd, 2)}</div>
                <div className="mt-1 text-xs text-ink-2 tnum">{c.q!.feeBps} bps of {usd(tradeUsd, 0)}</div>
                <div className="mt-3 text-xs text-muted">You receive</div>
                <div className="text-base font-semibold text-ink tnum">
                  {num(c.q!.out, buyDp)} {buySym}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">
            The identical swap costs {a.data?.tier === 'RETAIL' ? 'Rita' : 'the first wallet'} <b className="text-ink tnum">{usd(qa.feeUsd, 2)}</b> and Arb Bot 7 <b className="text-ink tnum">{usd(qb.feeUsd, 2)}</b>:{' '}
            {qb.feeUsd > qa.feeUsd ? (
              <>
                the bot pays <b className="text-ink tnum">{usd(qb.feeUsd - qa.feeUsd, 2)}</b> more ({(qb.feeUsd / Math.max(qa.feeUsd, 1e-12)).toFixed(1)}×). That difference is what flows to LPs, so retail can be charged less.
              </>
            ) : (
              <>the two tiers charge the same here.</>
            )}
          </p>
        </>
      )}
    </Card>
  );
}
