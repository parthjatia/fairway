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
    #[msg("Only the score authority or the trader can close a score")]
    CannotClose,
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
