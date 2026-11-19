use anchor_lang::prelude::*;

/// Emitted on every swap. Field order is part of the public interface: the Streams filter and
/// parser decode it from "Program data:" logs (see packages/parser, streams/filter.js).
#[event]
pub struct SwapExecuted {
    pub trader: Pubkey,
    pub pool: Pubkey,
    /// true = base → quote (trader sells base)
    pub a_to_b: bool,
    pub amount_in: u64,
    pub amount_out: u64,
    pub fee_bps: u16,
    pub tier: u8,
}

#[event]
pub struct ScoreUpdated {
    pub trader: Pubkey,
    pub tier: u8,
    pub score_bps: i32,
    pub trades: u32,
    pub slot: u64,
}

#[event]
pub struct MarkoutSettled {
    pub trader: Pubkey,
    pub settled: u8,
    pub expired: u8,
    pub tier: u8,
    pub score_bps: i32,
    pub sum_notional: u64,
    pub trade_count: u32,
    pub slot: u64,
}
