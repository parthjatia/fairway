'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Persona } from '../types';

export const MODE = (process.env.NEXT_PUBLIC_MODE === 'live' ? 'live' : 'mock') as 'mock' | 'live';

type Theme = 'dark' | 'light';
type MockPool = { base: number; quote: number };
export type SessionTrade = { id: number; ts: number; persona: string; side: 'buy' | 'sell'; amountIn: number; amountOut: number; feeBps: number; tier: string };

type AppState = {
  personas: Persona[];
  persona: Persona;
  setPersonaKey: (k: Persona['key']) => void;
  theme: Theme;
  toggleTheme: () => void;
  pool: MockPool;
  initialPool: MockPool;
  applySwap: (next: MockPool, trade: Omit<SessionTrade, 'id' | 'ts'>) => void;
  resetPool: () => void;
  trades: SessionTrade[];
};

const Ctx = createContext<AppState | null>(null);
const KEYS = { persona: 'fw.persona', theme: 'fw.theme', pool: 'fw.pool', trades: 'fw.trades' };

export function AppStateProvider({ personas, initialPool, children }: { personas: Persona[]; initialPool: MockPool; children: ReactNode }) {
  const [personaKey, setKey] = useState<Persona['key']>('rita');
  const [theme, setTheme] = useState<Theme>('dark');
  const [pool, setPool] = useState<MockPool>(initialPool);
  const [trades, setTrades] = useState<SessionTrade[]>([]);

  useEffect(() => {
    const k = localStorage.getItem(KEYS.persona) as Persona['key'] | null;
    if (k && personas.some((p) => p.key === k)) setKey(k);
    setTheme((document.documentElement.dataset.theme as Theme) || 'dark');
    try {
      const p = JSON.parse(localStorage.getItem(KEYS.pool) || 'null');
      if (p && p.base > 0 && p.quote > 0) setPool(p);
      const t = JSON.parse(localStorage.getItem(KEYS.trades) || '[]');
      if (Array.isArray(t)) setTrades(t);
    } catch {
      /* ignore corrupt local state */
    }
  }, [personas]);

  const setPersonaKey = useCallback((k: Persona['key']) => {
    setKey(k);
    localStorage.setItem(KEYS.persona, k);
  }, []);
  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const n = t === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = n;
      localStorage.setItem(KEYS.theme, n);
      return n;
    });
  }, []);
  const applySwap = useCallback((next: MockPool, trade: Omit<SessionTrade, 'id' | 'ts'>) => {
    setPool(next);
    localStorage.setItem(KEYS.pool, JSON.stringify(next));
    setTrades((ts) => {
      const n = [{ ...trade, id: Date.now(), ts: Math.floor(Date.now() / 1000) }, ...ts].slice(0, 20);
      localStorage.setItem(KEYS.trades, JSON.stringify(n));
      return n;
    });
  }, []);
  const resetPool = useCallback(() => {
    setPool(initialPool);
    setTrades([]);
    localStorage.setItem(KEYS.pool, 'null');
    localStorage.setItem(KEYS.trades, '[]');
  }, [initialPool]);

  const persona = personas.find((p) => p.key === personaKey) ?? personas[0]!;
  const value = useMemo(
    () => ({ personas, persona, setPersonaKey, theme, toggleTheme, pool, initialPool, applySwap, resetPool, trades }),
    [personas, persona, setPersonaKey, theme, toggleTheme, pool, initialPool, applySwap, resetPool, trades],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAppState outside provider');
  return c;
}
