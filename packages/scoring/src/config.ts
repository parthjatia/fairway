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
  /**
   * 'all-horizons' (default): TOXIC if ANY horizon's score ≥ toxic threshold, RETAIL only if EVERY horizon
   * is ≤ retail threshold — so informed traders cannot hide by trading just beyond the primary horizon.
   * 'primary': use the primary horizon only.
   */
  tierRule: 'all-horizons' | 'primary';
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
  tierRule: 'all-horizons',
};

export const makeConfig = (overrides: Partial<ScoringConfig> = {}): ScoringConfig => ({
  ...DEFAULT_SCORING_CONFIG,
  ...overrides,
});
