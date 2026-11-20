'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { loadMyLaunches } from '@/lib/client/launch-store';
import type { LaunchSpec } from '@/lib/launches';
import { usd } from '@/lib/format';
import { Card } from './ui';

/** Demo launches plus the ones you created in this browser (mock mode). */
export function LaunchList({ demo }: { demo: LaunchSpec[] }) {
  const [mine, setMine] = useState<LaunchSpec[]>([]);
  useEffect(() => setMine(loadMyLaunches()), []);
  const all = [...mine, ...demo];
  return (
    <Card title="Launches" subtitle="Open one to watch it play out: buyers, tiers, fees and the sniper share of supply.">
      <ul className="divide-y divide-line">
        {all.map((l) => (
          <li key={l.id}>
            <Link href={`/launch/${l.id}`} className="flex items-center justify-between gap-3 py-3 hover:opacity-80">
              <div>
                <div className="text-base font-semibold text-ink">
                  {l.name} <span className="text-muted">${l.symbol}</span>
                  {l.createdBy === 'you' && <span className="ml-2 rounded-[3px] border border-line bg-surface-2 px-2 py-0.5 text-xs font-semibold text-accent">yours</span>}
                </div>
                <div className="text-xs text-ink-2">
                  {usd(l.liquidityUsd)} liquidity · {l.windowMin}-min window
                </div>
              </div>
              <span className="text-sm font-semibold text-accent">Watch →</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
