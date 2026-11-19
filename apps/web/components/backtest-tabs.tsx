'use client';
import { useState } from 'react';
import { LpFirstExplorer, type LpFirstData } from './lpfirst-explorer';
import { BacktestExplorer } from './backtest-explorer';

export function BacktestTabs({ lpfirst, maxDiscount }: { lpfirst: LpFirstData; maxDiscount: React.ComponentProps<typeof BacktestExplorer>['data'] }) {
  const [tab, setTab] = useState<'lp' | 'max'>('lp');
  const t = (id: 'lp' | 'max', label: string) => (
    <button role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-full border px-4 py-2 text-[13px] font-semibold ${tab === id ? 'border-accent bg-surface-2 text-ink' : 'border-line text-ink-2 hover:text-ink'}`}>{label}</button>
  );
  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Fee model" className="flex flex-wrap gap-2">
        {t('lp', 'LP-first (default)')}
        {t('max', 'Max retail discount (5 / 30 / 80)')}
      </div>
      {tab === 'lp' ? (
        <LpFirstExplorer data={lpfirst} />
      ) : (
        <>
          <p className="rounded-xl border border-dashed border-line bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-ink-2">
            The previous design: RETAIL 5 bps, STANDARD 30, TOXIC 80. Retail saves ~19 bps, but that discount is paid by LPs (roughly −$500/day on this pool). It stays available as an option for pools that want to
            attract retail flow and accept lower LP returns.
          </p>
          <BacktestExplorer data={maxDiscount} />
        </>
      )}
    </div>
  );
}
