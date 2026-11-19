'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Search } from 'lucide-react';

export function WalletSearch() {
  const router = useRouter();
  const [v, setV] = useState('');
  const ok = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.trim());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) router.push(`/wallet/${v.trim()}`);
      }}
      className="flex gap-2"
    >
      <div className="relative flex-1">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="Paste a wallet address (base58)"
          aria-label="Wallet address"
          className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-3 font-mono text-sm text-ink outline-none focus:border-accent"
        />
      </div>
      <button disabled={!ok} className="rounded-xl bg-accent px-5 text-sm font-semibold text-accent-ink disabled:opacity-40">
        Look up
      </button>
    </form>
  );
}
