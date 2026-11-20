'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Moon, Sun, ChevronDown, Menu, X } from 'lucide-react';
import { useAppState } from '@/lib/client/state';
import { useDemo } from '@/lib/client/fairway';
import { TierBadge } from './ui';
import { WalletButton } from './wallet-button';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="5" fill="var(--accent)" />
      <path d="M9 23 L15 9" stroke="var(--accent-ink)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M15.5 23 L21.5 9" stroke="var(--accent-ink)" strokeOpacity="0.55" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="23" cy="22" r="2.2" fill="var(--accent-ink)" />
    </svg>
  );
}

/** Check first (the public entry point), then Launch; the liquid-pair (SOL/USDC) swap and pool are secondary evidence that the engine generalises. */
const LINKS = [
  { href: '/swap', label: 'Swap' },
  { href: '/launch', label: 'Launch' },
  { href: '/explore', label: 'Explore' },
  { href: '/check', label: 'Check' },
];
/** research pages (simulator output, labelled as such on the page) */
const SECONDARY = [
  { href: '/backtest', label: 'Backtest' },
  { href: '/how-it-works', label: 'How it works' },
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
        className="flex h-8 items-center gap-2 whitespace-nowrap rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink duration-150 hover:border-line-strong"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="hidden text-muted sm:inline">Demo as</span>
        <span>{persona.name}</span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <div role="listbox" className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-md border border-line bg-surface">
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
  // simulated personas exist only behind the hidden ?demo=1 flag
  const demo = useDemo();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-bg">
        <div className="mx-auto flex h-14 max-w-[1100px] items-stretch gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 border-r border-line pr-4 font-semibold tracking-tight text-ink sm:pr-5">
            <Logo className="h-6 w-6" />
            <span className="text-[15px]">Fairway</span>
          </Link>
          <nav className="hidden items-stretch md:flex">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`-mb-px flex items-center border-b px-3 text-sm font-medium duration-150 ${path.startsWith(l.href) ? 'border-ink text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {demo ? <PersonaSwitcher /> : <WalletButton />}
            <button onClick={toggleTheme} aria-label="Toggle theme" className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-2 duration-150 hover:border-line-strong hover:text-ink">
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button onClick={() => setMenu((m) => !m)} aria-label="Menu" className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-2 duration-150 hover:border-line-strong md:hidden">
              {menu ? <X size={15} /> : <Menu size={15} />}
            </button>
          </div>
        </div>
        {menu && (
          <nav className="border-t border-line px-4 py-2 md:hidden">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="block rounded-[4px] px-3 py-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
                {l.label}
              </Link>
            ))}
            <div className="mt-1 border-t border-line px-3 pb-1 pt-2 label">Research</div>
            {SECONDARY.map((l) => (
              <Link key={l.href} href={l.href} className="block rounded-[4px] px-3 py-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
                {l.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3 px-4 py-5 font-mono text-[11px] text-muted sm:px-6">
          <span>Fairway: snipers pay more, humans pay less. Trading runs on Solana devnet. Hackathon prototype, unaudited.</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {SECONDARY.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-ink">
                {l.label}
              </Link>
            ))}
            <span>Data: QuickNode Streams</span>
            {demo && <span className="font-semibold text-warn">Demo mode (simulated)</span>}
          </span>
        </div>
      </footer>
    </div>
  );
}
