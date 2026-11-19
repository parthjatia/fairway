import { describe, expect, it } from 'vitest';
import { bundleTier, DEFAULT_BUNDLE_CONFIG, detectBundles, type BundleLaunchTrade, type FundingTransfer } from '../src';

describe('bundle rules', () => {
  const t = (slot: number, mint: string, trader: string, kind: BundleLaunchTrade['kind'] = 'buy'): BundleLaunchTrade => ({ slot, mint, trader, kind });
  const f = (slot: number, funder: string, wallet: string): FundingTransfer => ({ sig: `${funder}-${wallet}-${slot}`, slot, funder, wallet, sol: 1 });
  it('lookback window, early-buy window and minimum wallets are respected', () => {
    const trades = [t(1_000, 'm', 'c', 'create'), t(1_001, 'm', 'a'), t(1_002, 'm', 'b'), t(1_030, 'm', 'late')];
    expect(detectBundles(trades, [f(900, 'F', 'a'), f(950, 'F', 'b')]).bundles).toHaveLength(1);
    // funded 1 slot too early for the default 1,500-slot lookback
    expect(detectBundles(trades, [f(1_000 - DEFAULT_BUNDLE_CONFIG.lookbackSlots - 1, 'F', 'a'), f(950, 'F', 'b')]).bundles).toHaveLength(0);
    // the second wallet bought after the early window (25 slots): one early wallet is not a bundle
    expect(detectBundles(trades, [f(900, 'F', 'a'), f(950, 'F', 'late')]).bundles).toHaveLength(0);
    // funding in the slot of the buy still counts (bundle in one block); after the buy it does not
    expect(detectBundles(trades, [f(1_001, 'F', 'a'), f(1_002, 'F', 'b')]).bundles).toHaveLength(1);
    expect(detectBundles(trades, [f(1_003, 'F', 'a'), f(1_003, 'F', 'b')]).bundles).toHaveLength(0);
  });
  it('a launch without a captured create uses its first trade as the launch slot', () => {
    expect(detectBundles([t(500, 'm', 'a'), t(501, 'm', 'b')], [f(400, 'F', 'a'), f(401, 'F', 'b')]).bundles[0]).toMatchObject({ launchSlot: 500 });
  });
  it('bundleTier: never below STANDARD, TOXIC for a known bundler or a TOXIC sniper funder, never lowers a tier', () => {
    expect(bundleTier('RETAIL', false)).toBe('STANDARD');
    expect(bundleTier('STANDARD', false)).toBe('STANDARD');
    expect(bundleTier('STANDARD', true)).toBe('TOXIC');
    expect(bundleTier('RETAIL', false, 'TOXIC')).toBe('TOXIC');
    expect(bundleTier('TOXIC', false)).toBe('TOXIC');
  });
  it('is deterministic and order-independent', () => {
    const tr = [t(1_000, 'm', 'c', 'create'), t(1_001, 'm', 'a'), t(1_002, 'm', 'b'), t(2_000, 'n', 'c', 'create'), t(2_001, 'n', 'x'), t(2_001, 'n', 'y')];
    const fu = [f(900, 'F', 'a'), f(950, 'F', 'b'), f(1_990, 'F', 'x'), f(1_991, 'F', 'y'), f(2_500, 'F', 'fresh')];
    const rep = detectBundles(tr, fu);
    expect(rep.funders).toEqual([{ funder: 'F', launches: 2, wallets: 4, knownBundler: true }]);
    expect(rep.flags.find((x) => x.wallet === 'fresh')).toMatchObject({ reason: 'known-bundler-funding' });
    expect(detectBundles([...tr].reverse(), [...fu].reverse())).toEqual(rep);
  });
});
