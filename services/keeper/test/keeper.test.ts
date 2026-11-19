import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { loadDataset } from '@fairway/fixtures/node';
import { fixtureMids } from '@fairway/fixtures';
import { listScores, openDb, recompute, upsertSwaps } from '@fairway/ingest';
import { discriminator, PROGRAM_ID } from '@fairway/sdk';
import { chunk, diffScores, DryRunSender, MirrorStore, runKeeper, type BatchSender, type DesiredScore, type OnchainScore } from '../src';

const pk = () => Keypair.generate().publicKey.toBase58();
const quiet = { batchSize: 8, maxTps: 1000, retries: 2, backoffMs: 1, log: () => {}, sleep: async () => {} };

describe('diffScores', () => {
  const a = pk();
  const b = pk();
  const c = pk();
  const d = pk();
  const desired: DesiredScore[] = [
    { trader: a, tier: 'RETAIL', scoreBps: 0.4, trades: 9 },
    { trader: b, tier: 'TOXIC', scoreBps: 33.6, trades: 50 },
    { trader: c, tier: 'STANDARD', scoreBps: 5, trades: 2 },
    { trader: d, tier: 'STANDARD', scoreBps: 1, trades: 3 },
  ];
  it('writes new non-STANDARD scores, skips unknown STANDARD, TOXIC first', () => {
    const u = diffScores(desired, new Map(), { currentSlot: 100n, ttlSlots: 1000n });
    expect(u.map((x) => [x.trader, x.tier, x.reason])).toEqual([
      [b, 2, 'new'],
      [a, 0, 'new'],
    ]);
    expect(u[0]!.scoreBps).toBe(34);
  });
  it('tier changes, downgrades and refreshes', () => {
    const on = new Map<string, OnchainScore | null>([
      [a, { tier: 0, scoreBps: 0, trades: 9, updatedSlot: 990n }], // fresh, same → nothing
      [b, { tier: 0, scoreBps: 0, trades: 5, updatedSlot: 990n }], // RETAIL → TOXIC
      [c, { tier: 2, scoreBps: 20, trades: 9, updatedSlot: 990n }], // TOXIC → STANDARD
    ]);
    const u = diffScores(desired, on, { currentSlot: 1000n, ttlSlots: 1000n });
    expect(u.map((x) => x.reason).sort()).toEqual(['downgrade-to-standard', 'tier-change']);
    const stale = diffScores(desired, on, { currentSlot: 1600n, ttlSlots: 1000n });
    expect(stale.find((x) => x.trader === a)?.reason).toBe('refresh');
  });
  it('skips onchain-verified wallets (the trustless score overrides the bootstrap)', () => {
    const on = new Map<string, OnchainScore | null>([
      [b, { tier: 0, scoreBps: 0, trades: 5, updatedSlot: 1n, onchainVerified: true }],
      [c, { tier: 2, scoreBps: 20, trades: 9, updatedSlot: 1n, onchainVerified: true }],
    ]);
    const u = diffScores(desired, on, { currentSlot: 5000n, ttlSlots: 1000n });
    expect(u.find((x) => x.trader === b || x.trader === c)).toBeUndefined();
  });
  it('chunk caps batches at 10', () => {
    expect(chunk([...Array(23).keys()], 50).map((x) => x.length)).toEqual([10, 10, 3]);
    expect(chunk([...Array(5).keys()], 2).map((x) => x.length)).toEqual([2, 2, 1]);
  });
});

describe('runKeeper', () => {
  it('retries failed batches with backoff and reports failures', async () => {
    let calls = 0;
    const flaky: BatchSender = {
      name: 'flaky',
      async send(_b, i) {
        calls++;
        if (calls % 2 === 1) throw new Error('blockhash expired');
        return { signature: `sig${i}`, dryRun: false };
      },
    };
    const dir = mkdtempSync(join(tmpdir(), 'kp-'));
    const desired: DesiredScore[] = Array.from({ length: 12 }, () => ({ trader: pk(), tier: 'TOXIC', scoreBps: 20, trades: 9 }));
    const sleeps: number[] = [];
    const rep = await runKeeper(desired, new MirrorStore(join(dir, 'm.json')), flaky, { ...quiet, maxTps: 1e9, batchSize: 5, sleep: async (ms) => void sleeps.push(ms) });
    expect(rep.batches.map((b) => b.attempts)).toEqual([2, 2, 2]);
    expect(rep.failed).toBe(0);
    expect(sleeps.filter((s) => s === 1).length).toBe(3); // one backoff per batch
    const dead: BatchSender = { name: 'dead', send: async () => Promise.reject(new Error('rpc down')) };
    const rep2 = await runKeeper(desired, new MirrorStore(join(dir, 'm2.json')), dead, quiet);
    expect(rep2.failed).toBe(2);
    expect(rep2.batches[0]!.attempts).toBe(3);
  });
  it('rate-limits to maxTps', async () => {
    let t = 0;
    const waits: number[] = [];
    const ok: BatchSender = { name: 'ok', send: async (_b, i) => ({ signature: `s${i}`, dryRun: true }) };
    const desired: DesiredScore[] = Array.from({ length: 30 }, () => ({ trader: pk(), tier: 'RETAIL', scoreBps: 0, trades: 9 }));
    const dir = mkdtempSync(join(tmpdir(), 'kp-'));
    await runKeeper(desired, new MirrorStore(join(dir, 'm.json')), ok, {
      ...quiet,
      batchSize: 10,
      maxTps: 2,
      now: () => t,
      sleep: async (ms) => {
        waits.push(ms);
        t += ms;
      },
    });
    expect(waits).toEqual([500, 500]);
  });
});

describe('end to end: fixtures → ingest DB → keeper dry-run', () => {
  it('logs exact set_scores_batch instructions and converges', async () => {
    const ds = loadDataset();
    const db = openDb(':memory:');
    upsertSwaps(db, ds.swaps);
    recompute(db, { name: 'fixture', provider: () => fixtureMids(ds.cex) });
    const desired = listScores(db, { limit: 10_000 }).map((s) => ({ trader: s.trader, tier: s.tier, scoreBps: s.scoreBps, trades: s.trades }));
    const dir = mkdtempSync(join(tmpdir(), 'kp-'));
    const store = new MirrorStore(join(dir, 'mirror.json'));
    const sender = new DryRunSender(dir, new PublicKey('11111111111111111111111111111111'), PROGRAM_ID, 'test');
    const rep = await runKeeper(desired, store, sender, quiet);
    const nonStandard = desired.filter((d) => d.tier !== 'STANDARD').length;
    expect(rep.updates).toBe(nonStandard);
    const lines = readFileSync(sender.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(Math.ceil(nonStandard / 8));
    const first = lines[0];
    expect(first.instruction).toBe('set_scores_batch');
    expect(Array.from(Buffer.from(first.dataBase64, 'base64').subarray(0, 8))).toEqual(Array.from(discriminator('global', 'set_scores_batch')));
    expect(first.accounts).toHaveLength(3 + first.entries.length);
    expect(first.entries[0].tier).toBe(2); // TOXIC first
    // apply to the mirror → a second run has nothing to do
    store.apply(rep.batches.flatMap((b) => b.items));
    store.save();
    const rep2 = await runKeeper(desired, new MirrorStore(join(dir, 'mirror.json')), sender, quiet);
    expect(rep2.updates).toBe(0);
  });
});
