'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Copy, Search } from 'lucide-react';

/** Pulls a Solana address out of whatever was pasted (a bare address, or an explorer URL that contains one). */
export function extractAddress(text: string): string | null {
  const m = text.trim().match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
  return m ? m[m.length - 1]! : null;
}

export function CopyButton({ value, label = 'Copy address' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? 'Copied' : label}
      title={done ? 'Copied' : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1_500);
        } catch {
          /* clipboard blocked: nothing to do */
        }
      }}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border border-line text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  );
}

export function CheckSearch({ initial = '', autoFocus = false, size = 'lg' }: { initial?: string; autoFocus?: boolean; size?: 'md' | 'lg' }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const a = extractAddress(v);
    if (!a) {
      setErr('Paste a Solana token mint or wallet address (32–44 characters).');
      return;
    }
    setErr(null);
    router.push(`/check/${a}`);
  };
  const h = size === 'lg' ? 'h-14' : 'h-12';
  return (
    <form onSubmit={submit} role="search" className="w-full">
      <label htmlFor="check-input" className="sr-only">
        Token mint or wallet address
      </label>
      <div className={`flex ${h} items-center gap-2 rounded-md border bg-surface pl-4 pr-2 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent ${err ? 'border-bad' : 'border-line'}`}>
        <Search size={18} className="shrink-0 text-muted" aria-hidden />
        <input
          id="check-input"
          value={v}
          onChange={(e) => {
            setV(e.target.value);
            if (err) setErr(null);
          }}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Paste a token mint or wallet"
          aria-invalid={!!err}
          aria-describedby={err ? 'check-err' : undefined}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm text-ink outline-none placeholder:font-sans placeholder:text-muted focus-visible:outline-none"
        />
        <button type="submit" className="h-10 shrink-0 rounded-[4px] bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-accent-hover">
          Check
        </button>
      </div>
      {err && (
        <p id="check-err" role="alert" className="mt-2 text-sm text-bad">
          {err}
        </p>
      )}
    </form>
  );
}
