'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import { useAppState } from '@/lib/client/state';
import { useDemo } from '@/lib/client/fairway';
import { TierBadge } from './ui';
import { WalletButton } from './wallet-button';
import { HawkMark } from './marshal';

/** Numbered tabs, as on the printed plate: Swap and Launch trade on devnet, Explore and Check read the graded launches. */
const LINKS = [
  { href: '/swap', n: '01', label: 'Swap' },
  { href: '/launch', n: '02', label: 'Launch' },
  { href: '/explore', n: '03', label: 'Explore' },
  { href: '/check', n: '04', label: 'Check' },
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
        className="flex h-[34px] items-center gap-2 whitespace-nowrap border border-line px-3 text-[13px] font-medium text-ink hover:border-ink"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="hidden text-ink-2 sm:inline">Demo as</span>
        <span>{persona.name}</span>
        <ChevronDown size={14} className="text-ink-2" />
      </button>
      {open && (
        <div role="listbox" className="absolute right-0 z-50 mt-2 w-80 overflow-hidden border border-ink bg-surface">
          {shown.map((p) => (
            <button
              key={p.key}
              role="option"
              aria-selected={p.key === persona.key}
              onClick={() => {
                setPersonaKey(p.key);
                setOpen(false);
              }}
              className={`block w-full border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-surface-2 ${p.key === persona.key ? 'bg-surface-2' : ''}`}
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

/** The blue strip above the header: what this build is connected to. No invented counters. */
function StatusStrip({ demo }: { demo: boolean }) {
  return (
    <div className="bg-accent font-mono text-[11px] uppercase tracking-[0.06em] text-accent-ink">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-7 gap-y-1 px-4 py-1.5 sm:px-7">
        <span className="flex items-center gap-[7px]">
          <span className={`fw-blip h-1.5 w-1.5 ${demo ? 'bg-warn' : 'bg-accent-ink'}`} aria-hidden />
          {demo ? 'Demo mode · simulated data' : 'Trading · Solana devnet'}
        </span>
        <span className="hidden sm:inline">Launch data · QuickNode Streams</span>
        <Link href="/launch/frog" className="ml-auto text-accent-ink no-underline hover:text-accent-ink hover:underline">
          Watch a simulated launch ↗
        </Link>
      </div>
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
  const active = (href: string) => path.startsWith(href) || (href === '/check' && path === '/');
  return (
    <div className="flex min-h-screen flex-col">
      <StatusStrip demo={demo} />
      <header className="sticky top-0 z-40 border-b border-ink bg-bg">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-stretch gap-x-9 px-4 sm:px-7">
          <Link href="/" className="flex items-center gap-2.5 py-3.5 no-underline">
            <HawkMark />
            <span className="font-serif text-[26px] leading-none tracking-[-0.01em] text-ink">Fairway</span>
          </Link>
          <nav className="mr-auto hidden items-stretch font-mono text-[13px] font-bold uppercase tracking-[0.08em] md:flex" aria-label="Main">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active(l.href) ? 'page' : undefined}
                className={`flex items-center gap-2 px-3.5 no-underline ${active(l.href) ? 'text-ink shadow-[inset_0_-2px_0_var(--accent)]' : 'text-ink-2 hover:text-ink'}`}
              >
                <span className="font-normal text-ink-2">{l.n}</span>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="h-[34px] border border-line px-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink hover:border-ink"
            >
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
            {demo ? <PersonaSwitcher /> : <WalletButton />}
            <button onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu} className="flex h-[34px] w-[34px] items-center justify-center border border-line text-ink hover:border-ink md:hidden">
              {menu ? <X size={15} /> : <Menu size={15} />}
            </button>
          </div>
        </div>
        {menu && (
          <nav className="border-t border-line px-4 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.08em] md:hidden" aria-label="Main">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={`flex gap-2 px-3 py-2.5 no-underline hover:bg-surface-2 ${active(l.href) ? 'text-ink' : 'text-ink-2'}`}>
                <span className="font-normal text-ink-2">{l.n}</span>
                {l.label}
              </Link>
            ))}
            <div className="mt-1 border-t border-line px-3 pb-1 pt-2 label">Research</div>
            {SECONDARY.map((l) => (
              <Link key={l.href} href={l.href} className="block px-3 py-2.5 text-ink-2 no-underline hover:bg-surface-2 hover:text-ink">
                {l.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pb-20 pt-8 sm:px-7 sm:pt-12">{children}</main>
      <footer className="border-t border-ink">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-2 px-4 py-3.5 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-2 sm:px-7">
          <span>Fairway · Solana devnet · unaudited prototype</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {SECONDARY.map((l) => (
              <Link key={l.href} href={l.href} className="no-underline hover:text-ink">
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
