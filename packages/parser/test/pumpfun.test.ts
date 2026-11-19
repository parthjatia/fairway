import { describe, expect, it } from 'vitest';
import { loadPumpfun } from '@fairway/fixtures/node';
import { scoreSnipers } from '@fairway/scoring';
import { parsePumpPayload, parsePumpTransaction, PUMP_PROGRAMS } from '../src';

const fx = loadPumpfun();

describe('Pump.fun / PumpSwap parser', () => {
  it('uses the verified mainnet program ids, same as the fixture', () => {
    expect(PUMP_PROGRAMS).toEqual(fx.programs);
    // Verified onchain 2026-11-19: the code must use exactly these.
    expect(PUMP_PROGRAMS).toEqual({ pumpfun: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', pumpswap: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' });
  });
  it('extracts exactly the expected launch trades from fixture blocks', () => {
    expect(parsePumpPayload(fx.blocks)).toEqual(fx.expected);
  });
  it('handles the edge cases', () => {
    const all = fx.blocks.flatMap((b: any) => b.transactions.map((t: any) => ({ t, slot: b.parentSlot + 1, ts: b.blockTime })));
    const bySig = (s: string) => all.find((x: any) => x.t.transaction.signatures[0] === s)!;
    for (const e of fx.meta.edgeCases) {
      const { t, slot, ts } = bySig(e.sig);
      const r = parsePumpTransaction(t, slot, ts);
      if (e.kind === 'failed' || e.kind === 'non-pump') expect(r, e.kind).toEqual([]);
      if (e.kind === 'create-no-dev-buy') expect(r.map((x) => x.kind)).toEqual(['create']);
      if (e.kind === 'alt-loaded') expect(r[0]!.solAmount).toBeGreaterThan(0); // curve account came from loadedAddresses
      if (e.kind === 'pumpswap') expect(r[0]).toMatchObject({ venue: 'pumpswap', kind: 'buy', solAmount: 0.5 });
    }
    expect(new Set(fx.meta.edgeCases.map((e) => e.kind))).toEqual(new Set(['failed', 'non-pump', 'alt-loaded', 'create-no-dev-buy', 'pumpswap']));
  });
  it('accepts Streams wrappers and de-duplicates', () => {
    expect(parsePumpPayload({ data: [fx.blocks, fx.blocks] })).toEqual(fx.expected);
  });
});

describe('cross-launch sniper scoring', () => {
  const scores = scoreSnipers(parsePumpPayload(fx.blocks));
  const tier = (w: string) => scores.find((s) => s.wallet === w)?.tier ?? 'none';
  it('recurring snipers (buy in the first slots, gain right after) score TOXIC', () => {
    for (const w of fx.meta.snipers) expect(tier(w), w).toBe('TOXIC');
  });
  it('one lucky early buy is not enough; retail is never TOXIC', () => {
    expect(tier(fx.meta.luckyEarly)).toBe('STANDARD');
    for (const w of fx.meta.retail) expect(tier(w)).not.toBe('TOXIC');
  });
  it('snipers entered within a few slots of the launch across ≥ 3 launches', () => {
    for (const w of fx.meta.snipers) {
      const s = scores.find((x) => x.wallet === w)!;
      expect(s.launches).toBeGreaterThanOrEqual(3);
      expect(s.meanEntrySlot).toBeLessThan(4);
    }
  });
});
