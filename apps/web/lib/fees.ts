import type { Tier } from '@fairway/scoring';

/** LP-first schedule (M15): retail = standard = 30 bps, toxic 80. The RETAIL tier then earns a bot-tax rebate. */
export const BASE_FEE_BPS: Record<Tier, number> = { RETAIL: 30, STANDARD: 30, TOXIC: 80 };
/**
 * Illustrative rebate for the mock UI: what the simulator's recommended setting hands RETAIL-tier wallets on average
 * (10% of the toxic premium, ~2 bps). The real value is set per epoch onchain by `update_retail_fee`; it is 0 until an epoch has rolled.
 */
export const MOCK_RETAIL_REBATE_BPS = 2;
/** Protocol keeps this share of the toxic premium (Config.protocol_fee_bps). It takes nothing from retail or standard fees. */
export const PROTOCOL_PREMIUM_SHARE_BPS = 1_500;
export const TIER_FEE: Record<Tier, number> = { RETAIL: BASE_FEE_BPS.RETAIL - MOCK_RETAIL_REBATE_BPS, STANDARD: BASE_FEE_BPS.STANDARD, TOXIC: BASE_FEE_BPS.TOXIC };
