import type { Tier } from '@fairway/scoring';

export type FeeSchedule = Record<Tier, number>;

export type SimConfig = {
  seed: number;
  /** evaluation window length */
  hours: number;
  /** one step = one Solana slot */
  stepSec: number;
  annualVol: number;
  /** Poisson jumps on top of GBM (fat tails: news, liquidation cascades) */
  jumpsPerDay: number;
  /** jump size standard deviation, bps */
  jumpSdBps: number;
  s0: number;
  /** initial pool depth in base (SOL); quote = base * s0 */
  poolBase: number;
  retail: {
    perMin: number;
    medianUsd: number;
    sigma: number;
    nWallets: number;
    maxUsd: number;
    /**
     * Fee elasticity of retail arrivals (0 = off). Arrival rate multiplier = 1 + e · (standard − fee) / standard,
     * e.g. e = 0.5 → a wallet paying 5 bps instead of 30 trades ~42% more often.
     */
    elasticity: number;
  };
  arb: { nWallets: number; gasUsd: number };
  sniper: {
    nWallets: number;
    /** probability per step that some sniper inspects the market */
    probPerStep: number;
    /** steps of foresight (150 × 0.4 s = 60 s) */
    lookaheadSteps: number;
    /** required edge beyond fee + impact, bps */
    minEdgeBps: number;
    medianUsd: number;
  };
  /** Fairway tier fees */
  fees: FeeSchedule;
  /** warm-up window (flat fee) used to learn wallet tiers before evaluation */
  warmupHours: number;
  /** sample interval for time series output, seconds */
  sampleEverySec: number;
};

export const DEFAULT_SIM_CONFIG: SimConfig = {
  seed: 42,
  hours: 24,
  stepSec: 0.4,
  annualVol: 0.6,
  jumpsPerDay: 24,
  jumpSdBps: 50,
  s0: 150,
  poolBase: 10_000,
  retail: { perMin: 0.75, medianUsd: 150, sigma: 1.0, nWallets: 300, maxUsd: 25_000, elasticity: 0 },
  arb: { nWallets: 3, gasUsd: 0.1 },
  sniper: { nWallets: 3, probPerStep: 0.02, lookaheadSteps: 150, minEdgeBps: 5, medianUsd: 3_000 },
  fees: { RETAIL: 5, STANDARD: 30, TOXIC: 80 },
  warmupHours: 72,
  sampleEverySec: 300,
};

export type Regime = 'flat30' | 'fairway' | 'rotation' | 'flat5' | 'flat80' | 'flat';

export const REGIME_LABELS: Record<Regime, string> = {
  flat30: 'Flat 30 bps (baseline)',
  fairway: 'Fairway tiers',
  rotation: 'Fairway, worst case (bots rotate wallets)',
  flat5: 'Flat 5 bps',
  flat80: 'Flat 80 bps',
  flat: 'Flat fee (custom)',
};

export const mergeConfig = (o: DeepPartial<SimConfig> = {}): SimConfig => ({
  ...DEFAULT_SIM_CONFIG,
  ...o,
  retail: { ...DEFAULT_SIM_CONFIG.retail, ...(o.retail ?? {}) },
  arb: { ...DEFAULT_SIM_CONFIG.arb, ...(o.arb ?? {}) },
  sniper: { ...DEFAULT_SIM_CONFIG.sniper, ...(o.sniper ?? {}) },
  fees: { ...DEFAULT_SIM_CONFIG.fees, ...(o.fees ?? {}) },
});

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
