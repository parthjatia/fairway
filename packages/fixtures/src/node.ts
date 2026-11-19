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
