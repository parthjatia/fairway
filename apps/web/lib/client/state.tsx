'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PairMeta, Persona, PoolKey } from '../types';

export const MODE = (process.env.NEXT_PUBLIC_MODE === 'live' ? 'live' : 'mock') as 'mock' | 'live';

type Theme = 'dark' | 'light';
type MockPool = { base: number; quote: number };
export type SessionTrade = { id: number; ts: number; persona: string; pair: PoolKey; side: 'buy' | 'sell'; amountIn: number; amountOut: number; feeBps: number; tier: string };

type AppState = {
  personas: Persona[];
  persona: Persona;
  setPersonaKey: (k: Persona['key']) => void;
  theme: Theme;
  toggleTheme: () => void;
  /** tradable pairs (SOL/USDC and the BONK-test/USDC memecoin pool) */
  pairs: PairMeta[];
  pair: PairMeta;
  setPairKey: (k: PoolKey) => void;
  /** mock reserves of the selected pair */
  pool: MockPool;
  initialPool: MockPool;
  applySwap: (next: MockPool, trade: Omit<SessionTrade, 'id' | 'ts' | 'pair'>) => void;
  resetPool: () => void;
  /** this session's swaps on the selected pair */
  trades: SessionTrade[];
};

const Ctx = createContext<AppState | null>(null);
const KEYS = { persona: 'fw.persona', theme: 'fw.theme', pools: 'fw.pools.v2', trades: 'fw.trades.v2', pair: 'fw.pair' };
type Pools = Record<PoolKey, MockPool>;

export function AppStateProvider({ personas, pairs, initialPools, children }: { personas: Persona[]; pairs: PairMeta[]; initialPools: Pools; children: ReactNode }) {
  const [personaKey, setKey] = useState<Persona['key']>('rita');
  const [pairKey, setPair] = useState<PoolKey>('sol');
  const [theme, setTheme] = useState<Theme>('dark');
  const [pools, setPools] = useState<Pools>(initialPools);
  const [allTrades, setTrades] = useState<SessionTrade[]>([]);

  useEffect(() => {
    const k = localStorage.getItem(KEYS.persona) as Persona['key'] | null;
    if (k && personas.some((p) => p.key === k)) setKey(k);
    const pk = localStorage.getItem(KEYS.pair) as PoolKey | null;
    if (pk && pairs.some((p) => p.key === pk)) setPair(pk);
    setTheme((document.documentElement.dataset.theme as Theme) || 'dark');
    try {
      const p = JSON.parse(localStorage.getItem(KEYS.pools) || 'null');
      if (p && Object.values(p as Pools).every((x) => x && x.base > 0 && x.quote > 0)) setPools({ ...initialPools, ...p });
      const t = JSON.parse(localStorage.getItem(KEYS.trades) || '[]');
      if (Array.isArray(t)) setTrades(t);
    } catch {
      /* ignore corrupt local state */
    }
  }, [personas, pairs, initialPools]);

  const setPersonaKey = useCallback((k: Persona['key']) => {
    setKey(k);
    localStorage.setItem(KEYS.persona, k);
  }, []);
  const setPairKey = useCallback((k: PoolKey) => {
    setPair(k);
    localStorage.setItem(KEYS.pair, k);
  }, []);
  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const n = t === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = n;
      localStorage.setItem(KEYS.theme, n);
      return n;
    });
  }, []);
  const applySwap = useCallback(
    (next: MockPool, trade: Omit<SessionTrade, 'id' | 'ts' | 'pair'>) => {
      setPools((ps) => {
        const n = { ...ps, [pairKey]: next };
        localStorage.setItem(KEYS.pools, JSON.stringify(n));
        return n;
      });
      setTrades((ts) => {
        const n = [{ ...trade, pair: pairKey, id: Date.now(), ts: Math.floor(Date.now() / 1000) }, ...ts].slice(0, 40);
        localStorage.setItem(KEYS.trades, JSON.stringify(n));
        return n;
      });
    },
    [pairKey],
  );
  const resetPool = useCallback(() => {
    setPools((ps) => {
      const n = { ...ps, [pairKey]: initialPools[pairKey] };
      localStorage.setItem(KEYS.pools, JSON.stringify(n));
      return n;
    });
    setTrades((ts) => {
      const n = ts.filter((t) => t.pair !== pairKey);
      localStorage.setItem(KEYS.trades, JSON.stringify(n));
      return n;
    });
  }, [initialPools, pairKey]);

  const persona = personas.find((p) => p.key === personaKey) ?? personas[0]!;
  const pair = pairs.find((p) => p.key === pairKey) ?? pairs[0]!;
  const trades = useMemo(() => allTrades.filter((t) => t.pair === pairKey), [allTrades, pairKey]);
  const value = useMemo(
    () => ({ personas, persona, setPersonaKey, theme, toggleTheme, pairs, pair, setPairKey, pool: pools[pairKey], initialPool: initialPools[pairKey], applySwap, resetPool, trades }),
    [personas, persona, setPersonaKey, theme, toggleTheme, pairs, pair, setPairKey, pools, pairKey, initialPools, applySwap, resetPool, trades],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAppState outside provider');
  return c;
}
