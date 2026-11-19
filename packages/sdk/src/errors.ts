/** Mirrors programs/fairway/src/error.rs (Anchor custom errors start at 6000, in declaration order). */
export const FAIRWAY_ERRORS = [
  ['Unauthorized', 'Only the config admin can do this'],
  ['NotScoreAuthority', 'Only the score authority can write scores'],
  ['InvalidFeeSchedule', 'Fee schedule must satisfy RETAIL <= STANDARD <= TOXIC <= 1000 bps'],
  ['InvalidDefaultTier', 'Default tier must be STANDARD or TOXIC (fresh wallets never pay less than STANDARD)'],
  ['InvalidTier', 'Tier must be 0 (RETAIL), 1 (STANDARD) or 2 (TOXIC)'],
  ['SlippageExceeded', 'Output is below the minimum (slippage)'],
  ['ZeroAmount', 'Amount must be greater than zero'],
  ['ZeroReserves', 'Pool has no liquidity'],
  ['InsufficientLiquidity', 'Not enough liquidity'],
  ['InsufficientOutput', 'Trade too small: output rounds to zero'],
  ['Overflow', 'Math overflow'],
  ['SameMint', 'Base and quote mints must differ'],
  ['BadBatch', 'Batch too large or accounts mismatch'],
  ['ScoreAccountMismatch', 'Score account does not match the PDA for this trader'],
  ['CannotClose', 'Only the trader (or the score authority, if no onchain evidence) can close a score'],
  ['OracleNotConfigured', 'Pyth oracle is not configured'],
  ['OracleMismatch', 'Oracle account is not the configured Pyth price account'],
  ['OracleInvalid', 'Oracle account is invalid (owner, layout, feed id, verification or price)'],
  ['OracleStale', 'Oracle price is stale'],
  ['OracleLowConfidence', 'Oracle confidence interval is too wide'],
  ['InvalidMarkoutParams', 'Invalid markout parameters'],
  ['InvalidProtocolFee', 'Protocol fee must be at most 50% (5000 bps)'],
  ['TreasuryBelowFloor', 'Withdrawal would take the treasury below its rent-exempt minimum'],
  ['InvalidRebateParams', 'Rebate params: epoch_slots > 0, share <= 10000 bps, floor <= 1000 bps'],
  ['EpochNotElapsed', 'The rebate epoch has not elapsed yet'],
  ['LaunchNotStarted', 'Trading on this launch has not opened yet'],
  ['LaunchAlreadyTrading', "A launch can only be configured before the pool's first swap"],
  ['InvalidLaunchParams', 'Launch params: window 1..=216000 slots, launch slot not in the past, curve decays and is tier-ordered, fees <= 1000 bps'],
  ['TwapUnavailable', "The pool TWAP does not cover this trade's markout window"],
] as const;

export type FairwayErrorName = (typeof FAIRWAY_ERRORS)[number][0];

/** A few Anchor framework errors that matter to Fairway users. */
export const ANCHOR_ERRORS: Record<number, [string, string]> = {
  2006: ['ConstraintSeeds', 'A seeds constraint was violated (e.g. passing another wallet’s score account)'],
  2001: ['ConstraintHasOne', 'A has_one constraint was violated'],
  2012: ['ConstraintAddress', 'An address constraint was violated'],
  3012: ['AccountNotInitialized', 'The program expected this account to be already initialized'],
};

export class FairwayError extends Error {
  constructor(
    readonly code: number,
    readonly errorName: string,
    message: string,
  ) {
    super(`${errorName} (${code}): ${message}`);
    this.name = 'FairwayError';
  }
}

export function errorFromCode(code: number): FairwayError | null {
  if (code >= 6000 && code < 6000 + FAIRWAY_ERRORS.length) {
    const [n, m] = FAIRWAY_ERRORS[code - 6000]!;
    return new FairwayError(code, n, m);
  }
  const a = ANCHOR_ERRORS[code];
  return a ? new FairwayError(code, a[0], a[1]) : null;
}

/** Extract a typed error from a thrown SendTransactionError / simulation result / logs. */
export function parseFairwayError(err: unknown, logs?: readonly string[]): FairwayError | null {
  const candidates: string[] = [];
  if (logs) candidates.push(...logs);
  if (err && typeof err === 'object') {
    const anyErr = err as { logs?: string[]; message?: string; InstructionError?: [number, { Custom?: number }] };
    if (Array.isArray(anyErr.logs)) candidates.push(...anyErr.logs);
    if (anyErr.message) candidates.push(anyErr.message);
    const custom = anyErr.InstructionError?.[1]?.Custom;
    if (typeof custom === 'number') return errorFromCode(custom);
  }
  if (typeof err === 'string') candidates.push(err);
  for (const c of candidates) {
    const m = c.match(/Error Number: (\d+)/) ?? c.match(/custom program error: 0x([0-9a-f]+)/i);
    if (m) {
      const code = c.includes('0x') && !c.includes('Error Number') ? parseInt(m[1]!, 16) : Number(m[1]);
      const e = errorFromCode(code);
      if (e) return e;
    }
  }
  return null;
}
