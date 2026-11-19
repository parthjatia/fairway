/** Every scoring / tiering knob in one object. */
export type ScoringConfig = {
  /** markout horizons in seconds */
  horizons: number[];
  /** horizon used for the tier decision */
  primaryHorizon: number;
  /** Bayesian prior notional K (quote units) pulling scores toward 0 */
  priorNotional: number;
  toxicScoreBps: number;
  toxicMinTrades: number;
  retailScoreBps: number;
  retailMinTrades: number;
  retailMinHistoryDays: number;
  /** seconds per "day" for the history requirement (fixtures may compress time) */
  secondsPerDay: number;
};

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  horizons: [5, 30, 60],
  primaryHorizon: 30,
  priorNotional: 2_000,
  toxicScoreBps: 10,
  toxicMinTrades: 5,
  retailScoreBps: 3,
  retailMinTrades: 5,
  retailMinHistoryDays: 3,
  secondsPerDay: 86_400,
};

export const makeConfig = (overrides: Partial<ScoringConfig> = {}): ScoringConfig => ({
  ...DEFAULT_SCORING_CONFIG,
  ...overrides,
});
