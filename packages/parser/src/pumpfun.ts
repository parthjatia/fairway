/**
 * Pump.fun / PumpSwap launch-trade extraction (M16). Shared by streams/pumpfun-filter.js (bundled, standalone) and the
 * ingest service. ES2018, no BigInt, no Node APIs.
 *
 * Pool-agnostic on purpose: launches cannot be configured in advance, so a transaction counts when it invokes one of
 * the configured program ids. For each token mint whose balance changed:
 *   - trader = fee payer (first account key); the trader's token delta = Σ(post − pre) of token accounts owned by the trader
 *   - the "curve" = owner of the other token account for that mint whose balance moved the opposite way
 *     (Pump.fun bonding curve PDA, or the PumpSwap pool)
 *   - SOL leg = the curve's WSOL token-account delta if it has one (PumpSwap), else its lamport delta (Pump.fun keeps SOL
 *     as lamports in the bonding-curve account). Platform fees go to a fee recipient, so this is the pre-fee SOL amount.
 * A `create` record is emitted when the logs show Pump.fun's Create instruction (launch slot for that mint).
 *
 * Program ids verified onchain 2026-11-19 (mainnet). See streams/STREAM_CONFIG.md §Program IDs.
 */
import { accountKeysOf, blocksFromPayload } from './core';

export type PumpPrograms = { pumpfun: string; pumpswap: string };

/** Pump.fun bonding-curve program and PumpSwap AMM program (mainnet, verified 2026-11-19). */
export const PUMP_PROGRAMS: PumpPrograms = {
  pumpfun: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  pumpswap: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
};

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const IGNORED_MINTS: Record<string, boolean> = { [WSOL_MINT]: true, EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: true };

export type LaunchTradeRecord = {
  sig: string;
  slot: number;
  ts: number;
  mint: string;
  venue: 'pumpfun' | 'pumpswap';
  trader: string;
  kind: 'create' | 'buy' | 'sell';
  /** token amount (UI units), 0 for a create without a dev buy */
  tokenAmount: number;
  /** SOL in (buy) or out (sell), pre-fee */
  solAmount: number;
  /** SOL per token, pre-fee; 0 for create */
  price: number;
};

type Bal = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount?: string; decimals: number; uiAmountString?: string; uiAmount?: number | null } };

/** Raw integer amount (exact below 2^53) and decimals of a token balance entry. */
function rawOf(b: Bal | undefined): { raw: number; dec: number } {
  if (!b || !b.uiTokenAmount) return { raw: 0, dec: 0 };
  const u = b.uiTokenAmount;
  const dec = typeof u.decimals === 'number' ? u.decimals : 0;
  if (typeof u.amount === 'string') return { raw: Number(u.amount), dec };
  const ui = typeof u.uiAmountString === 'string' ? Number(u.uiAmountString) : typeof u.uiAmount === 'number' ? u.uiAmount : 0;
  return { raw: Math.round(ui * Math.pow(10, dec)), dec };
}

/** Per (mint, owner) token delta in UI units, computed from raw integer amounts (no float drift). */
function tokenDeltas(meta: any): { delta: Record<string, Record<string, number>> } {
  const pre: Bal[] = meta.preTokenBalances || [];
  const post: Bal[] = meta.postTokenBalances || [];
  const byIdx: Record<number, { mint: string; owner: string; a: number; b: number; dec: number }> = {};
  for (let i = 0; i < pre.length; i++) {
    const x = pre[i] as Bal;
    const r = rawOf(x);
    byIdx[x.accountIndex] = { mint: x.mint, owner: x.owner || '', a: r.raw, b: 0, dec: r.dec };
  }
  for (let i = 0; i < post.length; i++) {
    const x = post[i] as Bal;
    const r = rawOf(x);
    const e = byIdx[x.accountIndex] || (byIdx[x.accountIndex] = { mint: x.mint, owner: x.owner || '', a: 0, b: 0, dec: r.dec });
    e.b = r.raw;
    e.dec = r.dec;
    if (!e.owner && x.owner) e.owner = x.owner;
  }
  const rawDelta: Record<string, Record<string, { d: number; dec: number }>> = {};
  for (const k in byIdx) {
    const e = byIdx[k] as { mint: string; owner: string; a: number; b: number; dec: number };
    const m = rawDelta[e.mint] || (rawDelta[e.mint] = {});
    const cur = m[e.owner] || (m[e.owner] = { d: 0, dec: e.dec });
    cur.d += e.b - e.a;
  }
  const delta: Record<string, Record<string, number>> = {};
  for (const mint in rawDelta) {
    const m = rawDelta[mint] as Record<string, { d: number; dec: number }>;
    const o: Record<string, number> = (delta[mint] = {});
    for (const owner in m) o[owner] = (m[owner] as { d: number; dec: number }).d / Math.pow(10, (m[owner] as { d: number; dec: number }).dec);
  }
  return { delta };
}

const EPS = 1e-12;

export function parsePumpTransaction(tx: any, slot: number, ts: number, programs: PumpPrograms = PUMP_PROGRAMS): LaunchTradeRecord[] {
  const out: LaunchTradeRecord[] = [];
  const meta = tx && tx.meta;
  if (!meta || meta.err) return out;
  const sig = tx.transaction && tx.transaction.signatures && tx.transaction.signatures[0];
  if (!sig) return out;
  const keys = accountKeysOf(tx);
  const hasPump = keys.indexOf(programs.pumpfun) >= 0;
  const hasSwap = keys.indexOf(programs.pumpswap) >= 0;
  if (!hasPump && !hasSwap) return out;
  const venue: LaunchTradeRecord['venue'] = hasPump ? 'pumpfun' : 'pumpswap';
  const trader = keys[0] as string;
  const logs: string[] = meta.logMessages || [];
  let isCreate = false;
  for (let i = 0; i < logs.length; i++) if ((logs[i] as string).indexOf('Program log: Instruction: Create') === 0) isCreate = true;
  const { delta } = tokenDeltas(meta);
  const wsol = delta[WSOL_MINT] || {};
  let createdMint = '';
  for (const mint in delta) {
    if (IGNORED_MINTS[mint]) continue;
    const owners = delta[mint] as Record<string, number>;
    if (!createdMint) createdMint = mint;
    const td = owners[trader] || 0;
    if (Math.abs(td) < EPS) continue;
    // the counterparty account: moved the opposite way, the largest such move
    let curve = '';
    let best = 0;
    for (const o in owners) {
      const d = owners[o] as number;
      if (o === trader || !o) continue;
      if (d * td < 0 && Math.abs(d) > best) {
        best = Math.abs(d);
        curve = o;
      }
    }
    if (!curve) continue;
    let sol = 0;
    if (wsol[curve] !== undefined && Math.abs(wsol[curve] as number) > EPS) sol = Math.abs(wsol[curve] as number);
    else {
      const ci = keys.indexOf(curve);
      if (ci >= 0 && meta.preBalances && meta.postBalances) sol = Math.abs((meta.postBalances[ci] - meta.preBalances[ci]) / 1e9);
    }
    if (!(sol > 0)) continue;
    const tokens = Math.abs(td);
    out.push({ sig, slot, ts, mint, venue, trader, kind: td > 0 ? 'buy' : 'sell', tokenAmount: tokens, solAmount: sol, price: sol / tokens });
  }
  if (isCreate && createdMint) out.unshift({ sig, slot, ts, mint: createdMint, venue, trader, kind: 'create', tokenAmount: 0, solAmount: 0, price: 0 });
  return out;
}

/** Parse a whole Streams payload (array of getBlock-shaped blocks or wrappers); de-duplicated on (sig, mint, kind). */
export function parsePumpPayload(data: any, programs: PumpPrograms = PUMP_PROGRAMS): LaunchTradeRecord[] {
  const blocks = blocksFromPayload(data);
  const seen: Record<string, boolean> = {};
  const out: LaunchTradeRecord[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b || !b.transactions) continue;
    const slot = typeof b.slot === 'number' ? b.slot : typeof b.parentSlot === 'number' ? b.parentSlot + 1 : 0;
    const ts = typeof b.blockTime === 'number' ? b.blockTime : 0;
    for (let j = 0; j < b.transactions.length; j++) {
      const r = parsePumpTransaction(b.transactions[j], slot, ts, programs);
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
