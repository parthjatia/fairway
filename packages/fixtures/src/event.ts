/**
 * Encoding of Fairway's Anchor `SwapExecuted` event as it appears in logs:
 *   "Program data: " + base64( sha256("event:SwapExecuted")[0..8] ++ borsh(fields) )
 * Field order MUST match programs/fairway/src/events.rs.
 */
import { base58Decode } from './base58';

/** sha256("event:SwapExecuted")[0..8], precomputed (verified in tests) */
export const SWAP_EXECUTED_DISCRIMINATOR = Uint8Array.from([0x96, 0xa6, 0x1a, 0xe1, 0x1c, 0x59, 0x26, 0x4f]);

export type SwapExecutedEvent = {
  trader: string;
  pool: string;
  aToB: boolean;
  amountIn: bigint;
  amountOut: bigint;
  feeBps: number;
  tier: number;
};

export function encodeSwapExecuted(e: SwapExecutedEvent, discriminator = SWAP_EXECUTED_DISCRIMINATOR): string {
  const buf = new Uint8Array(8 + 32 + 32 + 1 + 8 + 8 + 2 + 1);
  const dv = new DataView(buf.buffer);
  buf.set(discriminator, 0);
  buf.set(base58Decode(e.trader), 8);
  buf.set(base58Decode(e.pool), 40);
  buf[72] = e.aToB ? 1 : 0;
  dv.setBigUint64(73, e.amountIn, true);
  dv.setBigUint64(81, e.amountOut, true);
  dv.setUint16(89, e.feeBps, true);
  buf[91] = e.tier;
  return Buffer.from(buf).toString('base64');
}
