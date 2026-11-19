use anchor_lang::prelude::*;

#[error_code]
pub enum FairwayError {
    #[msg("Only the config admin can do this")]
    Unauthorized,
    #[msg("Only the score authority can write scores")]
    NotScoreAuthority,
    #[msg("Fee schedule must satisfy RETAIL <= STANDARD <= TOXIC <= 1000 bps")]
    InvalidFeeSchedule,
    #[msg("Default tier must be STANDARD or TOXIC (fresh wallets never pay less than STANDARD)")]
    InvalidDefaultTier,
    #[msg("Tier must be 0 (RETAIL), 1 (STANDARD) or 2 (TOXIC)")]
    InvalidTier,
    #[msg("Output is below the minimum (slippage)")]
    SlippageExceeded,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Pool has no liquidity")]
    ZeroReserves,
    #[msg("Not enough liquidity")]
    InsufficientLiquidity,
    #[msg("Trade too small: output rounds to zero")]
    InsufficientOutput,
    #[msg("Math overflow")]
    Overflow,
    #[msg("Base and quote mints must differ")]
    SameMint,
    #[msg("Batch too large or accounts mismatch")]
    BadBatch,
    #[msg("Score account does not match the PDA for this trader")]
    ScoreAccountMismatch,
    #[msg("Only the trader (or the score authority, if no onchain evidence) can close a score")]
    CannotClose,
    #[msg("Pyth oracle is not configured")]
    OracleNotConfigured,
    #[msg("Oracle account is not the configured Pyth price account")]
    OracleMismatch,
    #[msg("Oracle account is invalid (owner, layout, feed id, verification or price)")]
    OracleInvalid,
    #[msg("Oracle price is stale")]
    OracleStale,
    #[msg("Oracle confidence interval is too wide")]
    OracleLowConfidence,
    #[msg("Invalid markout parameters")]
    InvalidMarkoutParams,
    #[msg("Protocol fee must be at most 50% (5000 bps)")]
    InvalidProtocolFee,
    #[msg("Withdrawal would take the treasury below its rent-exempt minimum")]
    TreasuryBelowFloor,
    #[msg("Rebate params: epoch_slots > 0, share <= 10000 bps, floor <= 1000 bps")]
    InvalidRebateParams,
    #[msg("The rebate epoch has not elapsed yet")]
    EpochNotElapsed,
    #[msg("Trading on this launch has not opened yet")]
    LaunchNotStarted,
    #[msg("A launch can only be configured before the pool's first swap")]
    LaunchAlreadyTrading,
    #[msg("Launch params: window 1..=216000 slots, launch slot not in the past, curve decays and is tier-ordered, fees <= 1000 bps")]
    InvalidLaunchParams,
    #[msg("The pool TWAP does not cover this trade's markout window")]
    TwapUnavailable,
    #[msg("Creator share + protocol fee must be at most 100% of the premium")]
    InvalidCreatorShare,
}

impl From<fairway_math::MathError> for FairwayError {
    fn from(e: fairway_math::MathError) -> Self {
        use fairway_math::MathError::*;
        match e {
            Overflow => FairwayError::Overflow,
            ZeroAmount => FairwayError::ZeroAmount,
            ZeroReserves => FairwayError::ZeroReserves,
            InvalidFee => FairwayError::InvalidFeeSchedule,
            InsufficientLiquidity => FairwayError::InsufficientLiquidity,
            InsufficientOutput => FairwayError::InsufficientOutput,
        }
    }
}

/// `?`-friendly conversion for math results.
pub trait MathExt<T> {
    fn m(self) -> Result<T>;
}
impl<T> MathExt<T> for core::result::Result<T, fairway_math::MathError> {
    fn m(self) -> Result<T> {
        self.map_err(|e| error!(FairwayError::from(e)))
    }
}
