import { PublicKey } from '@solana/web3.js';
import { bytesEqual, discriminator, Reader } from './borsh';
import { TIER_NAMES, type TierName } from './constants';

export type SwapExecutedEvent = {
  trader: PublicKey;
  pool: PublicKey;
  aToB: boolean;
  amountIn: bigint;
  amountOut: bigint;
  feeBps: number;
  tier: number;
  tierName: TierName;
};

export const SWAP_EXECUTED_DISC = discriminator('event', 'SwapExecuted');

const b64 = (s: string): Uint8Array => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export function decodeSwapExecuted(data: Uint8Array): SwapExecutedEvent | null {
  if (data.length < 92 || !bytesEqual(data.slice(0, 8), SWAP_EXECUTED_DISC)) return null;
  const r = new Reader(data).skip(8);
  const trader = r.pubkey();
  const pool = r.pubkey();
  const aToB = r.bool();
  const amountIn = r.u64();
  const amountOut = r.u64();
  const feeBps = r.u16();
  const tier = r.u8();
  return { trader, pool, aToB, amountIn, amountOut, feeBps, tier, tierName: TIER_NAMES[tier] ?? 'STANDARD' };
}

/** Find SwapExecuted events in a transaction's log messages ("Program data: <base64>"). */
export function parseSwapEvents(logs: readonly string[]): SwapExecutedEvent[] {
  const out: SwapExecutedEvent[] = [];
  for (const l of logs) {
    if (!l.startsWith('Program data: ')) continue;
    const ev = decodeSwapExecuted(b64(l.slice('Program data: '.length).trim()));
    if (ev) out.push(ev);
  }
  return out;
}
