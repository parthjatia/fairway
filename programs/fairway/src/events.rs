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

/// Emitted when the retail rebate is rolled to a new epoch.
#[event]
pub struct RetailFeeUpdated {
    pub pool: Pubkey,
    pub epoch_start_slot: u64,
    pub slot: u64,
    /// toxic premium and RETAIL-tier volume of the epoch that just ended (quote equivalents)
    pub premium_q: u64,
    pub retail_volume_q: u64,
    pub rebate_bps: u16,
    pub budget_q: u64,
    /// resulting RETAIL fee, bps
    pub retail_fee_bps: u16,
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
