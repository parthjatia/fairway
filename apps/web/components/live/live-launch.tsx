'use client';
// Live-mode launch components. Rendered only when NEXT_PUBLIC_MODE=live (inside LiveProvider).
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { Rocket } from 'lucide-react';
import { launchFeeBps, TIER_NAMES } from '@fairway/sdk';
import { createLaunchLive, loadLiveLaunch, type LiveLaunch } from '@/lib/client/live-launch';
import { short } from '@/lib/format';
import { Card, Empty, Stat, TierBadge } from '../ui';
import { WalletButton } from '../wallet-button';
import { QUOTE_MINT } from './live-provider';
import { saveLocalName } from '@/lib/client/fairway';
import { FaucetButton } from '../fw/faucet';

const QUOTE_DECIMALS = 6;

export function LiveCreate({ name, symbol, ...p }: { name: string; symbol: string; supply: number; poolPct: number; liquidityQuote: number; windowSlots: number; creatorShareBps?: number }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!QUOTE_MINT) return <p className="text-sm text-bad">Set NEXT_PUBLIC_QUOTE_MINT (pnpm seed:local writes it) to create launches in live mode.</p>;
  if (!publicKey) return <WalletButton />;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <FaucetButton />
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const mint = await createLaunchLive({ connection, creator: publicKey, quoteMint: new PublicKey(QUOTE_MINT), quoteDecimals: QUOTE_DECIMALS, sendTransaction, ...p });
            saveLocalName(mint.toBase58(), symbol, name);
            void fetch(`/api/fairway/token/${mint.toBase58()}?fresh=1`).catch(() => undefined);
            router.push(`/launch/${mint.toBase58()}`);
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex items-center gap-2 rounded-md bg-accent hover:bg-accent-hover px-5 py-2.5 text-sm font-semibold text-accent-ink disabled:opacity-50"
      >
        <Rocket size={15} /> {busy ? 'Creating (3 transactions)…' : 'Create launch onchain'}
      </button>
      {err && <span className="text-sm text-bad" role="alert">{/insufficient|0x1\b/i.test(err) ? 'Not enough test USDC or SOL: use the faucet first.' : /reject/i.test(err) ? 'You rejected the transaction.' : err}</span>}
    </div>
  );
}

/** /launch/[mint] in live mode: launch params, the fee each tier pays right now, and the pool's recent swaps. */
export function LiveLaunchView({ mint }: { mint: string }) {
  const { connection } = useConnection();
  const [data, setData] = useState<LiveLaunch | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      if (!QUOTE_MINT) throw new Error('NEXT_PUBLIC_QUOTE_MINT is not set');
      setData(await loadLiveLaunch(connection, new PublicKey(mint), new PublicKey(QUOTE_MINT)));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [connection, mint]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4_000);
    return () => clearInterval(t);
  }, [refresh]);
  if (err) return <Empty>Could not load the launch: {err}</Empty>;
  if (!data) return <div className="h-64 animate-pulse rounded-md border border-line bg-surface" aria-busy />;
  if (!data.pool) return <Empty>No Fairway pool for mint {short(mint)} on this cluster. <Link href="/launch" className="text-accent">Create a launch</Link>.</Empty>;
  const l = data.pool.launch;
  const fee = (t: number) => launchFeeBps(l.curve, t, data.slot, l.launchSlot, l.windowSlots);
  const elapsed = data.slot - l.launchSlot;
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 label">Launch · live</div>
        <h1 className="font-mono text-2xl font-semibold text-ink">{short(mint, 6)}</h1>
        <p className="mt-2 text-sm text-ink-2">
          {l.windowSlots === 0n ? 'Not a launch pool (normal tier fees).' : `Opened at slot ${l.launchSlot}, window ${l.windowSlots} slots. Now slot ${data.slot} (${elapsed >= 0n ? `${elapsed} slots in` : 'not open yet'}).`} TWAP scoring:{' '}
          {l.twapScoring ? 'on' : 'off'}. Creator share of the sniper premium: {data.pool.creatorFees.shareBps / 100}% (owed now: {String(data.pool.creatorFees.owedQuote)} quote + {String(data.pool.creatorFees.owedBase)} token units, raw; claim with{' '}
          <span className="font-mono">claimCreatorFeesIx</span>).
        </p>
      </div>
      <div className="flush grid grid-cols-3">
        {[0, 1, 2].map((t) => (
          <Stat key={t} label={`Fee now: ${TIER_NAMES[t]}`} value={`${fee(t) ?? '—'}${fee(t) === null ? '' : ' bps'}`} hint={fee(t) === null ? 'window over: Config fee' : 'launch curve'} />
        ))}
      </div>
      <Card title={`Recent swaps (${data.swaps.length})`} subtitle="SwapExecuted events parsed from the pool's last transactions. Refreshes every 4 s.">
        {data.swaps.length === 0 ? (
          <Empty>No swaps yet.</Empty>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="label">
              <tr>
                <th className="py-2 pr-3 font-semibold">Trader</th>
                <th className="py-2 pr-3 font-semibold">Side</th>
                <th className="py-2 pr-3 font-semibold">Tier</th>
                <th className="py-2 pr-3 text-right font-semibold">Fee</th>
              </tr>
            </thead>
            <tbody>
              {data.swaps.map((s) => (
                <tr key={`${s.sig}-${s.trader}`} className="border-t border-line">
                  <td className="py-2 pr-3 font-mono">{short(s.trader)}</td>
                  <td className="py-2 pr-3">{s.aToB ? 'sell' : 'buy'}</td>
                  <td className="py-2 pr-3"><TierBadge tier={TIER_NAMES[s.tier] ?? 'STANDARD'} /></td>
                  <td className="py-2 pr-3 text-right tnum">{s.feeBps} bps</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
