'use client';
import { useWallet } from '@solana/wallet-adapter-react';
import { short } from '@/lib/format';

/** Live-mode wallet connect (Wallet Standard wallets detected by wallet-adapter-react). */
export function WalletButton() {
  const { wallets, wallet, publicKey, connecting, select, connect, disconnect } = useWallet();
  const cls = 'rounded-full border border-line px-3 py-1.5 text-[13px] hover:bg-surface-2';
  if (publicKey) {
    return (
      <button className={cls} onClick={() => void disconnect()} title="Disconnect">
        {short(publicKey.toBase58())}
      </button>
    );
  }
  const installed = wallets.filter((w) => w.readyState === 'Installed' || w.readyState === 'Loadable');
  if (!installed.length) {
    return (
      <span className="rounded-full border border-line px-3 py-1.5 text-[13px] text-muted" title="Install Phantom, Solflare or Backpack">
        No wallet detected
      </span>
    );
  }
  return (
    <button
      className={cls}
      disabled={connecting}
      onClick={async () => {
        const target = wallet ?? installed[0]!;
        select(target.adapter.name);
        try {
          await target.adapter.connect();
        } catch {
          void connect().catch(() => undefined);
        }
      }}
    >
      {connecting ? 'Connecting…' : 'Connect wallet'}
    </button>
  );
}
