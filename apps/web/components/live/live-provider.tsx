'use client';
// Live mode: Solana wallet-adapter provider. Wallets are discovered through the Wallet Standard
// (Phantom, Solflare, Backpack ... register themselves), so no per-wallet packages are needed.
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import type { ReactNode } from 'react';

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:8899';
export const BASE_MINT = process.env.NEXT_PUBLIC_BASE_MINT || '';
export const QUOTE_MINT = process.env.NEXT_PUBLIC_QUOTE_MINT || '';

export function LiveProvider({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={[]} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
