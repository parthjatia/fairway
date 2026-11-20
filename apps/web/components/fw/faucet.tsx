'use client';
import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Droplet } from 'lucide-react';
import { explorerTx } from '@/lib/registry';

/** Gets devnet test USDC (and a little devnet SOL for fees) from the server faucet. */
export function FaucetButton({ onDone, className = '' }: { onDone?: () => void; className?: string }) {
  const { publicKey } = useWallet();
  const [state, setState] = useState<{ busy?: boolean; msg?: string; sig?: string; err?: boolean }>({});
  if (!publicKey) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 text-xs ${className}`}>
      <button
        disabled={state.busy}
        onClick={async () => {
          setState({ busy: true });
          try {
            const res = await fetch('/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: publicKey.toBase58() }) });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error);
            setState({ msg: `Got ${j.usdc.toLocaleString()} test USDC${j.sol ? ` + ${j.sol} SOL` : ''}.`, sig: j.sig });
            onDone?.();
          } catch (e) {
            setState({ msg: (e as Error).message, err: true });
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
      >
        <Droplet size={12} /> {state.busy ? 'Sending…' : 'Get test USDC'}
      </button>
      {state.msg && (
        <span className={state.err ? 'text-bad' : 'text-good'}>
          {state.msg}{' '}
          {state.sig && (
            <a className="underline" href={explorerTx(state.sig)} target="_blank" rel="noreferrer">
              Explorer
            </a>
          )}
        </span>
      )}
    </span>
  );
}
