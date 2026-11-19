import type { Swap, Tier, WalletScore } from '@fairway/scoring';
import { FixtureMidPrice, makeConfig, scoreWallets } from '@fairway/scoring';
import { base58Encode } from './base58';
import type { BlocksFixture } from './blocks';
import type { AgentClass, CexPath, FixturePool, Market, MarketConfig } from './market';
import { generateMarket } from './market';
import { Rng } from './rng';

export type Persona = {
  key: 'rita' | 'new' | 'arb7' | 'sniper';
  name: string;
  address: string;
  expectedTier: Tier;
  blurb: string;
};

export type FixtureMeta = {
  generatedBy: string;
  synthetic: true;
  seed: number;
  start: number;
  end: number;
  market: MarketConfig;
  pools: FixturePool[];
  personas: Persona[];
  /** ground-truth agent class per wallet (hidden from the scorer; used for evaluation/UI labels) */
  wallets: Array<{ address: string; cls: AgentClass }>;
  /** summary of the scorer's confusion matrix on the fixture (class → tier → count) */
  confusion: Record<string, Partial<Record<Tier, number>>>;
};

export type Dataset = { meta: FixtureMeta; cex: CexPath; swaps: Swap[] };

export const cexPoints = (cex: CexPath): Array<[number, number]> => cex.prices.map((p, i) => [cex.start + i * cex.stepSec, p]);
export const fixtureMids = (cex: CexPath) => new FixtureMidPrice(cexPoints(cex), Math.max(5, cex.stepSec * 2));

export function buildDataset(market: Market = generateMarket()): { dataset: Dataset; scores: WalletScore[] } {
  const scores = scoreWallets(market.swaps, fixtureMids(market.cex), makeConfig());
  const cls = new Map(market.wallets.map((w) => [w.address, w.cls]));
  const confusion: FixtureMeta['confusion'] = {};
  for (const s of scores) {
    const c = cls.get(s.trader)!;
    confusion[c] ??= {};
    confusion[c]![s.tier] = (confusion[c]![s.tier] ?? 0) + 1;
  }
  const scoreOf = new Map(scores.map((s) => [s.trader, s]));
  const rita = market.wallets.find((w) => w.cls === 'retail' && scoreOf.get(w.address)?.tier === 'RETAIL')!;
  const arb = market.wallets.find((w) => w.cls === 'arb')!;
  const sniper = market.wallets.find((w) => w.cls === 'sniper')!;
  const fresh = base58Encode(new Rng(market.config.seed + 99).bytes(32));
  const personas: Persona[] = [
    { key: 'rita', name: 'Retail Rita', address: rita.address, expectedTier: 'RETAIL', blurb: 'Buys and sells SOL a few times a day. No edge: prices do not move her way after she trades.' },
    { key: 'new', name: 'New wallet', address: fresh, expectedTier: 'STANDARD', blurb: 'Never traded before. Unknown wallets always pay the STANDARD fee, so rotating wallets never helps a bot.' },
    { key: 'arb7', name: 'Arb Bot 7', address: arb.address, expectedTier: 'TOXIC', blurb: 'Arbitrageur that trades the pool back to the CEX price. Consistently positive markout = informed flow.' },
    { key: 'sniper', name: 'Momentum Sniper', address: sniper.address, expectedTier: 'TOXIC', blurb: 'Trades seconds before the price moves. Small share of volume, very toxic.' },
  ];
  const meta: FixtureMeta = {
    generatedBy: '@fairway/fixtures generateMarket()',
    synthetic: true,
    seed: market.config.seed,
    start: market.config.start,
    end: market.config.start + market.config.days * 86_400,
    market: market.config,
    pools: market.pools,
    personas,
    wallets: market.wallets.map((w) => ({ address: w.address, cls: w.cls })),
    confusion,
  };
  return { dataset: { meta, cex: market.cex, swaps: market.swaps }, scores };
}

export type { BlocksFixture };
