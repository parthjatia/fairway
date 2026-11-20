'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Tier } from '@fairway/scoring';
import { decayedFeeBps, DEFAULT_LAUNCH_CURVE } from '@fairway/sdk';
import { TIER_FEE } from '@/lib/fees';
import { TierBadge } from '../ui';

const SLOTS_PER_MIN = 150; // 400 ms slots
const WINDOWS = [2, 5, 10];
const ROWS: { tier: Tier; idx: number; who: string; color: string }[] = [
  { tier: 'RETAIL', idx: 0, who: 'Clean history', color: 'var(--retail)' },
  { tier: 'STANDARD', idx: 1, who: 'Fresh wallet', color: 'var(--standard)' },
  { tier: 'TOXIC', idx: 2, who: 'Known sniper', color: 'var(--toxic)' },
];
const clock = (min: number) => `${Math.floor(min)}:${min % 1 ? '30' : '00'}`;
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const th = 'border-b border-ink py-2 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-2';

/** The default launch curve, computed with the program's own decay formula, for the chosen window length. */
export function LaunchSchedule() {
  const [win, setWin] = useState(5);
  const w = BigInt(win * SLOTS_PER_MIN);
  const fee = (idx: number, elapsed: bigint) => decayedFeeBps(DEFAULT_LAUNCH_CURVE, idx, elapsed, w);
  const BUY = 200;
  const atLaunch = (idx: number) => `$${((BUY * fee(idx, 0n)) / 10_000).toFixed(2)}`;
  return (
    <div>
      <h2 className="display text-[28px] leading-tight">What each wallet pays</h2>
      <p className="mt-1.5 text-sm text-ink-2">The launch fee depends on who buys and when. It starts high and falls to normal by the end of the {win}-minute window.</p>
      <div className="mt-4 flex w-max border border-line" role="group" aria-label="Launch window">
        {WINDOWS.map((m) => (
          <button
            key={m}
            onClick={() => setWin(m)}
            aria-pressed={win === m}
            className={`border-r border-line px-4 py-1.5 font-mono text-[13px] font-medium last:border-r-0 ${win === m ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-surface-2'}`}
          >
            {m} min
          </button>
        ))}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse font-mono text-[13px]">
          <caption className="sr-only">Launch fee by buyer tier over the launch window</caption>
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left`}>Buyer</th>
              <th scope="col" className={`${th} px-1.5 text-right`}>At launch</th>
              <th scope="col" className={`${th} px-1.5 text-right`}>{clock(win / 2)}</th>
              <th scope="col" className={`${th} px-1.5 text-right`}>{clock(win)}</th>
              <th scope="col" className={`${th} pl-1.5 text-right`}>After</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const cells = [fee(r.idx, 0n), fee(r.idx, w / 2n), fee(r.idx, w - 1n), TIER_FEE[r.tier]];
              return (
                <tr key={r.tier}>
                  <th scope="row" className="border-b border-line py-3 text-left font-normal">
                    <TierBadge tier={r.tier} />
                    <div className="mt-0.5 font-sans text-xs text-ink-2">{r.who}</div>
                  </th>
                  {cells.map((b, i) => (
                    <td
                      key={i}
                      className="border-b border-l-2 border-b-line border-l-bg px-1.5 py-3 text-right font-medium"
                      style={{ background: `color-mix(in srgb, ${r.color} ${Math.round(4 + Math.min(1, b / 1000) * 30)}%, transparent)` }}
                    >
                      {pct(b)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 bg-sky px-4 py-3.5 text-sm">
        A <strong>${BUY}</strong> buy at launch costs a clean wallet <strong className="text-good">{atLaunch(0)}</strong>, a fresh wallet <strong className="text-warn">{atLaunch(1)}</strong> and a known sniper{' '}
        <strong className="text-bad">{atLaunch(2)}</strong>.
      </div>
      <Link href="/launch/frog" className="mt-5 inline-block font-mono text-xs font-medium uppercase tracking-[0.08em] no-underline">
        Watch a simulated launch ↗
      </Link>
    </div>
  );
}
