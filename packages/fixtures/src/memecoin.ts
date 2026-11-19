/**
 * Second Fairway pool: BONK-test / USDC (a TEST mint, not the real token). A memecoin pool is the natural place for
 * snipers: price jumps are large and fast, so informed flow earns a big markout and is scored TOXIC after very few trades.
 *
 * Additive and independent of `generateMarket`: its own RNG stream and price path, so the SOL-USDC fixtures
 * (data/{meta,cex,swaps,blocks}.json) are byte-identical to before. The same wallets (Rita, Arb Bot 7, the snipers) trade
 * here, plus a few memecoin-only snipers.
 */
import type { Swap, Tier } from '@fairway/scoring';
import { base58Encode } from './base58';
import { arbTrade, cpOut, poolPrice, type Reserves } from './cpamm';
import { gbmPath } from './gbm';
import type { AgentClass, CexPath, FixturePool } from './market';
import { MINTS, PROGRAMS } from './market';
import { Rng } from './rng';

export const MEMECOIN_SEED = 77;
export const BONK_TEST_SYMBOL = 'BONK-test';

export type MemecoinMarket = {
  synthetic: true;
  note: string;
  symbol: string;
  pool: FixturePool;
  cex: CexPath;
  swaps: Swap[];
  /** wallets that only exist on this pool (memecoin snipers) */
  extraWallets: Array<{ address: string; cls: AgentClass }>;
  /** ground truth class per swap sig */
  swapClass: Record<string, AgentClass>;
};

export type MemecoinInput = {
  start: number;
  days: number;
  stepSec: number;
  baseSlot: number;
  fees: Record<Tier, number>;
  wallets: Array<{ address: string; cls: AgentClass }>;
  /** reuse the persona wallets so they carry over: first retail, first arb, first sniper */
  fairwayProgramId?: string;
};

const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;
const floorTo = (x: number, dp: number) => Math.floor(x * 10 ** dp + 1e-9) / 10 ** dp;

export function generateMemecoinMarket(inp: MemecoinInput): MemecoinMarket {
  const rng = new Rng(MEMECOIN_SEED);
  const addr = () => base58Encode(rng.bytes(32));
  const s0 = 0.00002; // USD per BONK-test
  const pool: FixturePool = {
    id: addr(),
    venue: 'fairway',
    label: `Fairway ${BONK_TEST_SYMBOL}-USDC (fixture)`,
    baseMint: addr(), // a throwaway TEST mint
    quoteMint: MINTS.USDC,
    baseVault: addr(),
    quoteVault: addr(),
    baseDecimals: 5,
    quoteDecimals: 6,
    feeBps: 30,
    programId: inp.fairwayProgramId ?? PROGRAMS.fairway,
    initialBase: 50_000_000_000, // 50B BONK-test ≈ $1M per side
  };
  const steps = Math.round((inp.days * 86_400) / inp.stepSec);
  // memecoin: ~220% annualized vol, plus fat-tailed jumps (pumps and dumps) that snipers can front-run
  const gbm = gbmPath({ seed: MEMECOIN_SEED * 1000 + 1, s0, steps, stepSec: inp.stepSec, annualVol: 2.2 });
  const jump = new Rng(MEMECOIN_SEED * 1000 + 2);
  const path = new Float64Array(steps + 1);
  let mult = 1;
  for (let i = 0; i <= steps; i++) {
    if (i > 0 && jump.bool(0.006)) mult *= Math.exp(jump.normal() * 0.015);
    path[i] = gbm[i]! * mult;
  }
  const cex: CexPath = { start: inp.start, stepSec: inp.stepSec, prices: Array.from(path, (p) => round(p, 9)) };

  const retail = inp.wallets.filter((w) => w.cls === 'retail');
  const arbs = inp.wallets.filter((w) => w.cls === 'arb');
  const snipers = inp.wallets.filter((w) => w.cls === 'sniper');
  const extraWallets = Array.from({ length: 4 }, () => ({ address: addr(), cls: 'sniper' as AgentClass }));
  const allSnipers = [...snipers, ...extraWallets];
  // retail on a memecoin: a subset of the SOL retail wallets, Rita first (she dabbles)
  const memeRetail = retail.slice(0, 40);
  const r: Reserves = { base: pool.initialBase, quote: pool.initialBase * s0 };
  const swaps: Swap[] = [];
  const swapClass: Record<string, AgentClass> = {};
  const slotsPerStep = inp.stepSec / 0.4;
  let lastSlot = 0;
  const tierOf = (cls: AgentClass): Tier => (cls === 'retail' ? 'RETAIL' : cls === 'arb' || cls === 'sniper' ? 'TOXIC' : 'STANDARD');

  const execute = (step: number, w: { address: string; cls: AgentClass }, side: 'buy' | 'sell', grossIn: number) => {
    const tier = tierOf(w.cls);
    const feeBps = inp.fees[tier];
    const f = feeBps / 10_000;
    let baseAmount: number;
    let quoteAmount: number;
    let execPrice: number;
    if (side === 'buy') {
      quoteAmount = round(grossIn, pool.quoteDecimals);
      const net = quoteAmount * (1 - f);
      baseAmount = floorTo(cpOut(net, r.quote, r.base), pool.baseDecimals);
      if (!(baseAmount > 0) || !(quoteAmount > 0)) return;
      execPrice = net / baseAmount;
      r.quote += net;
      r.base -= baseAmount;
    } else {
      baseAmount = round(grossIn, pool.baseDecimals);
      const net = baseAmount * (1 - f);
      quoteAmount = floorTo(cpOut(net, r.base, r.quote), pool.quoteDecimals);
      if (!(baseAmount > 0) || !(quoteAmount > 0)) return;
      execPrice = quoteAmount / net;
      r.base += net;
      r.quote -= quoteAmount;
    }
    const lo = inp.baseSlot + Math.floor(step * slotsPerStep);
    const hi = inp.baseSlot + Math.floor((step + 1) * slotsPerStep);
    const s: Swap = {
      sig: base58Encode(rng.bytes(64)),
      slot: (lastSlot = Math.max(lastSlot, lo + rng.int(Math.max(1, hi - lo)))),
      ts: inp.start + step * inp.stepSec,
      pool: pool.id,
      venue: 'fairway',
      trader: w.address,
      side,
      baseAmount,
      quoteAmount,
      execPrice,
      feeBps,
      tier,
    };
    swaps.push(s);
    swapClass[s.sig] = w.cls;
  };

  const lookahead = 6;
  const retailPerStep = (0.35 * inp.stepSec) / 60;
  for (let step = 1; step <= steps; step++) {
    const px = path[step]!;
    // snipers: memecoin pumps/dumps are large, so they find a profitable move far more often than on SOL
    if (step + lookahead <= steps && rng.bool(0.0035 * allSnipers.length)) {
      const moveBps = ((path[step + lookahead]! - px) / px) * 10_000;
      if (Math.abs(moveBps) >= 40) {
        // a pump/dump well beyond the arb band (the pool lags the CEX by up to the toxic fee), so the edge survives the curve
        const w = rng.pick(allSnipers);
        const usd = rng.lognormal(500, 0.4);
        if (moveBps > 0) execute(step, w, 'buy', usd);
        else execute(step, w, 'sell', usd / px);
      }
    }
    // arbs keep the pool aligned with the CEX price
    const arb = arbs.length ? arbs[rng.weighted(arbs.map((_, i) => (i === 0 ? 3 : 1)))]! : undefined;
    if (arb) {
      const t = arbTrade(r, px, inp.fees.TOXIC);
      if (t) {
        const f = inp.fees.TOXIC / 10_000;
        const gross = t.inAfterFee / (1 - f);
        const profit = t.side === 'buy' ? cpOut(t.inAfterFee, r.quote, r.base) * px - gross : cpOut(t.inAfterFee, r.base, r.quote) - gross * px;
        if (profit > 0.5) execute(step, arb, t.side, gross);
      }
    }
    // retail
    const k = rng.poisson(retailPerStep);
    for (let j = 0; j < k; j++) {
      const w = memeRetail[rng.weighted(memeRetail.map((_, i) => (i === 0 ? 3 : 1)))]!;
      const usd = Math.min(rng.lognormal(60, 0.9), 5_000);
      if (rng.bool()) execute(step, w, 'buy', usd);
      else execute(step, w, 'sell', usd / poolPrice(r));
    }
  }
  return {
    synthetic: true,
    note: 'BONK-test is a TEST mint, not the real BONK. All data is synthetic.',
    symbol: BONK_TEST_SYMBOL,
    pool,
    cex,
    swaps,
    extraWallets,
    swapClass,
  };
}
