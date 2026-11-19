/**
 * Launch simulation (M16): many token launches with snipers, bundlers, retail buyers and good (DCA) bots, under
 *   - flat 30 bps for everyone,
 *   - time-decay-only anti-sniper fee (what other launchpads do: everyone pays the same decaying fee),
 *   - Fairway: fee = f(tier, slots since launch), the same curve the program enforces (programs/fairway, launch.rs),
 *   - Fairway worst case: every sniper uses a fresh wallet (STANDARD tier).
 * Deterministic per seed. Common random numbers: the same launch (agents, budgets, arrival times) is replayed under every
 * regime, and agents react to the fees they face (snipers wait or skip when the fee is above what their edge pays for).
 * Everything here is SYNTHETIC. Agent parameters are assumptions; see docs/ECONOMICS.md ("Launch economics").
 */
import { Rng } from '@fairway/fixtures';

export type LaunchRegime = 'flat' | 'decay' | 'decayHigh' | 'fairway' | 'fairwayRotation';
export type LaunchAgent = 'retail' | 'goodbot' | 'sniper' | 'bundler';
/** 0 RETAIL, 1 STANDARD, 2 TOXIC (same indices as the program) */
export type TierIdx = 0 | 1 | 2;

export type Curve = { startBps: [number, number, number]; endBps: [number, number, number] };

export type LaunchSimConfig = {
  /** slots simulated per launch (2,250 ≈ 15 min at 400 ms) */
  slots: number;
  /** launch window (fee curve) in slots: 750 ≈ 5 min, the program default */
  windowSlots: number;
  /** Fairway's per-tier curve (program default) and its normal fees after the window */
  fairwayCurve: Curve;
  fairwayAfterBps: [number, number, number];
  /** what other launchpads do: one decaying fee for everyone */
  decayCurve: { startBps: number; endBps: number };
  /** aggressive variant for context (very high early tax for everyone) */
  decayHighCurve: { startBps: number; endBps: number };
  flatBps: number;
  /** token supply put in the pool and starting quote liquidity range (USDC) */
  poolTokens: number;
  liquidityUsd: [number, number];
  retail: { medianCount: number; countSigma: number; medianUsd: number; sizeSigma: number; maxUsd: number; hypeTauSlots: number; historyShare: number };
  goodbots: { max: number; usd: number; everySlots: number };
  sniper: {
    min: number;
    max: number;
    /** share of snipers whose wallets are already known TOXIC (scored from Pump.fun history via Streams) */
    knownShare: number;
    medianUsd: number;
    /** max fee (bps) a sniper pays to get in: its expected edge */
    maxFeeBps: [number, number];
    /** slots a sniper waits for the fee to come down before giving up on this launch */
    patienceSlots: [number, number];
    takeProfit: [number, number];
    maxHoldSlots: [number, number];
  };
  bundler: { prob: number; wallets: [number, number]; medianUsd: number; maxFeeBps: [number, number]; patienceSlots: [number, number] };
  /** human buys at or above this fee count as "paid the high early fee" */
  highFeeBps: number;
  /** protocol: launch fee (USD) + share of the TOXIC premium (fee above the STANDARD fee), as onchain */
  launchFeeUsd: number;
  protocolPremiumShareBps: number;
};

export const DEFAULT_LAUNCH_CONFIG: LaunchSimConfig = {
  slots: 2_250,
  windowSlots: 750,
  fairwayCurve: { startBps: [30, 300, 1_000], endBps: [5, 30, 80] },
  fairwayAfterBps: [30, 30, 80],
  decayCurve: { startBps: 300, endBps: 30 },
  decayHighCurve: { startBps: 1_000, endBps: 30 },
  flatBps: 30,
  poolTokens: 800_000_000,
  liquidityUsd: [10_000, 40_000],
  retail: { medianCount: 160, countSigma: 0.5, medianUsd: 80, sizeSigma: 0.9, maxUsd: 2_000, hypeTauSlots: 300, historyShare: 0.6 },
  goodbots: { max: 3, usd: 40, everySlots: 40 },
  sniper: { min: 2, max: 8, knownShare: 0.75, medianUsd: 2_500, maxFeeBps: [150, 700], patienceSlots: [30, 300], takeProfit: [0.3, 1.0], maxHoldSlots: [300, 1_200] },
  bundler: { prob: 0.5, wallets: [3, 8], medianUsd: 6_000, maxFeeBps: [200, 700], patienceSlots: [0, 20] },
  highFeeBps: 100,
  launchFeeUsd: 7.5,
  protocolPremiumShareBps: 1_500,
};

export const LAUNCH_REGIMES: { id: LaunchRegime; label: string; short: string }[] = [
  { id: 'flat', label: 'Flat 30 bps (no protection)', short: 'Flat 30' },
  { id: 'decay', label: 'Time-decay only, 300→30 bps for everyone', short: 'Time-decay' },
  { id: 'decayHigh', label: 'Aggressive time-decay, 1000→30 bps for everyone', short: 'Decay 1000' },
  { id: 'fairway', label: 'Fairway: tier × time (1000→80 / 300→30 / 30→5)', short: 'Fairway' },
  { id: 'fairwayRotation', label: 'Fairway worst case: every sniper uses a fresh wallet', short: 'Fairway (rotation)' },
];

/** `end + ceil((start − end) × (window − elapsed) / window)`: identical to fairway_math::launch::decayed_fee_bps. */
export function decayedFee(startBps: number, endBps: number, elapsed: number, windowSlots: number): number {
  if (windowSlots <= 0 || elapsed >= windowSlots || startBps <= endBps) return endBps;
  return endBps + Math.ceil(((startBps - endBps) * (windowSlots - elapsed)) / windowSlots - 1e-9);
}

export function launchFee(cfg: LaunchSimConfig, regime: LaunchRegime, tier: TierIdx, slot: number): number {
  switch (regime) {
    case 'flat':
      return cfg.flatBps;
    case 'decay':
      return decayedFee(cfg.decayCurve.startBps, cfg.decayCurve.endBps, slot, cfg.windowSlots);
    case 'decayHigh':
      return decayedFee(cfg.decayHighCurve.startBps, cfg.decayHighCurve.endBps, slot, cfg.windowSlots);
    default:
      return slot < cfg.windowSlots ? decayedFee(cfg.fairwayCurve.startBps[tier], cfg.fairwayCurve.endBps[tier], slot, cfg.windowSlots) : cfg.fairwayAfterBps[tier];
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Scenario (common random numbers)

type Bot = {
  id: string;
  kind: 'sniper' | 'bundler';
  entity: string;
  known: boolean;
  usd: number;
  maxFeeBps: number;
  patience: number;
  takeProfit: number;
  maxHold: number;
};
type RetailBuy = { id: string; slot: number; usd: number; history: boolean };
export type LaunchScenario = { seed: number; liquidityUsd: number; bots: Bot[]; retail: RetailBuy[]; goodbots: string[]; hype: number };

const uni = (r: Rng, [a, b]: [number, number]) => a + (b - a) * r.next();

export function makeLaunchScenario(cfg: LaunchSimConfig, seed: number): LaunchScenario {
  const r = new Rng(0x1a0c0 + seed * 7919);
  const liquidityUsd = Math.round(uni(r, cfg.liquidityUsd));
  const hype = Math.exp(cfg.retail.countSigma * r.normal());
  const nRetail = Math.max(10, Math.round(cfg.retail.medianCount * hype));
  const retail: RetailBuy[] = [];
  for (let i = 0; i < nRetail; i++) {
    // front-loaded hype: exponential arrival times, truncated to the simulated span
    let slot: number;
    do slot = Math.floor(-cfg.retail.hypeTauSlots * Math.log(1 - r.next())) + 1;
    while (slot >= cfg.slots);
    retail.push({ id: `retail-${i}`, slot, usd: Math.min(cfg.retail.maxUsd, r.lognormal(cfg.retail.medianUsd, cfg.retail.sizeSigma)), history: r.bool(cfg.retail.historyShare) });
  }
  retail.sort((a, b) => a.slot - b.slot);
  const bots: Bot[] = [];
  const nSnipers = cfg.sniper.min + r.int(cfg.sniper.max - cfg.sniper.min + 1);
  for (let i = 0; i < nSnipers; i++) {
    bots.push({
      id: `sniper-${i}`,
      kind: 'sniper',
      entity: `sniper-${i}`,
      known: r.bool(cfg.sniper.knownShare),
      usd: r.lognormal(cfg.sniper.medianUsd, 0.6),
      maxFeeBps: uni(r, cfg.sniper.maxFeeBps),
      patience: Math.round(uni(r, cfg.sniper.patienceSlots)),
      takeProfit: uni(r, cfg.sniper.takeProfit),
      maxHold: Math.round(uni(r, cfg.sniper.maxHoldSlots)),
    });
  }
  if (r.bool(cfg.bundler.prob)) {
    const n = cfg.bundler.wallets[0] + r.int(cfg.bundler.wallets[1] - cfg.bundler.wallets[0] + 1);
    const total = r.lognormal(cfg.bundler.medianUsd, 0.5);
    const maxFee = uni(r, cfg.bundler.maxFeeBps);
    const patience = Math.round(uni(r, cfg.bundler.patienceSlots));
    const tp = uni(r, cfg.sniper.takeProfit);
    const hold = Math.round(uni(r, cfg.sniper.maxHoldSlots));
    for (let i = 0; i < n; i++) {
      // fresh wallets funded by one entity: never known, so STANDARD in every Fairway regime
      bots.push({ id: `bundle-${i}`, kind: 'bundler', entity: 'bundler', known: false, usd: (total / n) * (0.7 + 0.6 * r.next()), maxFeeBps: maxFee, patience, takeProfit: tp, maxHold: hold });
    }
  }
  const goodbots = Array.from({ length: r.int(cfg.goodbots.max + 1) }, (_, i) => `dca-${i}`);
  return { seed, liquidityUsd, bots, retail, goodbots, hype };
}

// ---------------------------------------------------------------------------------------------------------------------
// One launch under one regime

export type LaunchTrade = {
  slot: number;
  wallet: string;
  agent: LaunchAgent;
  /** the Fairway tier this wallet resolves to (also recorded under the other regimes, where it does not change the fee) */
  tier: TierIdx;
  side: 'buy' | 'sell';
  usd: number;
  tokens: number;
  feeBps: number;
  feeUsd: number;
  /** average execution price incl. fee, USD per token */
  price: number;
};

export type LaunchMetrics = {
  /** tokens bought by snipers + bundlers inside the launch window ÷ all tokens bought in the window */
  sniperShareOfWindowSupply: number;
  /** retail average entry price (incl. fee) ÷ listing price − 1 */
  retailEntryPremiumPct: number;
  /** volume-weighted fee paid by retail buyers (bps); NaN when there were none (excluded from averages) */
  humanFeeBps: number;
  /** volume-weighted fee paid by snipers + bundlers on buys and sells (bps) */
  sniperFeeBps: number;
  goodbotFeeBps: number;
  /** share of retail buys that paid ≥ highFeeBps */
  humanHighFeeShare: number;
  /** USD retail paid in fees */
  humanFeesUsd: number;
  sniperFeesUsd: number;
  sniperNotionalUsd: number;
  /** the same, only for snipers whose wallets are already known TOXIC (Fairway charges them the TOXIC curve) */
  knownSniperFeeBps: number;
  knownSniperFeesUsd: number;
  knownSniperNotionalUsd: number;
  /** LP fees kept by the creator (all fees minus the protocol share) */
  creatorFeesUsd: number;
  /** launch fee + protocol share of the TOXIC premium */
  protocolUsd: number;
  /** realised + marked-to-market PnL of snipers and bundlers */
  sniperPnlUsd: number;
  /** share of sniper/bundler wallets that bought at all */
  sniperParticipation: number;
  retailBuys: number;
  retailUsd: number;
};

export type LaunchRun = { metrics: LaunchMetrics; trades: LaunchTrade[]; listingPrice: number; finalPrice: number; priceBySlot: { slot: number; price: number }[] };

function botTier(regime: LaunchRegime, b: Bot): TierIdx {
  if (regime === 'fairwayRotation') return 1;
  return b.known ? 2 : 1;
}

export function runLaunch(cfg: LaunchSimConfig, sc: LaunchScenario, regime: LaunchRegime, opts: { recordTrades?: boolean } = {}): LaunchRun {
  let tok = cfg.poolTokens;
  let usd = sc.liquidityUsd;
  const listingPrice = usd / tok;
  const price = () => usd / tok;
  const trades: LaunchTrade[] = [];
  const priceBySlot: { slot: number; price: number }[] = [];
  const m = {
    winTok: 0,
    winBotTok: 0,
    rUsd: 0,
    rTok: 0,
    rFeeUsd: 0,
    rNotional: 0,
    rHigh: 0,
    rBuys: 0,
    bFeeUsd: 0,
    bNotional: 0,
    kFeeUsd: 0,
    kNotional: 0,
    gFeeUsd: 0,
    gNotional: 0,
    feesUsd: 0,
    premiumUsd: 0,
  };
  const standardFee = (slot: number) => launchFee(cfg, regime, 1, slot);
  const book = (t: Omit<LaunchTrade, 'price'>) => {
    if (opts.recordTrades) trades.push({ ...t, price: t.side === 'buy' ? t.usd / t.tokens : t.usd / t.tokens });
  };
  const known = new Set(sc.bots.filter((b) => b.known).map((b) => b.id));
  const buy = (slot: number, wallet: string, agent: LaunchAgent, tier: TierIdx, spendUsd: number) => {
    const fee = launchFee(cfg, regime, tier, slot);
    const feeUsd = (spendUsd * fee) / 10_000;
    const inAfter = spendUsd - feeUsd;
    const out = (inAfter * tok) / (usd + inAfter);
    usd += spendUsd; // the fee stays in the pool (LP = creator)
    tok -= out;
    m.feesUsd += feeUsd;
    if (tier === 2 && regime !== 'flat' && regime !== 'decay' && regime !== 'decayHigh') m.premiumUsd += (spendUsd * Math.max(0, fee - standardFee(slot))) / 10_000;
    if (slot < cfg.windowSlots) {
      m.winTok += out;
      if (agent === 'sniper' || agent === 'bundler') m.winBotTok += out;
    }
    if (agent === 'retail') {
      m.rUsd += spendUsd;
      m.rTok += out;
      m.rFeeUsd += feeUsd;
      m.rNotional += spendUsd;
      m.rBuys++;
      if (fee >= cfg.highFeeBps) m.rHigh++;
    } else if (agent === 'goodbot') {
      m.gFeeUsd += feeUsd;
      m.gNotional += spendUsd;
    } else {
      m.bFeeUsd += feeUsd;
      m.bNotional += spendUsd;
      if (known.has(wallet)) {
        m.kFeeUsd += feeUsd;
        m.kNotional += spendUsd;
      }
    }
    book({ slot, wallet, agent, tier, side: 'buy', usd: spendUsd, tokens: out, feeBps: fee, feeUsd });
    return out;
  };
  const sell = (slot: number, wallet: string, agent: LaunchAgent, tier: TierIdx, tokens: number) => {
    const fee = launchFee(cfg, regime, tier, slot);
    const p = price();
    const feeTok = (tokens * fee) / 10_000;
    const inAfter = tokens - feeTok;
    const out = (inAfter * usd) / (tok + inAfter);
    tok += tokens;
    usd -= out;
    const feeUsd = feeTok * p;
    m.feesUsd += feeUsd;
    if (tier === 2 && regime !== 'flat' && regime !== 'decay' && regime !== 'decayHigh') m.premiumUsd += (tokens * p * Math.max(0, fee - standardFee(slot))) / 10_000;
    m.bFeeUsd += feeUsd;
    m.bNotional += tokens * p;
    if (known.has(wallet)) {
      m.kFeeUsd += feeUsd;
      m.kNotional += tokens * p;
    }
    book({ slot, wallet, agent, tier, side: 'sell', usd: out, tokens, feeBps: fee, feeUsd });
    return out;
  };

  type Pos = { b: Bot; tier: TierIdx; state: 'waiting' | 'holding' | 'done' | 'skipped'; tokens: number; cost: number; entry: number; proceeds: number };
  const pos: Pos[] = sc.bots.map((b) => ({ b, tier: botTier(regime, b), state: 'waiting', tokens: 0, cost: 0, entry: -1, proceeds: 0 }));
  let ri = 0;
  for (let slot = 0; slot < cfg.slots; slot++) {
    // bots are fastest: they act first in every slot
    for (const p of pos) {
      if (p.state === 'waiting') {
        if (slot > p.b.patience) {
          p.state = 'skipped';
          continue;
        }
        if (launchFee(cfg, regime, p.tier, slot) <= p.b.maxFeeBps) {
          p.tokens = buy(slot, p.b.id, p.b.kind, p.tier, p.b.usd);
          p.cost = p.b.usd;
          p.entry = slot;
          p.state = 'holding';
        }
      } else if (p.state === 'holding') {
        const fee = launchFee(cfg, regime, p.tier, slot);
        const value = p.tokens * price() * (1 - fee / 10_000);
        if (value >= p.cost * (1 + p.b.takeProfit) || slot - p.entry >= p.b.maxHold) {
          p.proceeds = sell(slot, p.b.id, p.b.kind, p.tier, p.tokens);
          p.tokens = 0;
          p.state = 'done';
        }
      }
    }
    if (sc.goodbots.length && slot >= 20 && slot % cfg.goodbots.everySlots === 0) for (const g of sc.goodbots) buy(slot, g, 'goodbot', 0, cfg.goodbots.usd);
    while (ri < sc.retail.length && sc.retail[ri]!.slot === slot) {
      const r = sc.retail[ri++]!;
      buy(slot, r.id, 'retail', r.history ? 0 : 1, r.usd);
    }
    if (opts.recordTrades && slot % 15 === 0) priceBySlot.push({ slot, price: price() });
  }
  const finalPrice = price();
  const sniperPnlUsd = pos.reduce((a, p) => a + (p.state === 'skipped' || p.state === 'waiting' ? 0 : p.proceeds + p.tokens * finalPrice - p.cost), 0);
  const protocolUsd = cfg.launchFeeUsd + (m.premiumUsd * cfg.protocolPremiumShareBps) / 10_000;
  const metrics: LaunchMetrics = {
    sniperShareOfWindowSupply: m.winTok > 0 ? m.winBotTok / m.winTok : 0,
    retailEntryPremiumPct: m.rTok > 0 ? (m.rUsd / m.rTok / listingPrice - 1) * 100 : 0,
    humanFeeBps: m.rNotional > 0 ? (m.rFeeUsd / m.rNotional) * 10_000 : NaN,
    sniperFeeBps: m.bNotional > 0 ? (m.bFeeUsd / m.bNotional) * 10_000 : NaN,
    goodbotFeeBps: m.gNotional > 0 ? (m.gFeeUsd / m.gNotional) * 10_000 : NaN,
    sniperNotionalUsd: m.bNotional,
    knownSniperFeeBps: m.kNotional > 0 ? (m.kFeeUsd / m.kNotional) * 10_000 : NaN,
    knownSniperFeesUsd: m.kFeeUsd,
    knownSniperNotionalUsd: m.kNotional,
    humanHighFeeShare: m.rBuys > 0 ? m.rHigh / m.rBuys : 0,
    humanFeesUsd: m.rFeeUsd,
    sniperFeesUsd: m.bFeeUsd,
    creatorFeesUsd: m.feesUsd - (m.premiumUsd * cfg.protocolPremiumShareBps) / 10_000,
    protocolUsd,
    sniperPnlUsd,
    sniperParticipation: pos.length ? pos.filter((p) => p.state !== 'skipped' && p.state !== 'waiting').length / pos.length : 0,
    retailBuys: m.rBuys,
    retailUsd: m.rUsd,
  };
  return { metrics, trades, listingPrice, finalPrice, priceBySlot };
}

// ---------------------------------------------------------------------------------------------------------------------
// Many launches

export type Dist = { mean: number; p10: number; p50: number; p90: number };
/** NaN entries (e.g. no sniper traded in that launch) are excluded */
const dist = (all: number[]): Dist => {
  const xs = all.filter((x) => Number.isFinite(x));
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] ?? 0;
  return { mean: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length), p10: q(0.1), p50: q(0.5), p90: q(0.9) };
};

export type LaunchStudy = {
  synthetic: true;
  config: LaunchSimConfig;
  launches: number;
  regimes: { id: LaunchRegime; label: string; short: string; metrics: Record<keyof LaunchMetrics, Dist> }[];
  /** the key chart: volume-weighted fee (bps) paid by humans vs snipers/bundlers, per regime */
  keyChart: { id: LaunchRegime; short: string; humanFeeBps: number; sniperFeeBps: number; knownSniperFeeBps: number }[];
  /** paired per-launch comparison Fairway vs time-decay-only */
  paired: { humanFeeCutPct: number; sniperFeeRatio: number; knownSniperFeeRatio: number; launchesWhereHumansPayLess: number; launchesWhereSnipersPayAtLeastAsMuch: number };
  /** fee schedules, sampled every 25 slots */
  schedules: { slot: number; flat: number; decay: number; decayHigh: number; fairwayRetail: number; fairwayStandard: number; fairwayToxic: number }[];
  /** one representative launch, traded under Fairway and under time-decay-only (for the UI's launch view) */
  example: { seed: number; listingPrice: number; liquidityUsd: number; fairway: LaunchRun; decay: LaunchRun };
};

/** A representative example: a bundle, known snipers kept out by Fairway, and at least one fresh sniper who still buys. */
export function pickExampleSeed(cfg: LaunchSimConfig, from = 1, to = 200): number {
  for (let seed = from; seed <= to; seed++) {
    const sc = makeLaunchScenario(cfg, seed);
    if (!sc.bots.some((b) => b.kind === 'bundler') || sc.bots.filter((b) => b.kind === 'sniper' && b.known).length < 2) continue;
    if (sc.retail.length < 120 || sc.retail.length > 260) continue;
    const fw = runLaunch(cfg, sc, 'fairway', { recordTrades: true });
    const knownBought = fw.trades.some((t) => t.agent === 'sniper' && t.tier === 2);
    const freshBought = fw.trades.some((t) => t.agent === 'sniper' && t.tier === 1);
    if (freshBought && !knownBought) return seed;
  }
  return from;
}

export function runLaunchStudy(cfg: LaunchSimConfig = DEFAULT_LAUNCH_CONFIG, seeds: number[] = Array.from({ length: 200 }, (_, i) => i + 1), exampleSeed = pickExampleSeed(cfg)): LaunchStudy {
  const per: Record<LaunchRegime, LaunchMetrics[]> = { flat: [], decay: [], decayHigh: [], fairway: [], fairwayRotation: [] };
  for (const seed of seeds) {
    const sc = makeLaunchScenario(cfg, seed);
    for (const { id } of LAUNCH_REGIMES) per[id].push(runLaunch(cfg, sc, id).metrics);
  }
  const keys = Object.keys(per.flat[0]!) as (keyof LaunchMetrics)[];
  const regimes = LAUNCH_REGIMES.map((r) => ({ ...r, metrics: Object.fromEntries(keys.map((k) => [k, dist(per[r.id].map((x) => x[k]))])) as Record<keyof LaunchMetrics, Dist> }));
  // aggregate (pooled) fee rates for the key chart: total fees ÷ total notional across launches
  const pooled = (id: LaunchRegime, who: 'human' | 'sniper' | 'known') => {
    const xs = per[id];
    if (who === 'known') return (xs.reduce((a, x) => a + x.knownSniperFeesUsd, 0) / Math.max(1e-9, xs.reduce((a, x) => a + x.knownSniperNotionalUsd, 0))) * 10_000;
    if (who === 'human') return (xs.reduce((a, x) => a + x.humanFeesUsd, 0) / Math.max(1e-9, xs.reduce((a, x) => a + x.retailUsd, 0))) * 10_000;
    const notional = xs.reduce((a, x) => a + x.sniperNotionalUsd, 0);
    return (xs.reduce((a, x) => a + x.sniperFeesUsd, 0) / Math.max(1e-9, notional)) * 10_000;
  };
  const keyChart = LAUNCH_REGIMES.map((r) => ({ id: r.id, short: r.short, humanFeeBps: pooled(r.id, 'human'), sniperFeeBps: pooled(r.id, 'sniper'), knownSniperFeeBps: pooled(r.id, 'known') }));
  const fw = per.fairway;
  const dc = per.decay;
  const paired = {
    humanFeeCutPct: (1 - pooled('fairway', 'human') / pooled('decay', 'human')) * 100,
    sniperFeeRatio: pooled('fairway', 'sniper') / pooled('decay', 'sniper'),
    knownSniperFeeRatio: pooled('fairway', 'known') / pooled('decay', 'known'),
    launchesWhereHumansPayLess: fw.filter((x, i) => x.humanFeeBps < dc[i]!.humanFeeBps).length / fw.length,
    // a launch where no sniper bought under Fairway counts: the snipers were kept out
    launchesWhereSnipersPayAtLeastAsMuch: fw.filter((x, i) => !Number.isFinite(x.sniperFeeBps) || !Number.isFinite(dc[i]!.sniperFeeBps) || x.sniperFeeBps >= dc[i]!.sniperFeeBps - 1e-9).length / fw.length,
  };
  const schedules = [];
  for (let s = 0; s <= cfg.windowSlots + 100; s += 25)
    schedules.push({
      slot: s,
      flat: launchFee(cfg, 'flat', 1, s),
      decay: launchFee(cfg, 'decay', 1, s),
      decayHigh: launchFee(cfg, 'decayHigh', 1, s),
      fairwayRetail: launchFee(cfg, 'fairway', 0, s),
      fairwayStandard: launchFee(cfg, 'fairway', 1, s),
      fairwayToxic: launchFee(cfg, 'fairway', 2, s),
    });
  const exSc = makeLaunchScenario(cfg, exampleSeed);
  const example = {
    seed: exampleSeed,
    listingPrice: exSc.liquidityUsd / cfg.poolTokens,
    liquidityUsd: exSc.liquidityUsd,
    fairway: runLaunch(cfg, exSc, 'fairway', { recordTrades: true }),
    decay: runLaunch(cfg, exSc, 'decay', { recordTrades: true }),
  };
  return { synthetic: true, config: cfg, launches: seeds.length, regimes, keyChart, paired, schedules, example };
}
