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

#[constant]
pub const TREASURY_SEED: &[u8] = b"treasury";
/// Protocol's default share of swap fees: 15%.
pub const DEFAULT_PROTOCOL_FEE_BPS: u16 = 1_500;
/// Hard cap on the protocol share: 50%.
pub const MAX_PROTOCOL_FEE_BPS: u16 = 5_000;

/// Max scores per `set_scores_batch` transaction.
pub const MAX_BATCH: usize = 10;
pub const LP_DECIMALS: u8 = 6;

/// Owner of Pyth pull-oracle `PriceUpdateV2` accounts (Pyth Solana Receiver, same id on mainnet and devnet).
pub const PYTH_RECEIVER_PROGRAM: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// Longest allowed launch window: 216_000 slots ≈ 24 h.
pub const MAX_LAUNCH_WINDOW_SLOTS: u64 = 216_000;
