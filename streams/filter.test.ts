import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBlocks, loadDataset } from '@fairway/fixtures/node';
import { parsePayload, toParserPools } from '@fairway/parser';
import { configuredPools, loadMain, renderFilter, withPools } from './build-filter';

const src = readFileSync(join(__dirname, 'filter.js'), 'utf8');
const ds = loadDataset();
const fx = loadBlocks();
const pools = toParserPools(ds.meta.pools);

describe('streams/filter.js', () => {
  it('is up to date with packages/parser/src/core.ts (run build:filter)', () => {
    expect(src).toBe(renderFilter(configuredPools()));
  });
  it('is standalone: no imports/require/BigInt/Node globals', () => {
    for (const bad of [/\brequire\(/, /^\s*import\s/m, /^\s*export\s/m, /\bBigInt\b/, /\bBuffer\b/, /\bprocess\./, /\batob\(/]) expect(bad.test(src), String(bad)).toBe(false);
    expect(src).toMatch(/function main\(stream\)/);
  });
  it('returns identical output to the parser on fixture blocks', () => {
    const main = loadMain(withPools(src, pools));
    const res = main({ data: fx.blocks, metadata: { dataset: 'block', network: 'solana-mainnet' } })!;
    expect(res.swaps).toEqual(parsePayload(fx.blocks, pools));
    expect(res.swaps.length).toBe(fx.expected.length);
  });
  it('works block-by-block like a live stream and returns null when nothing matches', () => {
    const main = loadMain(withPools(src, pools));
    let total = 0;
    let nulls = 0;
    for (const b of fx.blocks) {
      const r = main({ data: [b] });
      if (r) total += r.swaps.length;
      else nulls++;
    }
    expect(total).toBe(fx.expected.length);
    expect(main({ data: [] })).toBeNull();
    // blocks containing only edge cases or other pools → null
    expect(loadMain(withPools(src, []))({ data: fx.blocks })).toBeNull();
    expect(nulls).toBeGreaterThanOrEqual(0);
  });
  it('the shipped config skips placeholder pools', () => {
    const main = loadMain(src);
    expect(main({ data: fx.blocks })).toBeNull();
  });
});
