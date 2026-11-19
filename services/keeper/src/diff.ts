import type { Tier } from '@fairway/scoring';
import { toOnchainScore } from '@fairway/scoring';

export type DesiredScore = { trader: string; tier: Tier; scoreBps: number; trades: number };
export type OnchainScore = { tier: 0 | 1 | 2; scoreBps: number; trades: number; updatedSlot: bigint };
export type Update = { trader: string; tier: 0 | 1 | 2; scoreBps: number; trades: number; reason: 'new' | 'tier-change' | 'refresh' | 'downgrade-to-standard' };

export type DiffOptions = {
  currentSlot: bigint;
  ttlSlots: bigint;
  /** refresh non-STANDARD scores once they are older than this fraction of the TTL (default 0.5) */
  refreshFraction?: number;
};

const PRIORITY: Record<number, number> = { 2: 0, 0: 1, 1: 2 }; // TOXIC first (protects LPs), then RETAIL, then STANDARD

/**
 * Decide which onchain scores to write.
 *  - wallet unknown onchain and desired STANDARD → skip (missing account already means STANDARD; saves rent)
 *  - wallet unknown onchain and desired RETAIL/TOXIC → write ('new')
 *  - tier differs → write ('tier-change', or 'downgrade-to-standard')
 *  - same non-STANDARD tier but older than refreshFraction × TTL → write ('refresh') so it never goes stale
 */
export function diffScores(desired: DesiredScore[], onchain: Map<string, OnchainScore | null>, o: DiffOptions): Update[] {
  const refreshAfter = BigInt(Math.floor(Number(o.ttlSlots) * (o.refreshFraction ?? 0.5)));
  const out: Update[] = [];
  for (const d of desired) {
    const want = toOnchainScore(d);
    const cur = onchain.get(d.trader) ?? null;
    if (!cur) {
      if (want.tier !== 1) out.push({ trader: d.trader, ...want, reason: 'new' });
      continue;
    }
    if (cur.tier !== want.tier) {
      out.push({ trader: d.trader, ...want, reason: want.tier === 1 ? 'downgrade-to-standard' : 'tier-change' });
      continue;
    }
    if (want.tier !== 1 && o.currentSlot - cur.updatedSlot > refreshAfter) out.push({ trader: d.trader, ...want, reason: 'refresh' });
  }
  out.sort((a, b) => PRIORITY[a.tier]! - PRIORITY[b.tier]! || (a.trader < b.trader ? -1 : 1));
  return out;
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const size = Math.max(1, Math.min(10, n));
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
