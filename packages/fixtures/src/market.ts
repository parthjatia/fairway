import type { Swap, Tier, Venue } from '@fairway/scoring';
import { base58Encode } from './base58';
import { arbTrade, cpOut, poolPrice, type Reserves } from './cpamm';
import { gbmPath } from './gbm';
import { Rng } from './rng';

export type AgentClass = 'retail' | 'arb' | 'sniper' | 'new';

export type FixturePool = {
  id: string;
  venue: Venue;
  label: string;
  baseMint: string;
  quoteMint: string;
  baseVault: string;
  quoteVault: string;
  baseDecimals: number;
  quoteDecimals: number;
  /** flat fee for external venues; Fairway charges by tier */
  feeBps: number;
  programId: string;
  initialBase: number;
};

export type FixtureWallet = { address: string; cls: AgentClass; activity: number };

export type MarketConfig = {
  seed: number;
  /** unix seconds */
  start: number;
  days: number;
  stepSec: number;
  s0: number;
  annualVol: number;
  /** retail arrivals per minute across all pools */
  retailPerMin: number;
  retailMedianUsd: number;
  retailSigma: number;
  nRetail: number;
  nArb: number;
  nSniper: number;
  nNew: number;
  /** probability per step that a sniper looks for an opportunity */
  sniperProb: number;
  /** look-ahead steps for snipers */
  sniperLookahead: number;
  sniperMinMoveBps: number;
  arbGasUsd: number;
  baseSlot: number;
  fairwayFees: Record<Tier, number>;
};

export const DEFAULT_MARKET_CONFIG: MarketConfig = {
  seed: 7,
  start: Date.UTC(2026, 10, 12) / 1000,
  days: 4,
  stepSec: 5,
  s0: 150,
  annualVol: 0.6,
  retailPerMin: 1.0,
  retailMedianUsd: 150,
  retailSigma: 1.0,
  nRetail: 150,
  nArb: 3,
  nSniper: 2,
  nNew: 6,
  sniperProb: 0.06,
  sniperLookahead: 6,
  sniperMinMoveBps: 15,
  arbGasUsd: 0.5,
  baseSlot: 380_000_000,
  fairwayFees: { RETAIL: 5, STANDARD: 30, TOXIC: 80 },
};

export const MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};
export const PROGRAMS = {
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  system: '11111111111111111111111111111111',
  computeBudget: 'ComputeBudget111111111111111111111111111111',
  vote: 'Vote111111111111111111111111111111111111111',
  raydiumAmm: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  orcaWhirlpool: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  /** Fairway program id (programs/fairway, Anchor.toml); override via FAIRWAY_PROGRAM_ID when regenerating */
  fairway: '8jo3xry2rp9rQHwPCyh8c9Qwnw2HHa5JvAUiXHo2XPXk',
};

export type CexPath = { start: number; stepSec: number; prices: number[] };

export type Market = {
  config: MarketConfig;
  pools: FixturePool[];
  wallets: FixtureWallet[];
  cex: CexPath;
  swaps: Swap[];
  /** ground truth for each swap: agent class (not visible to the scorer) */
  swapClass: Record<string, AgentClass>;
  /** liquidity events per pool (used for edge-case blocks) */
  finalReserves: Record<string, Reserves>;
};

const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;
const floorTo = (x: number, dp: number) => Math.floor(x * 10 ** dp + 1e-9) / 10 ** dp;

export function makePools(rng: Rng, fairwayProgramId = PROGRAMS.fairway): FixturePool[] {
  const addr = () => base58Encode(rng.bytes(32));
  const mk = (venue: Venue, label: string, feeBps: number, programId: string, initialBase: number): FixturePool => ({
    id: addr(),
    venue,
    label,
    baseMint: MINTS.SOL,
    quoteMint: MINTS.USDC,
    baseVault: addr(),
    quoteVault: addr(),
    baseDecimals: 9,
    quoteDecimals: 6,
    feeBps,
    programId,
    initialBase,
  });
  return [
    mk('raydium', 'Raydium SOL-USDC (fixture)', 25, PROGRAMS.raydiumAmm, 60_000),
    mk('orca', 'Orca SOL-USDC (fixture)', 30, PROGRAMS.orcaWhirlpool, 40_000),
    mk('fairway', 'Fairway SOL-USDC (fixture)', 30, fairwayProgramId, 10_000),
  ];
}

/** Deterministic agent-based market used to produce fixture swaps. */
export function generateMarket(partial: Partial<MarketConfig> = {}, fairwayProgramId?: string): Market {
  const cfg: MarketConfig = { ...DEFAULT_MARKET_CONFIG, ...partial };
  const rng = new Rng(cfg.seed);
  const pools = makePools(rng, fairwayProgramId);
  const steps = Math.round((cfg.days * 86_400) / cfg.stepSec);
  const path = gbmPath({ seed: cfg.seed * 1_000 + 1, s0: cfg.s0, steps, stepSec: cfg.stepSec, annualVol: cfg.annualVol });
  const cex: CexPath = { start: cfg.start, stepSec: cfg.stepSec, prices: Array.from(path, (p) => round(p, 4)) };

  const wallets: FixtureWallet[] = [];
  const addWallets = (cls: AgentClass, n: number, activity: () => number) => {
    for (let i = 0; i < n; i++) wallets.push({ address: base58Encode(rng.bytes(32)), cls, activity: activity() });
  };
  addWallets('retail', cfg.nRetail, () => rng.lognormal(1, 1));
  addWallets('arb', cfg.nArb, () => 0);
  addWallets('sniper', cfg.nSniper, () => 0);
  addWallets('new', cfg.nNew, () => 0);
  // first retail wallet is a regular: trades more often ("Retail Rita")
  wallets[0]!.activity = 1.6;
  const retail = wallets.filter((w) => w.cls === 'retail');
  const retailWeights = retail.map((w) => w.activity);
  const arbs = wallets.filter((w) => w.cls === 'arb');
  const arbWeights = arbs.map((_, i) => (i === 0 ? 3 : 1)); // first arb ("Arb Bot 7") is dominant
  const snipers = wallets.filter((w) => w.cls === 'sniper');
  const newbies = wallets.filter((w) => w.cls === 'new');
  // new wallets trade only once or twice, late in the window
  const newbieSchedule = new Map<number, FixtureWallet[]>();
  for (const w of newbies) {
    const k = 1 + rng.int(2);
    for (let j = 0; j < k; j++) {
      const step = Math.floor(steps * (0.85 + 0.15 * rng.next()));
      if (!newbieSchedule.has(step)) newbieSchedule.set(step, []);
      newbieSchedule.get(step)!.push(w);
    }
  }

  const reserves: Record<string, Reserves> = {};
  for (const p of pools) reserves[p.id] = { base: p.initialBase, quote: p.initialBase * cfg.s0 };
  const depthWeights = pools.map((p) => p.initialBase);

  const swaps: Swap[] = [];
  const swapClass: Record<string, AgentClass> = {};
  const slotsPerStep = cfg.stepSec / 0.4;
  let lastSlot = 0; // slots are non-decreasing in execution order

  const feeFor = (pool: FixturePool, cls: AgentClass): { feeBps: number; tier?: Tier } => {
    if (pool.venue !== 'fairway') return { feeBps: pool.feeBps };
    const tier: Tier = cls === 'retail' ? 'RETAIL' : cls === 'arb' || cls === 'sniper' ? 'TOXIC' : 'STANDARD';
    return { feeBps: cfg.fairwayFees[tier], tier };
  };

  const execute = (step: number, pool: FixturePool, w: FixtureWallet, side: 'buy' | 'sell', grossIn: number): Swap | null => {
    const r = reserves[pool.id]!;
    const { feeBps, tier } = feeFor(pool, w.cls);
    const f = feeBps / 10_000;
    let baseAmount: number;
    let quoteAmount: number;
    let execPrice: number;
    if (side === 'buy') {
      // quote in (raw 6dp), base out (raw 9dp, floored = pool-favourable)
      quoteAmount = round(grossIn, pool.quoteDecimals);
      const net = quoteAmount * (1 - f);
      baseAmount = floorTo(cpOut(net, r.quote, r.base), pool.baseDecimals);
      if (!(baseAmount > 0)) return null;
      execPrice = net / baseAmount;
      r.quote += net;
      r.base -= baseAmount;
    } else {
      baseAmount = round(grossIn, pool.baseDecimals);
      const net = baseAmount * (1 - f);
      quoteAmount = floorTo(cpOut(net, r.base, r.quote), pool.quoteDecimals);
      if (!(quoteAmount > 0)) return null;
      execPrice = quoteAmount / net;
      r.base += net;
      r.quote -= quoteAmount;
    }
    const slotLo = cfg.baseSlot + Math.floor(step * slotsPerStep);
    const slotHi = cfg.baseSlot + Math.floor((step + 1) * slotsPerStep);
    const s: Swap = {
      sig: base58Encode(rng.bytes(64)),
      slot: (lastSlot = Math.max(lastSlot, slotLo + rng.int(Math.max(1, slotHi - slotLo)))),
      ts: cfg.start + step * cfg.stepSec,
      pool: pool.id,
      venue: pool.venue,
      trader: w.address,
      side,
      baseAmount,
      quoteAmount,
      execPrice,
      feeBps,
      ...(tier ? { tier } : {}),
    };
    swaps.push(s);
    swapClass[s.sig] = w.cls;
    return s;
  };

  const retailPerStep = (cfg.retailPerMin * cfg.stepSec) / 60;

  for (let step = 1; step <= steps; step++) {
    const cexPx = path[step]!;
    // 1) snipers: informed about the next few steps
    if (step + cfg.sniperLookahead <= steps && rng.bool(cfg.sniperProb * snipers.length)) {
      const fut = path[step + cfg.sniperLookahead]!;
      const moveBps = ((fut - cexPx) / cexPx) * 10_000;
      if (Math.abs(moveBps) >= cfg.sniperMinMoveBps) {
        const w = rng.pick(snipers);
        const pool = pools[rng.weighted(depthWeights)]!;
        const usd = rng.lognormal(1_500, 0.4);
        if (moveBps > 0) execute(step, pool, w, 'buy', usd);
        else execute(step, pool, w, 'sell', usd / cexPx);
      }
    }
    // 2) arbitrageurs align each pool to the CEX
    for (const pool of pools) {
      const w = arbs[rng.weighted(arbWeights)]!;
      const { feeBps } = feeFor(pool, 'arb');
      const t = arbTrade(reserves[pool.id]!, cexPx, feeBps);
      if (!t) continue;
      const f = feeBps / 10_000;
      const gross = t.inAfterFee / (1 - f);
      const r = reserves[pool.id]!;
      const profit =
        t.side === 'buy'
          ? cpOut(t.inAfterFee, r.quote, r.base) * cexPx - gross
          : cpOut(t.inAfterFee, r.base, r.quote) - gross * cexPx;
      if (profit > cfg.arbGasUsd) execute(step, pool, w, t.side, gross);
    }
    // 3) retail: Poisson arrivals, random direction, lognormal size
    const k = rng.poisson(retailPerStep);
    for (let j = 0; j < k; j++) {
      const w = retail[rng.weighted(retailWeights)]!;
      const pool = pools[rng.weighted(depthWeights)]!;
      const usd = Math.min(rng.lognormal(cfg.retailMedianUsd, cfg.retailSigma), 20_000);
      if (rng.bool()) execute(step, pool, w, 'buy', usd);
      else execute(step, pool, w, 'sell', usd / poolPrice(reserves[pool.id]!));
    }
    // 4) brand-new wallets
    for (const w of newbieSchedule.get(step) ?? []) {
      const pool = pools[2]!;
      const usd = rng.lognormal(300, 0.6);
      if (rng.bool()) execute(step, pool, w, 'buy', usd);
      else execute(step, pool, w, 'sell', usd / poolPrice(reserves[pool.id]!));
    }
  }

  // already in execution order with non-decreasing slots; keep it that way (stable)
  return { config: cfg, pools, wallets, cex, swaps, swapClass, finalReserves: reserves };
}
