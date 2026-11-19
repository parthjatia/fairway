import type { Swap } from '@fairway/scoring';
import type { ParsedSwap, ParserPool } from './core';
import { parsePayload } from './core';

export * from './core';
export * from './pumpfun';

/** Strip parser-only fields → canonical Swap. */
export const toSwap = ({ source: _source, ...s }: ParsedSwap): Swap => s;

export function parseToSwaps(payload: unknown, pools: ParserPool[]): Swap[] {
  return parsePayload(payload, pools).map(toSwap);
}

/** Convert fixture pools (or any pool with the same fields) to parser config. */
export const toParserPools = (pools: ReadonlyArray<ParserPool & Record<string, unknown>>): ParserPool[] =>
  pools.map((p) => ({ id: p.id, venue: p.venue, baseVault: p.baseVault, quoteVault: p.quoteVault, feeBps: p.feeBps, baseDecimals: p.baseDecimals, quoteDecimals: p.quoteDecimals }));
