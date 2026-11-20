'use client';
import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { FwData, FwSwap, FwToken } from '../server/fairway-types';

export type { FwData, FwSwap, FwToken };

/** Hidden demo flag: `?demo=1` turns on the simulated personas and fixtures for this tab (sticky in sessionStorage). */
export function useDemo(): boolean {
  const path = usePathname();
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('demo');
    try {
      if (q === '1') sessionStorage.setItem('fw.demo', '1');
      if (q === '0') sessionStorage.removeItem('fw.demo');
      setDemo(sessionStorage.getItem('fw.demo') === '1');
    } catch {
      setDemo(q === '1');
    }
  }, [path]);
  return demo;
}

function usePoll<T>(url: string | null, everyMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(
    async (fresh = false) => {
      if (!url) return;
      try {
        const res = await fetch(fresh ? `${url}${url.includes('?') ? '&' : '?'}fresh=1` : url, { cache: 'no-store' });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || res.statusText);
        setData(j as T);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [url],
  );
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), everyMs);
    return () => clearInterval(t);
  }, [refresh, everyMs]);
  return { data, error, refresh };
}

export const useFairwayTokens = () => usePoll<FwData>('/api/fairway/tokens', 20_000);
export const useFairwayToken = (mint: string) =>
  usePoll<{ token: FwToken; swaps: FwSwap[]; slot: number; updatedAt: number }>(`/api/fairway/token/${mint}`, 10_000);

/** Names creators typed in the launch wizard (Fairway writes no token metadata onchain). */
export function localNames(): Record<string, { symbol: string; name: string }> {
  try {
    return JSON.parse(localStorage.getItem('fw.names') || '{}');
  } catch {
    return {};
  }
}
export function saveLocalName(mint: string, symbol: string, name: string) {
  try {
    localStorage.setItem('fw.names', JSON.stringify({ ...localNames(), [mint]: { symbol, name } }));
  } catch {
    /* storage blocked */
  }
}

export function ago(ts: number | null | undefined, now = Date.now() / 1000): string {
  if (!ts) return '—';
  const s = Math.max(0, now - ts);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
