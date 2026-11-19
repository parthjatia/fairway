import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBundles, loadPumpfun } from '@fairway/fixtures/node';
import { parseFundingPayload, parsePumpPayload, PUMP_PROGRAMS } from '@fairway/parser';
import { detectBundles, scoreSnipers } from '@fairway/scoring';
import { loadMain } from './build-filter';
import { renderPumpFilter } from './build-pumpfun-filter';

const src = readFileSync(join(__dirname, 'pumpfun-filter.js'), 'utf8');
const fx = loadPumpfun();
const main = loadMain(src) as unknown as (s: unknown) => { launchTrades: any[]; fundings: any[] } | null;

describe('streams/pumpfun-filter.js', () => {
  it('is up to date with packages/parser/src/pumpfun.ts (run build:filter)', () => {
    expect(src).toBe(renderPumpFilter());
  });
  it('is standalone: no imports/require/BigInt/Node globals', () => {
    for (const bad of [/\brequire\(/, /^\s*import\s/m, /^\s*export\s/m, /\bBigInt\b/, /\bBuffer\b/, /\bprocess\./]) expect(bad.test(src), String(bad)).toBe(false);
  });
  it('inlines the same program ids as the parser', () => {
    expect(src).toContain(`pumpfun: '${PUMP_PROGRAMS.pumpfun}'`);
    expect(src).toContain(`pumpswap: '${PUMP_PROGRAMS.pumpswap}'`);
  });
  it('returns identical output to the parser, block by block, and null on empty blocks', () => {
    expect(main({ data: fx.blocks })!.launchTrades).toEqual(parsePumpPayload(fx.blocks));
    const streamed = fx.blocks.flatMap((b: any) => main({ data: [b] })?.launchTrades ?? []);
    expect(streamed).toEqual(fx.expected);
    expect(main({ data: [] })).toBeNull();
    expect(main({ data: fx.blocks })!.fundings).toEqual([]); // the Pump.fun fixture has no wallet fundings
  });
  it('emits wallet fundings identical to the parser, and they detect the fixture bundles end to end', () => {
    const bx = loadBundles();
    const out = main({ data: bx.blocks })!;
    expect(out.fundings).toEqual(parseFundingPayload(bx.blocks));
    expect(out.fundings).toEqual(bx.expectedFundings);
    const streamed = bx.blocks.flatMap((b: any) => main({ data: [b] })?.fundings ?? []);
    expect(streamed).toEqual(bx.expectedFundings);
    const rep = detectBundles(out.launchTrades, out.fundings);
    expect(rep.bundles.map((b) => ({ mint: b.mint, funder: b.funder, wallets: b.wallets }))).toEqual(bx.meta.bundles);
  });
  it('end to end: filter output → sniper scores flags every recurring sniper', () => {
    const scores = scoreSnipers(main({ data: fx.blocks })!.launchTrades);
    const toxic = new Set(scores.filter((s) => s.tier === 'TOXIC').map((s) => s.wallet));
    expect(toxic).toEqual(new Set(fx.meta.snipers));
  });
});
