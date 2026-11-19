use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const POOL_SEED: &[u8] = b"pool";
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
#[constant]
pub const LP_MINT_SEED: &[u8] = b"lp_mint";
#[constant]
pub const SCORE_SEED: &[u8] = b"score";

/// Max scores per `set_scores_batch` transaction.
pub const MAX_BATCH: usize = 10;
pub const LP_DECIMALS: u8 = 6;
