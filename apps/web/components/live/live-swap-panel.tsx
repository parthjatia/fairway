'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { swapQuote, TIER_NAMES } from '@fairway/sdk';
import type { Tier } from '@fairway/scoring';
import { Card, Empty, TierBadge } from '../ui';
import { WalletButton } from '../wallet-button';
import { BASE_MINT, QUOTE_MINT } from './live-provider';
import { loadLive, sendSwap, type LivePool } from '@/lib/client/live-swap';

const DEC = { SOL: 9, USDC: 6 } as const;

/** Live swap: reads the pool + your onchain TraderScore, quotes with the program's math, sends `swap`. */
export function LiveSwapPanel() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [pool, setPool] = useState<LivePool>(null);
  const [fee, setFee] = useState<{ tier: number; feeBps: number; source: string } | null>(null);
  const [sell, setSell] = useState<'USDC' | 'SOL'>('USDC');
  const [amount, setAmount] = useState('10');
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const configured = Boolean(BASE_MINT && QUOTE_MINT);

  const refresh = useCallback(async () => {
    if (!configured) return;
    try {
      const trader = publicKey ?? PublicKey.default;
      const r = await loadLive(connection, trader, new PublicKey(BASE_MINT), new PublicKey(QUOTE_MINT));
      setPool(r.pool);
      setFee(publicKey ? r.fee : null);
    } catch (e) {
      setStatus({ kind: 'err', msg: `RPC error: ${(e as Error).message}` });
    }
  }, [connection, publicKey, configured]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const quote = useMemo(() => {
    const v = Number(amount);
    if (!pool || !(v > 0)) return null;
    const aToB = sell === 'SOL';
    const raw = BigInt(Math.floor(v * 10 ** DEC[sell]));
    const [rin, rout] = aToB ? [pool.reserveBase, pool.reserveQuote] : [pool.reserveQuote, pool.reserveBase];
    try {
      const q = swapQuote(raw, rin, rout, fee?.feeBps ?? 30);
      return { aToB, raw, ...q, out: Number(q.amountOut) / 10 ** DEC[sell === 'SOL' ? 'USDC' : 'SOL'] };
    } catch {
      return null;
    }
  }, [amount, sell, pool, fee]);

  const submit = async () => {
    if (!publicKey || !quote) return;
    setBusy(true);
    setStatus(null);
    try {
      const minOut = (quote.amountOut * 99n) / 100n; // 1% slippage
      const sig = await sendSwap({
        connection, trader: publicKey, baseMint: new PublicKey(BASE_MINT), quoteMint: new PublicKey(QUOTE_MINT),
        amountIn: quote.raw, minAmountOut: minOut, aToB: quote.aToB, sendTransaction,
      });
      setStatus({ kind: 'ok', msg: `Swapped. Signature ${sig.slice(0, 12)}…` });
      void refresh();
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!configured)
    return (
      <Empty>
        Live mode needs <code>NEXT_PUBLIC_BASE_MINT</code> and <code>NEXT_PUBLIC_QUOTE_MINT</code> (run <code>pnpm seed:local</code>, it writes them to <code>apps/web/.env.local</code>).
      </Empty>
    );
  const tier = fee ? (TIER_NAMES[fee.tier as 0 | 1 | 2] as Tier) : 'STANDARD';
  return (
    <Card title="Swap (live, onchain)" action={<WalletButton />}>
      {!pool && <p className="text-sm text-muted">Pool not found at {process.env.NEXT_PUBLIC_RPC_URL || 'localhost:8899'}. Run pnpm demo:local.</p>}
      <label className="block text-xs text-muted">You pay ({sell})</label>
      <input
        inputMode="decimal" aria-label="Amount to pay" value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        className="w-full bg-transparent text-3xl font-semibold text-ink outline-none tnum"
      />
      <button className="mt-2 text-sm text-ink-2 underline" onClick={() => setSell(sell === 'SOL' ? 'USDC' : 'SOL')}>
        Switch to paying {sell === 'SOL' ? 'USDC' : 'SOL'}
      </button>
      <div className="mt-4 space-y-2 rounded-xl bg-surface-2 p-3 text-sm">
        <div className="flex justify-between"><span>Your tier</span>{publicKey ? <TierBadge tier={tier} /> : <span className="text-muted">connect a wallet</span>}</div>
        <div className="flex justify-between"><span>Your fee</span><span className="tnum">{fee ? `${fee.feeBps} bps (${fee.source})` : '—'}</span></div>
        <div className="flex justify-between"><span>You receive</span><span className="tnum">{quote ? quote.out.toFixed(sell === 'USDC' ? 4 : 2) : '—'}</span></div>
      </div>
      {status && <p role="status" className={`mt-3 text-sm ${status.kind === 'ok' ? 'text-good' : 'text-bad'}`}>{status.msg}</p>}
      <button
        disabled={!publicKey || !quote || busy} onClick={() => void submit()}
        className="mt-4 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-accent-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Confirm in wallet…' : 'Swap'}
      </button>
    </Card>
  );
}
