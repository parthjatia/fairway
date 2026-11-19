import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base58Decode, base58Encode, buildDataset, generateMarket, gbmPath, Rng, SWAP_EXECUTED_DISCRIMINATOR, arbTrade, poolPrice } from '../src';
import { buildBlocks } from '../src/node';

const small = { days: 0.5, nRetail: 30 };

describe('rng + gbm', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(1);
    const b = new Rng(1);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    expect(Array.from(gbmPath({ seed: 3, s0: 100, steps: 50, stepSec: 1, annualVol: 0.6 }))).toEqual(
      Array.from(gbmPath({ seed: 3, s0: 100, steps: 50, stepSec: 1, annualVol: 0.6 })),
    );
  });
  it('gbm has roughly the requested volatility', () => {
    const steps = 200_000;
    const p = gbmPath({ seed: 9, s0: 100, steps, stepSec: 1, annualVol: 0.6 });
    let ss = 0;
    for (let i = 1; i <= steps; i++) ss += Math.log(p[i]! / p[i - 1]!) ** 2;
    const annual = Math.sqrt((ss / steps) * 365 * 86_400);
    expect(annual).toBeGreaterThan(0.57);
    expect(annual).toBeLessThan(0.63);
  });
});

describe('base58 + event discriminator', () => {
  it('round-trips', () => {
    const r = new Rng(5);
    for (let i = 0; i < 20; i++) {
      const b = r.bytes(32);
      expect(Array.from(base58Decode(base58Encode(b)))).toEqual(Array.from(b));
    }
    expect(base58Encode(new Uint8Array(32))).toBe('11111111111111111111111111111111');
  });
  it('discriminator = sha256("event:SwapExecuted")[0..8]', () => {
    const d = createHash('sha256').update('event:SwapExecuted').digest().subarray(0, 8);
    expect(Array.from(SWAP_EXECUTED_DISCRIMINATOR)).toEqual(Array.from(d));
  });
});

describe('arb sizing', () => {
  it('moves the pool exactly to the no-arb boundary', () => {
    const r = { base: 10_000, quote: 1_500_000 };
    const t = arbTrade(r, 160, 30)!;
    expect(t.side).toBe('buy');
    const out = (t.inAfterFee * r.base) / (r.quote + t.inAfterFee);
    const after = { base: r.base - out, quote: r.quote + t.inAfterFee };
    expect(poolPrice(after)).toBeCloseTo(160 * (1 - 0.003), 6);
    expect(arbTrade(r, 150, 30)).toBeNull();
    expect(arbTrade(r, 140, 30)!.side).toBe('sell');
  });
});

describe('market + dataset', () => {
  const m1 = generateMarket(small);
  it('is deterministic', () => {
    const m2 = generateMarket(small);
    expect(m2.swaps).toEqual(m1.swaps);
    expect(m2.cex.prices).toEqual(m1.cex.prices);
  });
  it('produces sane swaps with non-decreasing slots', () => {
    expect(m1.swaps.length).toBeGreaterThan(500);
    for (let i = 1; i < m1.swaps.length; i++) expect(m1.swaps[i]!.slot).toBeGreaterThanOrEqual(m1.swaps[i - 1]!.slot);
    for (const s of m1.swaps) {
      expect(s.baseAmount).toBeGreaterThan(0);
      expect(s.quoteAmount).toBeGreaterThan(0);
      expect(Math.abs(s.execPrice / 150 - 1)).toBeLessThan(0.3);
    }
    const classes = new Set(Object.values(m1.swapClass));
    expect(classes).toEqual(new Set(['retail', 'arb', 'sniper', 'new']));
  });
  it('full dataset personas land in their expected tiers', () => {
    const { dataset, scores } = buildDataset(generateMarket());
    const tierOf = new Map(scores.map((s) => [s.trader, s.tier]));
    for (const p of dataset.meta.personas) expect(tierOf.get(p.address) ?? 'STANDARD').toBe(p.expectedTier);
    expect(dataset.meta.confusion.arb).toEqual({ TOXIC: 3 });
    expect(dataset.meta.confusion.retail!.RETAIL!).toBeGreaterThan(90);
  });
});

describe('getBlock-shaped blocks', () => {
  const m = generateMarket(small);
  const fx = buildBlocks(m, { count: 200 });
  it('contains every expected swap tx and all edge cases', () => {
    const sigs = new Set(fx.blocks.flatMap((b) => b.transactions.map((t) => t.transaction.signatures[0])));
    for (const s of fx.expected) expect(sigs.has(s.sig)).toBe(true);
    const kinds = new Set(fx.edgeCases.map((e) => e.kind));
    for (const k of ['failed', 'liquidity-add', 'liquidity-remove', 'unrelated-transfer', 'vote']) expect(kinds.has(k as never)).toBe(true);
    expect(fx.blocks.some((b) => b.transactions.some((t) => t.version === 0 && (t.meta?.loadedAddresses?.writable.length ?? 0) > 0))).toBe(true);
  });
  it('vault balances chain consistently across blocks', () => {
    const last = new Map<string, string>();
    for (const b of fx.blocks) {
      for (const t of b.transactions) {
        if (!t.meta) continue;
        const keys = [
          ...t.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey)),
          ...(t.meta.loadedAddresses?.writable ?? []),
          ...(t.meta.loadedAddresses?.readonly ?? []),
        ];
        for (const pre of t.meta.preTokenBalances) {
          const acc = keys[pre.accountIndex]!;
          const isVault = m.pools.some((p) => p.baseVault === acc || p.quoteVault === acc);
          if (!isVault) continue;
          if (last.has(acc)) expect(pre.uiTokenAmount.amount).toBe(last.get(acc));
          const post = t.meta.postTokenBalances.find((x) => x.accountIndex === pre.accountIndex)!;
          if (!t.meta.err) last.set(acc, post.uiTokenAmount.amount);
        }
      }
    }
    expect(last.size).toBeGreaterThan(0);
  });
});
