import type { DesiredScore, Update } from './diff';
import { chunk, diffScores } from './diff';
import type { BatchSender } from './senders';
import type { ScoreStore } from './stores';

export type KeeperOptions = {
  batchSize: number;
  /** max transactions per second */
  maxTps: number;
  retries: number;
  /** base backoff in ms (doubles each retry) */
  backoffMs: number;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type BatchReport = { index: number; size: number; items: Update[]; byTier: Record<string, number>; signature?: string; attempts: number; error?: string };
export type RunReport = { desired: number; updates: number; reasons: Record<string, number>; batches: BatchReport[]; failed: number; mode: string };

const TIER_NAME = ['RETAIL', 'STANDARD', 'TOXIC'];

export async function runKeeper(desired: DesiredScore[], store: ScoreStore, sender: BatchSender, o: KeeperOptions): Promise<RunReport & { planned: Update[] }> {
  const log = o.log ?? ((l: string) => console.log(l));
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now ?? (() => Date.now());
  const [slot, ttl, onchain] = await Promise.all([store.currentSlot(), store.ttlSlots(), store.fetch(desired.map((d) => d.trader))]);
  const updates = diffScores(desired, onchain, { currentSlot: slot, ttlSlots: ttl });
  const reasons: Record<string, number> = {};
  for (const u of updates) reasons[u.reason] = (reasons[u.reason] ?? 0) + 1;
  log(`keeper[${sender.name}] ${desired.length} scored wallets → ${updates.length} updates ${JSON.stringify(reasons)} (slot ${slot}, ttl ${ttl})`);
  const batches = chunk(updates, o.batchSize);
  const reports: BatchReport[] = [];
  const minGap = 1000 / Math.max(0.1, o.maxTps);
  let last = -Infinity;
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i]!;
    const byTier: Record<string, number> = {};
    for (const u of b) byTier[TIER_NAME[u.tier]!] = (byTier[TIER_NAME[u.tier]!] ?? 0) + 1;
    const rep: BatchReport = { index: i + 1, size: b.length, items: b, byTier, attempts: 0 };
    for (let attempt = 0; attempt <= o.retries; attempt++) {
      const wait = last + minGap - now();
      if (wait > 0) await sleep(wait); // rate limit
      last = now();
      rep.attempts = attempt + 1;
      try {
        const r = await sender.send(b, i + 1);
        rep.signature = r.signature;
        rep.error = undefined;
        break;
      } catch (e) {
        rep.error = (e as Error).message;
        if (attempt < o.retries) await sleep(o.backoffMs * 2 ** attempt);
      }
    }
    reports.push(rep);
    log(
      `batch ${rep.index}/${batches.length}: ${rep.size} scores ${JSON.stringify(byTier)} → ${rep.error ? `FAILED after ${rep.attempts} attempts: ${rep.error}` : `${rep.signature}${rep.attempts > 1 ? ` (attempt ${rep.attempts})` : ''}`}`,
    );
  }
  return { desired: desired.length, updates: updates.length, reasons, batches: reports, failed: reports.filter((r) => r.error).length, mode: sender.name, planned: updates };
}
