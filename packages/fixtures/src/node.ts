/** Node-only helpers: read/write the generated fixture files. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BlocksFixture } from './blocks';
import { buildBlocks } from './blocks';
import type { CexPath } from './market';
import { generateMarket } from './market';
import type { Dataset, FixtureMeta } from './dataset';
import { buildDataset } from './dataset';
import type { Swap } from '@fairway/scoring';
import type { MemecoinMarket } from './memecoin';
import { generateMemecoinMarket } from './memecoin';
import { generatePumpfunFixture, type PumpFixture } from './pumpfun';
import { generateBundleFixture, type BundleFixture } from './bundles';

export { buildBlocks };

export const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const FILES = ['meta.json', 'cex.json', 'swaps.json', 'blocks.json', 'blocks.expected.json'] as const;

export function fixturesExist(dir = FIXTURE_DIR): boolean {
  return FILES.every((f) => existsSync(join(dir, f)));
}

export function generateFixtures(dir = FIXTURE_DIR, opts: { fairwayProgramId?: string } = {}): { swaps: number; blocks: number } {
  const market = generateMarket({}, opts.fairwayProgramId);
  const { dataset } = buildDataset(market);
  const blocks = buildBlocks(market, { count: 300 });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(dataset.meta, null, 2));
  writeFileSync(join(dir, 'cex.json'), JSON.stringify(dataset.cex));
  writeFileSync(join(dir, 'swaps.json'), JSON.stringify(dataset.swaps));
  writeFileSync(join(dir, 'blocks.json'), JSON.stringify(blocks.blocks));
  writeFileSync(join(dir, 'blocks.expected.json'), JSON.stringify({ expected: blocks.expected, edgeCases: blocks.edgeCases }, null, 1));
  return { swaps: dataset.swaps.length, blocks: blocks.blocks.length };
}

/** Writes data/memecoin.json (BONK-test pool). Reads meta.json for the wallets/personas, never touches the other files. */
export function generateMemecoin(dir = FIXTURE_DIR, opts: { fairwayProgramId?: string } = {}): { swaps: number } {
  const meta = read<FixtureMeta>(dir, 'meta.json');
  const m = generateMemecoinMarket({
    start: meta.start,
    days: Math.round((meta.end - meta.start) / 86_400),
    stepSec: meta.market.stepSec,
    baseSlot: meta.market.baseSlot,
    fees: meta.market.fairwayFees,
    wallets: meta.wallets,
    fairwayProgramId: opts.fairwayProgramId,
  });
  writeFileSync(join(dir, 'memecoin.json'), JSON.stringify(m));
  return { swaps: m.swaps.length };
}

export function loadMemecoin(dir = FIXTURE_DIR): MemecoinMarket {
  if (!existsSync(join(dir, 'memecoin.json'))) generateMemecoin(dir);
  return read<MemecoinMarket>(dir, 'memecoin.json');
}

export function ensureFixtures(dir = FIXTURE_DIR): void {
  if (!fixturesExist(dir)) generateFixtures(dir);
}

const read = <T>(dir: string, f: string): T => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T;

export function loadDataset(dir = FIXTURE_DIR): Dataset {
  ensureFixtures(dir);
  return { meta: read<FixtureMeta>(dir, 'meta.json'), cex: read<CexPath>(dir, 'cex.json'), swaps: read<Swap[]>(dir, 'swaps.json') };
}

export function loadBlocks(dir = FIXTURE_DIR): BlocksFixture {
  ensureFixtures(dir);
  const exp = read<{ expected: Swap[]; edgeCases: BlocksFixture['edgeCases'] }>(dir, 'blocks.expected.json');
  return { blocks: read<BlocksFixture['blocks']>(dir, 'blocks.json'), expected: exp.expected, edgeCases: exp.edgeCases };
}

/** Writes data/pumpfun.json (M16 Pump.fun launch blocks). Additive: no other fixture file is touched. */
export function generatePumpfun(dir = FIXTURE_DIR): { blocks: number; trades: number } {
  const f = generatePumpfunFixture();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pumpfun.json'), JSON.stringify(f));
  return { blocks: f.blocks.length, trades: f.expected.length };
}

export function loadPumpfun(dir = FIXTURE_DIR): PumpFixture {
  if (!existsSync(join(dir, 'pumpfun.json'))) generatePumpfun(dir);
  return read<PumpFixture>(dir, 'pumpfun.json');
}

/** Writes data/bundles.json (M16 step 11: launches + fundings for bundle detection). Additive: no other fixture file is touched. */
export function generateBundles(dir = FIXTURE_DIR): { blocks: number; fundings: number } {
  const f = generateBundleFixture();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bundles.json'), JSON.stringify(f));
  return { blocks: f.blocks.length, fundings: f.expectedFundings.length };
}

export function loadBundles(dir = FIXTURE_DIR): BundleFixture {
  if (!existsSync(join(dir, 'bundles.json'))) generateBundles(dir);
  return read<BundleFixture>(dir, 'bundles.json');
}
