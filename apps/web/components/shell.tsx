'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Moon, Sun, ChevronDown, Menu, X } from 'lucide-react';
import { MODE, useAppState } from '@/lib/client/state';
import { DataBadge, TierBadge } from './ui';
import { WalletButton } from './wallet-button';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path d="M9 23 L15 9" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M15.5 23 L21.5 9" stroke="#fff" strokeOpacity="0.55" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="23" cy="22" r="2.2" fill="#fff" />
    </svg>
  );
}

/** Check first (the public entry point), then Launch; the liquid-pair (SOL/USDC) swap and pool are secondary evidence that the engine generalises. */
const LINKS = [
  { href: '/check', label: 'Check a token' },
  { href: '/launch', label: 'Launch' },
  { href: '/backtest', label: 'Backtest' },
  { href: '/wallet', label: 'Wallets' },
  { href: '/how-it-works', label: 'How it works' },
];
const SECONDARY = [
  { href: '/swap', label: 'Swap' },
  { href: '/pool', label: 'Pool' },
];

function PersonaSwitcher() {
  const { personas, persona, setPersonaKey } = useAppState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const shown = personas.filter((p) => p.key !== 'sniper');
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-2"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="text-muted">Demo as</span>
        <span>{persona.name}</span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <div role="listbox" className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-surface">
          {shown.map((p) => (
            <button
              key={p.key}
              role="option"
              aria-selected={p.key === persona.key}
              onClick={() => {
                setPersonaKey(p.key);
                setOpen(false);
              }}
              className={`block w-full px-4 py-3 text-left hover:bg-surface-2 ${p.key === persona.key ? 'bg-surface-2' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">{p.name}</span>
                <TierBadge tier={p.expectedTier} />
              </div>
              <p className="mt-1 text-xs leading-snug text-ink-2">{p.blurb}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { theme, toggleTheme } = useAppState();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  // the persona switcher only matters where a wallet is simulated (swap, wallets, pool)
  const showPersona = /^\/(swap|wallet|pool)/.test(path);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-ink">
            <Logo className="h-7 w-7" />
            <span className="text-base">Fairway</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${path.startsWith(l.href) ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'}`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {MODE === 'mock' ? showPersona && <PersonaSwitcher /> : <WalletButton />}
            <button onClick={toggleTheme} aria-label="Toggle theme" className="rounded-full border border-line p-2 text-ink-2 hover:text-ink">
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button onClick={() => setMenu((m) => !m)} aria-label="Menu" className="rounded-full border border-line p-2 text-ink-2 md:hidden">
              {menu ? <X size={15} /> : <Menu size={15} />}
            </button>
          </div>
        </div>
        {menu && (
          <nav className="border-t border-line px-4 py-2 md:hidden">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="block rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
                {l.label}
              </Link>
            ))}
            <div className="mt-1 border-t border-line px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">Liquid pair (SOL/USDC)</div>
            {SECONDARY.map((l) => (
              <Link key={l.href} href={l.href} className="block rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
                {l.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted sm:px-6">
          <span>Fairway: snipers get exposed everywhere, and taxed on Fairway. Hackathon prototype, unaudited.</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {SECONDARY.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-ink">
                {l.label}
              </Link>
            ))}
            <Link href="/how-it-works" className="hover:text-ink">How it works</Link>
            <span>Data: QuickNode Streams</span>
            <DataBadge source={MODE === 'live' ? 'live' : 'simulated'} />
          </span>
        </div>
      </footer>
    </div>
  );
}
