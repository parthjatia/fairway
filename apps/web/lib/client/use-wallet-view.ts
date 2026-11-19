'use client';
import { useEffect, useState } from 'react';
import type { WalletView } from '../types';

export function useWalletView(address: string | null) {
  const [data, setData] = useState<WalletView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!address) return;
    let live = true;
    setLoading(true);
    setError(null);
    fetch(`/api/wallet/${address}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
      })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(String(e.message ?? e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [address]);
  return { data, error, loading };
}
