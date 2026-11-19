import { describe, expect, it } from 'vitest';
import { loadBundles, loadPumpfun } from '@fairway/fixtures/node';
import { detectBundles } from '@fairway/scoring';
import { parseFundingPayload, parseFundingTransaction, parseLaunchStream, parsePumpPayload } from '../src';

const fx = loadBundles();

describe('wallet funding parser (bundle detection input)', () => {
  it('extracts exactly the expected fundings of brand-new wallets', () => {
    expect(parseFundingPayload(fx.blocks)).toEqual(fx.expectedFundings);
  });
  it('handles the edge cases', () => {
    const all = fx.blocks.flatMap((b: any) => b.transactions.map((t: any) => ({ t, slot: b.parentSlot + 1, ts: b.blockTime })));
    const bySig = (s: string) => all.find((x: any) => x.t.transaction.signatures[0] === s)!;
    const out = (sig: string) => {
      const { t, slot, ts } = bySig(sig);
      return parseFundingTransaction(t, slot, ts);
    };
    for (const e of fx.meta.edgeCases) {
      const n = out(e.sig).length;
      if (e.kind === 'existing-wallet' || e.kind === 'other-program' || e.kind === 'failed' || e.kind === 'dust') expect(n, e.kind).toBe(0);
      else expect(n, e.kind).toBeGreaterThan(0); // alt-recipient, compute-budget and the timing cases are real fundings
    }
  });
  it('ignores Pump.fun trades and other transactions', () => {
    expect(parseFundingPayload(loadPumpfun().blocks)).toEqual([]);
  });
  it('the Stream L entry returns both record kinds, or null when there are none', () => {
    const o = parseLaunchStream(fx.blocks)!;
    expect(o.fundings).toEqual(fx.expectedFundings);
    expect(o.launchTrades).toEqual(parsePumpPayload(fx.blocks));
    expect(o.launchTrades.filter((t) => t.kind === 'create').map((t) => t.mint)).toEqual(fx.meta.launches.map((l) => l.mint));
    expect(parseLaunchStream([])).toBeNull();
  });
});

describe('bundle detection on the fixture', () => {
  const fx = loadBundles();
  const rep = detectBundles(parsePumpPayload(fx.blocks), parseFundingPayload(fx.blocks));
  it('finds exactly the three bundles of funder F', () => {
    expect(rep.bundles.map((b) => ({ mint: b.mint, funder: b.funder, wallets: b.wallets }))).toEqual(fx.meta.bundles);
  });
  it('F is a known bundler after two bundled launches; the edge-case funders are not', () => {
    expect(rep.funders.filter((f) => f.knownBundler).map((f) => f.funder)).toEqual([fx.meta.bundler]);
    expect(rep.funders.find((f) => f.funder === fx.meta.bundler)).toMatchObject({ launches: 3, wallets: 10 });
  });
  it('flags every bundle wallet and pre-emptively flags new wallets funded by the known bundler', () => {
    const flags = new Map(rep.flags.map((f) => [f.wallet, f]));
    for (const b of fx.meta.bundles) for (const w of b.wallets) expect(flags.get(w)?.reason).toBe('bundle');
    for (const w of fx.meta.preemptive) expect(flags.get(w)).toMatchObject({ reason: 'known-bundler-funding', funder: fx.meta.bundler, mint: null });
    for (const w of fx.meta.notFlagged) expect(flags.has(w), w).toBe(false);
    expect(rep.flags.length).toBe(10 + fx.meta.preemptive.length);
  });
});

