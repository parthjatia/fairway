'use client';
import { useWallet } from '@solana/wallet-adapter-react';
import { short } from '@/lib/format';

/** Wallet connect (Wallet Standard wallets such as Phantom, detected by wallet-adapter-react). Set Phantom to devnet. */
export function WalletButton({ block = false }: { block?: boolean }) {
  const { wallets, wallet, publicKey, connecting, select, connect, disconnect } = useWallet();
  const cls = block
    ? 'h-12 w-full rounded-xl bg-accent text-sm font-semibold text-accent-ink hover:opacity-90 disabled:opacity-50'
    : 'whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-2';
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
      <a href="https://phantom.com/download" target="_blank" rel="noreferrer" className={`${cls} ${block ? 'flex items-center justify-center' : ''}`} title="Install Phantom, Solflare or Backpack">
        {block ? 'Install a Solana wallet to trade' : 'Get a wallet'}
      </a>
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
