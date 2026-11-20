'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

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
      className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-line text-ink-2 hover:bg-surface-2 hover:text-ink"
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
  const h = size === 'lg' ? 'h-[50px]' : 'h-11';
  return (
    <form onSubmit={submit} role="search" className="w-full max-w-[520px]">
      <label htmlFor="check-input" className="sr-only">
        Token mint or wallet address
      </label>
      <div className={`flex ${h} border bg-surface focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink ${err ? 'border-bad' : 'border-ink'}`}>
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
          className="min-w-0 flex-1 bg-transparent px-4 font-mono text-sm text-ink outline-none focus-visible:outline-none"
        />
        <button type="submit" className="shrink-0 border-l border-accent bg-accent px-[22px] text-sm font-medium text-accent-ink hover:bg-accent-hover">
          Check <span aria-hidden>⏎</span>
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
