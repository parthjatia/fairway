'use client';
// /launch/[mint]: a real Fairway pool on devnet. Trade panel, buyers with the tier the program charged them, and the
// Fairway Check report built from the same swaps.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { ExternalLink } from 'lucide-react';
import { FairwayClient, launchFeeBps, TIER_NAMES, type LaunchCurveLike } from '@fairway/sdk';
import type { Tier } from '@fairway/scoring';
import { ago, localNames, useFairwayToken } from '@/lib/client/fairway';
import { explorerAddr, explorerTx } from '@/lib/registry';
import { short } from '@/lib/format';
import { TokenReport } from '../check/report';
import { CopyButton } from '../check/client';
import { Card, Empty, TierBadge } from '../ui';
import { DevnetBadge, RiskBadge, TokenIcon } from './badges';
import { phaseLabel } from './launch-feed';
import { SwapCard } from './swap-card';

const amt = (v: number) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v >= 1 ? v.toFixed(2) : v.toPrecision(3));

export function FwLaunchDetail({ mint }: { mint: string }) {
  const { connection } = useConnection();
  const { data, error, refresh } = useFairwayToken(mint);
  const [name, setName] = useState<{ symbol: string; name: string } | null>(null);
  const [curve, setCurve] = useState<{ curve: LaunchCurveLike; launchSlot: bigint; windowSlots: bigint; slot: bigint } | null>(null);
  useEffect(() => setName(localNames()[mint] ?? null), [mint]);
  const quoteMint = data?.token.quoteMint;
  useEffect(() => {
    if (!quoteMint) return;
    let live = true;
    const load = async () => {
      try {
        const [p, slot] = await Promise.all([new FairwayClient(connection).fetchPool(new PublicKey(mint), new PublicKey(quoteMint)), connection.getSlot('confirmed')]);
        if (p && live) setCurve({ curve: p.launch.curve, launchSlot: p.launch.launchSlot, windowSlots: p.launch.windowSlots, slot: BigInt(slot) });
      } catch {
        /* fee row just stays hidden */
      }
    };
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [connection, mint, quoteMint]);

  if (error && !data) return <Empty title="No Fairway pool for this token">{error} <Link href="/launch" className="text-accent hover:underline">Back to launches</Link></Empty>;
  if (!data) return <div className="skeleton h-96 rounded-md" aria-busy />;
  const t = data.token;
  const n = t.name.startsWith('Token ') && name ? name : { symbol: t.symbol, name: t.name };
  const ph = phaseLabel(t);
  const inWindow = curve && curve.windowSlots > 0n && t.launch?.phase === 'window';
  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="label">{t.isLaunch ? 'Fairway Launch' : 'Fairway pool'}</span>
          <DevnetBadge />
        </div>
        <div className="mt-2 flex items-center gap-3">
          <TokenIcon symbol={n.symbol} size={44} />
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-semibold tracking-tight text-ink">{n.symbol}</h1>
            <p className="truncate text-sm text-ink-2">{n.name}</p>
          </div>
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <code className="min-w-0 max-w-full truncate rounded-[4px] bg-surface-2 px-3 py-1.5 font-mono text-xs text-ink-2" title={mint}>{mint}</code>
          <CopyButton value={mint} />
          <a href={explorerAddr(t.pool)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-ink-2 hover:text-ink">
            Pool on Explorer <ExternalLink size={12} />
          </a>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className={`font-semibold ${ph.tone}`}>{ph.text}</span>
          <RiskBadge check={t.check} />
          <span className="text-ink-2">Launched {ago(t.launch?.launchTs ?? t.createdTs)}</span>
          <span className="text-ink-2 tnum">
            Price {amt(t.price)} {t.quoteSymbol} · Liquidity {amt(t.liquidityQuote)} {t.quoteSymbol}
          </span>
        </div>
        {inWindow && curve && (
          <div className="flush mt-4 grid grid-cols-3 sm:max-w-md">
            {[0, 1, 2].map((tier) => {
              const f = launchFeeBps(curve.curve, tier, curve.slot, curve.launchSlot, curve.windowSlots);
              return (
                <div key={tier} className="rounded-[4px] border border-line px-3 py-2">
                  <TierBadge tier={TIER_NAMES[tier] as Tier} />
                  <div className="mt-1 text-sm font-semibold text-ink tnum">{f === null ? '—' : `${(f / 100).toFixed(2)}%`}</div>
                </div>
              );
            })}
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
        <SwapCard fixedMint={mint} onSwapped={() => setTimeout(() => void refresh(true), 2_000)} />
        <Card title={`Buyers and sellers (${data.swaps.length})`} subtitle="Every swap on this pool, with the tier the program charged. Refreshes every 10 s.">
          {data.swaps.length === 0 ? (
            <Empty>No trades yet. The first buy will show up here with its tier and fee.</Empty>
          ) : (
            <div className="-mx-6 overflow-x-auto px-6">
              <table className="w-full min-w-[460px] text-left text-sm">
                <thead className="label">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Wallet</th>
                    <th className="py-2 pr-3 font-semibold">Side</th>
                    <th className="py-2 pr-3 text-right font-semibold">{n.symbol}</th>
                    <th className="py-2 pr-3 font-semibold">Tier</th>
                    <th className="py-2 pr-3 text-right font-semibold">Fee</th>
                    <th className="py-2 text-right font-semibold">When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.swaps.map((s) => (
                    <tr key={`${s.sig}-${s.trader}`} className="border-t border-line">
                      <td className="py-2 pr-3 font-mono text-xs">
                        <Link href={`/check/${s.trader}`} className="hover:text-accent">{short(s.trader)}</Link>
                      </td>
                      <td className={`py-2 pr-3 ${s.side === 'buy' ? 'text-good' : 'text-bad'}`}>{s.side}</td>
                      <td className="py-2 pr-3 text-right tnum">{amt(s.tokens)}</td>
                      <td className="py-2 pr-3"><TierBadge tier={s.tier as Tier} /></td>
                      <td className="py-2 pr-3 text-right tnum">{(s.feeBps / 100).toFixed(2)}%</td>
                      <td className="py-2 text-right text-xs text-ink-2">
                        <a href={explorerTx(s.sig)} target="_blank" rel="noreferrer" className="hover:text-ink">{ago(s.ts)}</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-ink">Fairness report</h2>
          <Link href={`/check/${mint}`} className="text-sm font-semibold text-accent hover:underline">Open in Fairway Check →</Link>
        </div>
        {t.check.earlyBuyers === 0 ? (
          <Empty>Nothing to grade yet: no buys in the first 60 seconds after the launch. The report fills in from real swaps on this pool.</Empty>
        ) : (
          <TokenReport r={t.check} name={n.name} source="devnet" unit={t.quoteSymbol} embedded />
        )}
      </section>
    </div>
  );
}
