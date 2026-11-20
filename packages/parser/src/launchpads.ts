/**
 * Raydium LaunchLab (LetsBonk) and Meteora Dynamic Bonding Curve (Bags, Jupiter Studio, Believe) launch trades.
 * Shared by streams/launch-filter.js (bundled, standalone) and the ingest service. ES2018, no BigInt, no Node APIs.
 *
 * Both programs keep every launch's token vault and WSOL quote vault under ONE program-derived authority, so a trade is
 * the trader's token delta against the authority's opposite-moving token account, and the SOL leg is the authority's
 * WSOL delta (pre-fee, like Pump.fun). Requiring that authority also drops the many Jupiter-routed transactions that only
 * touch the program as one hop. Only SOL-quoted launches are covered: a USDC-quoted launch has no WSOL leg at the
 * authority, so its trades (and its create) are skipped.
 *
 * Verified on real mainnet blocks 2026-11-20 (getBlock, maxSupportedTransactionVersion 1):
 *   LaunchLab  trade logs  `Program log: Instruction: BuyExactIn` / `SellExactIn` (authority PDA seed "vault_auth_seed")
 *   Meteora DBC trade logs `Program log: Instruction: Swap2` / `Swap`, create `InitializeVirtualPoolWithToken2022`
 *              (or `...WithSplToken`) (authority PDA seed "pool_authority")
 * LaunchLab create: `Program log: Instruction: InitializeWithToken2022` (seen on a real mainnet launch 2026-11-20); `Initialize` / `InitializeV2` come from its IDL and were not seen.
 */
import { accountKeysOf, blocksFromPayload } from './core';
import { EPS, IGNORED_MINTS, parsePumpTransaction, PUMP_PROGRAMS, tokenDeltas, WSOL_MINT, type LaunchTradeRecord, type PumpPrograms } from './pumpfun';

export type Launchpad = { venue: 'launchlab' | 'meteora-dbc'; program: string; authority: string; createInstructions: string[] };

export const LAUNCHPADS: Launchpad[] = [
  {
    venue: 'launchlab',
    program: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
    authority: 'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh',
    createInstructions: ['Initialize', 'InitializeV2', 'InitializeWithToken2022'],
  },
  {
    venue: 'meteora-dbc',
    program: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
    authority: 'FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM',
    createInstructions: ['InitializeVirtualPoolWithSplToken', 'InitializeVirtualPoolWithToken2022'],
  },
];

/** Program-scoped create detection: the first log line right after `Program <id> invoke` is the instruction name. */
function hasCreate(logs: string[], pad: Launchpad): boolean {
  const inv = 'Program ' + pad.program + ' invoke';
  for (let i = 0; i < logs.length - 1; i++) {
    if ((logs[i] as string).indexOf(inv) !== 0) continue;
    const next = logs[i + 1] as string;
    const p = 'Program log: Instruction: ';
    if (next.indexOf(p) !== 0) continue;
    if (pad.createInstructions.indexOf(next.slice(p.length)) >= 0) return true;
  }
  return false;
}

export function parseLaunchpadTransaction(tx: any, slot: number, ts: number, pad: Launchpad): LaunchTradeRecord[] {
  const out: LaunchTradeRecord[] = [];
  const meta = tx && tx.meta;
  if (!meta || meta.err) return out;
  const sig = tx.transaction && tx.transaction.signatures && tx.transaction.signatures[0];
  if (!sig) return out;
  const keys = accountKeysOf(tx);
  if (keys.indexOf(pad.program) < 0) return out;
  const trader = keys[0] as string;
  const logs: string[] = meta.logMessages || [];
  const { delta } = tokenDeltas(meta);
  const solLeg = Math.abs(((delta[WSOL_MINT] || {})[pad.authority] as number) || 0);
  let createdMint = '';
  for (const mint in delta) {
    if (IGNORED_MINTS[mint]) continue;
    const owners = delta[mint] as Record<string, number>;
    const auth = owners[pad.authority] || 0;
    if (!createdMint && auth > EPS) createdMint = mint;
    const td = owners[trader] || 0;
    if (Math.abs(td) < EPS || auth * td >= 0 || !(solLeg > 0)) continue;
    const tokens = Math.abs(td);
    out.push({ sig, slot, ts, mint, venue: pad.venue, trader, kind: td > 0 ? 'buy' : 'sell', tokenAmount: tokens, solAmount: solLeg, price: solLeg / tokens });
  }
  // a create of a SOL-quoted launch: the authority's WSOL quote vault is initialised in the same transaction
  if (createdMint && hasCreate(logs, pad)) {
    const post: any[] = meta.postTokenBalances || [];
    let sol = false;
    for (let i = 0; i < post.length; i++) if (post[i].mint === WSOL_MINT && post[i].owner === pad.authority) sol = true;
    if (sol) out.unshift({ sig, slot, ts, mint: createdMint, venue: pad.venue, trader, kind: 'create', tokenAmount: 0, solAmount: 0, price: 0 });
  }
  return out;
}

/** Every covered venue (Pump.fun, PumpSwap, LaunchLab, Meteora DBC) for one transaction. */
export function parseLaunchTransaction(tx: any, slot: number, ts: number, programs: PumpPrograms = PUMP_PROGRAMS, pads: Launchpad[] = LAUNCHPADS): LaunchTradeRecord[] {
  const r = parsePumpTransaction(tx, slot, ts, programs);
  if (r.length) return r;
  for (let i = 0; i < pads.length; i++) {
    const x = parseLaunchpadTransaction(tx, slot, ts, pads[i] as Launchpad);
    if (x.length) return x;
  }
  return [];
}

/** Parse a whole Streams payload for all covered launchpads; de-duplicated on (sig, mint, kind). */
export function parseLaunchPayload(data: any, programs: PumpPrograms = PUMP_PROGRAMS, pads: Launchpad[] = LAUNCHPADS): LaunchTradeRecord[] {
  const blocks = blocksFromPayload(data);
  const seen: Record<string, boolean> = {};
  const out: LaunchTradeRecord[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b || !b.transactions) continue;
    const slot = typeof b.slot === 'number' ? b.slot : typeof b.parentSlot === 'number' ? b.parentSlot + 1 : 0;
    const ts = typeof b.blockTime === 'number' ? b.blockTime : 0;
    for (let j = 0; j < b.transactions.length; j++) {
      const r = parseLaunchTransaction(b.transactions[j], slot, ts, programs, pads);
      for (let k = 0; k < r.length; k++) {
        const x = r[k] as LaunchTradeRecord;
        const key = x.sig + ':' + x.mint + ':' + x.kind;
        if (seen[key]) continue;
        seen[key] = true;
        out.push(x);
      }
    }
  }
  return out;
}
