import { describe, expect, it } from 'vitest';
import { loadBlocks, loadDataset } from '@fairway/fixtures/node';
import { accountKeysOf, base64ToBytes, blocksFromPayload, bytesToBase58, decodeSwapEvents, parseBlock, parsePayload, parseToSwaps, toParserPools } from '../src';
import { base58Decode, base58Encode, encodeSwapExecuted } from '@fairway/fixtures';

const ds = loadDataset();
const fx = loadBlocks();
const pools = toParserPools(ds.meta.pools);
const parsed = parsePayload(fx.blocks, pools);
const bySig = new Map(parsed.map((s) => [s.sig, s]));
const edge = new Map(fx.edgeCases.map((e) => [e.sig, e.kind]));

describe('parser vs fixture ground truth', () => {
  it('finds exactly the expected swaps, in order', () => {
    expect(parsed.map((s) => s.sig)).toEqual(fx.expected.map((s) => s.sig));
  });
  it('reproduces side, amounts, trader, slot, ts and pre-fee price', () => {
    const noEvent = new Set(fx.edgeCases.filter((e) => e.kind === 'fairway-no-event').map((e) => e.sig));
    for (const e of fx.expected) {
      const p = bySig.get(e.sig)!;
      expect(p.side).toBe(e.side);
      expect(p.trader).toBe(e.trader);
      expect(p.pool).toBe(e.pool);
      expect(p.venue).toBe(e.venue);
      expect(p.slot).toBe(e.slot);
      expect(p.ts).toBe(e.ts);
      expect(p.baseAmount).toBeCloseTo(e.baseAmount, 9);
      expect(p.quoteAmount).toBeCloseTo(e.quoteAmount, 6);
      if (noEvent.has(e.sig)) {
        // no event → configured fee approximation (within the fee difference)
        expect(p.source).toBe('vault-delta');
        expect(Math.abs(p.execPrice / e.execPrice - 1)).toBeLessThan(0.01);
      } else {
        expect(p.execPrice / e.execPrice - 1).toBeCloseTo(0, 8);
        expect(p.feeBps).toBe(e.feeBps);
      }
    }
  });
  it('uses the SwapExecuted event (fee + tier) for Fairway swaps', () => {
    const fw = parsed.filter((s) => s.venue === 'fairway' && s.source === 'event');
    expect(fw.length).toBeGreaterThan(5);
    for (const s of fw) {
      const e = fx.expected.find((x) => x.sig === s.sig)!;
      expect(s.tier).toBe(e.tier);
    }
  });
  it('ignores every non-swap edge case', () => {
    for (const [sig, kind] of edge) if (kind !== 'fairway-no-event') expect(bySig.has(sig), kind).toBe(false);
    expect(new Set(fx.edgeCases.map((e) => e.kind)).size).toBeGreaterThanOrEqual(5);
  });
  it('parses v0 transactions whose vaults come from address lookup tables', () => {
    const orca = parsed.filter((s) => s.venue === 'orca');
    expect(orca.length).toBeGreaterThan(10);
  });
});

describe('building blocks', () => {
  it('account keys: strings, {pubkey} objects and loaded addresses', () => {
    const tx = {
      transaction: { message: { accountKeys: ['A', { pubkey: 'B' }] } },
      meta: { loadedAddresses: { writable: ['C'], readonly: ['D'] } },
    };
    expect(accountKeysOf(tx)).toEqual(['A', 'B', 'C', 'D']);
  });
  it('base64/base58 helpers match Node', () => {
    const bytes = [0, 0, 1, 2, 250, 99, 7];
    expect(base64ToBytes(Buffer.from(bytes).toString('base64'))).toEqual(bytes);
    const k = base58Decode('8jo3xry2rp9rQHwPCyh8c9Qwnw2HHa5JvAUiXHo2XPXk');
    expect(bytesToBase58(Array.from(k))).toBe(base58Encode(k));
  });
  it('decodes SwapExecuted with large u64 amounts', () => {
    const trader = base58Encode(new Uint8Array(32).fill(7));
    const ev = encodeSwapExecuted({ trader, pool: trader, aToB: false, amountIn: 2n ** 52n + 5n, amountOut: 123n, feeBps: 5, tier: 0 });
    const d = decodeSwapEvents([`Program data: ${ev}`, 'Program data: !!!', 'Program log: x'])!;
    expect(d).toEqual([{ trader, pool: trader, aToB: false, amountIn: 2 ** 52 + 5, amountOut: 123, feeBps: 5, tier: 0 }]);
  });
  it('payload shapes: array, nested, {data}, single block; dedupes on sig+pool', () => {
    const b = fx.blocks[0]!;
    expect(blocksFromPayload([b])).toHaveLength(1);
    expect(blocksFromPayload([[b]])).toHaveLength(1);
    expect(blocksFromPayload({ data: [b] })).toHaveLength(1);
    expect(blocksFromPayload(b)).toHaveLength(1);
    expect(parsePayload([b, b], pools)).toEqual(parseBlock(b, pools));
    expect(parsePayload(null, pools)).toEqual([]);
  });
  it('huge vault balances (> 2^53 raw) still give exact deltas', () => {
    const pool = pools[0]!;
    const mk = (amount: string, idx: number) => ({ accountIndex: idx, uiTokenAmount: { amount, decimals: idx === 1 ? 9 : 6 } });
    const tx = {
      transaction: { signatures: ['S'], message: { accountKeys: ['T', pool.baseVault, pool.quoteVault] } },
      meta: {
        err: null,
        preTokenBalances: [mk('123456789012345678', 1), mk('900000000000000000', 2)],
        postTokenBalances: [mk('123456788012345678', 1), mk('900000000150000000', 2)],
      },
    };
    const s = parseBlock({ parentSlot: 9, blockTime: 1, transactions: [tx] }, pools)[0]!;
    expect(s).toMatchObject({ side: 'buy', slot: 10, baseAmount: 1, quoteAmount: 150 });
  });
  it('parseToSwaps returns canonical Swap records (no parser-only fields)', () => {
    const s = parseToSwaps(fx.blocks.slice(0, 3), pools);
    expect(s.length).toBeGreaterThan(0);
    expect('source' in s[0]!).toBe(false);
  });
});
