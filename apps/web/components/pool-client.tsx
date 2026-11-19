'use client';
import { TierStack } from './charts';
import { usd } from '@/lib/format';

export function TierStackClient({ data }: { data: Array<{ day: string; RETAIL: number; STANDARD: number; TOXIC: number }> }) {
  return <TierStack data={data} fmt={(v) => usd(v)} />;
}

import { RegimeBars } from './charts';
import { usdCompact } from '@/lib/format';

export function UsdBars({ rows }: { rows: Array<{ regime: string; value: number }> }) {
  return <RegimeBars rows={rows} fmt={usdCompact} />;
}
