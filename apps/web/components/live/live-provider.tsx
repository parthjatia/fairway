'use client';
// Live mode: Solana wallet-adapter provider. Wallets are discovered through the Wallet Standard
// (Phantom, Solflare, Backpack ... register themselves), so no per-wallet packages are needed.
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import type { ReactNode } from 'react';

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
export const BASE_MINT = process.env.NEXT_PUBLIC_BASE_MINT || '';
export const QUOTE_MINT = process.env.NEXT_PUBLIC_QUOTE_MINT || 'BLo5pvqdwJY4yN5f91utohYk39hgnPKxA3KfV7PCX86X';

export function LiveProvider({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={[]} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
