/**
 * Wallet funding transfers (M16 step 11, bundler detection). Shared by streams/pumpfun-filter.js (bundled) and ingest.
 * ES2018, no BigInt, no Node APIs.
 *
 * A "funding" is SOL sent by the fee payer to a BRAND-NEW account (lamport balance 0 before the transaction) in a
 * transaction whose top-level instructions are only System Program (transfer / createAccount) and Compute Budget.
 * That is how a bundler prepares fresh wallets: one source wallet sends SOL to several new addresses shortly before a
 * launch, then each address buys in the first slots. Balance deltas, not instruction decoding, so it works on the
 * plain `json` block encoding. Limits: SOL routed through an exchange withdrawal or an intermediate hop has a different
 * funder per wallet and is not linked (see docs/RISKS.md §10b).
 */
import { accountKeysOf, blocksFromPayload } from './core';

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';

export type FundingRecord = {
  sig: string;
  slot: number;
  ts: number;
  /** fee payer that sent the SOL */
  funder: string;
  /** the new account that received it */
  wallet: string;
  /** SOL received (UI units) */
  sol: number;
};

/** Transfers below this are ignored (rent top-ups, dust): 0.05 SOL. */
export const MIN_FUNDING_SOL = 0.05;

function programIdsOf(tx: any, keys: string[]): string[] {
  const msg = tx && tx.transaction && tx.transaction.message;
  const ixs: any[] = (msg && msg.instructions) || [];
  const out: string[] = [];
  for (let i = 0; i < ixs.length; i++) {
    const ix = ixs[i];
    if (ix && typeof ix.programId === 'string') out.push(ix.programId);
    else if (ix && typeof ix.programIdIndex === 'number') out.push(keys[ix.programIdIndex] as string);
  }
  return out;
}

export function parseFundingTransaction(tx: any, slot: number, ts: number, minSol: number = MIN_FUNDING_SOL): FundingRecord[] {
  const out: FundingRecord[] = [];
  const meta = tx && tx.meta;
  if (!meta || meta.err || !meta.preBalances || !meta.postBalances) return out;
  const sig = tx.transaction && tx.transaction.signatures && tx.transaction.signatures[0];
  if (!sig) return out;
  const keys = accountKeysOf(tx);
  const progs = programIdsOf(tx, keys);
  let hasSystem = false;
  for (let i = 0; i < progs.length; i++) {
    if (progs[i] === SYSTEM_PROGRAM_ID) hasSystem = true;
    else if (progs[i] !== COMPUTE_BUDGET_PROGRAM_ID) return out;
  }
  if (!hasSystem) return out;
  const funder = keys[0] as string;
  const spent = (meta.preBalances[0] as number) - (meta.postBalances[0] as number);
  let total = 0;
  const found: FundingRecord[] = [];
  for (let i = 1; i < keys.length; i++) {
    const pre = meta.preBalances[i] as number;
    const post = meta.postBalances[i] as number;
    if (pre !== 0 || !(post > 0)) continue;
    const sol = post / 1e9;
    if (sol < minSol) continue;
    const wallet = keys[i] as string;
    if (wallet === funder || wallet === SYSTEM_PROGRAM_ID || wallet === COMPUTE_BUDGET_PROGRAM_ID) continue;
    total += post;
    found.push({ sig, slot, ts, funder, wallet, sol });
  }
  // the SOL must have come from the fee payer (not, e.g., a multisig vault in the same transaction)
  if (!found.length || spent < total) return out;
  for (let i = 0; i < found.length; i++) out.push(found[i] as FundingRecord);
  return out;
}

/** Parse a whole Streams payload; de-duplicated on (sig, wallet). */
export function parseFundingPayload(data: any, minSol: number = MIN_FUNDING_SOL): FundingRecord[] {
  const blocks = blocksFromPayload(data);
  const seen: Record<string, boolean> = {};
  const out: FundingRecord[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b || !b.transactions) continue;
    const slot = typeof b.slot === 'number' ? b.slot : typeof b.parentSlot === 'number' ? b.parentSlot + 1 : 0;
    const ts = typeof b.blockTime === 'number' ? b.blockTime : 0;
    for (let j = 0; j < b.transactions.length; j++) {
      const r = parseFundingTransaction(b.transactions[j], slot, ts, minSol);
      for (let k = 0; k < r.length; k++) {
        const x = r[k] as FundingRecord;
        const key = x.sig + ':' + x.wallet;
        if (seen[key]) continue;
        seen[key] = true;
        out.push(x);
      }
    }
  }
  return out;
}
