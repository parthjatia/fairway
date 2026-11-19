/**
 * Fairway swap parser core: Solana `getBlock`-shaped blocks → canonical swap records.
 *
 * THIS FILE IS SELF-CONTAINED ON PURPOSE: no imports, no BigInt, no Node/DOM APIs, ES2018 syntax.
 * `streams/build-filter.ts` strips the types with esbuild and inlines it verbatim into
 * `streams/filter.js` (the QuickNode Streams filter), so the filter and the services run the
 * exact same code. A test fails if filter.js is stale.
 */

export type ParserPool = {
  id: string;
  venue: 'fairway' | 'raydium' | 'orca' | 'meteora' | 'fixture';
  baseVault: string;
  quoteVault: string;
  /** used for the pre-fee price approximation when no event is available */
  feeBps: number;
  baseDecimals?: number;
  quoteDecimals?: number;
};

export type ParsedSwap = {
  sig: string;
  slot: number;
  ts: number;
  pool: string;
  venue: ParserPool['venue'];
  trader: string;
  side: 'buy' | 'sell';
  baseAmount: number;
  quoteAmount: number;
  execPrice: number;
  feeBps: number;
  tier?: 'RETAIL' | 'STANDARD' | 'TOXIC';
  /** 'event' = decoded Fairway SwapExecuted; 'vault-delta' = inferred from token balances */
  source: 'event' | 'vault-delta';
};

type AnyKey = string | { pubkey: string };
type TokenBal = { accountIndex: number; mint?: string; uiTokenAmount?: { amount?: string; decimals?: number; uiAmountString?: string; uiAmount?: number | null } };

const TIERS: Array<'RETAIL' | 'STANDARD' | 'TOXIC'> = ['RETAIL', 'STANDARD', 'TOXIC'];
/** sha256("event:SwapExecuted")[0..8] */
const SWAP_EXECUTED_DISC = [0x96, 0xa6, 0x1a, 0xe1, 0x1c, 0x59, 0x26, 0x4f];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBytes(s: string): number[] {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === '=') break;
    const v = B64.indexOf(c);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}

export function bytesToBase58(bytes: number[]): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i] as number;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j] as number) << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let s = '';
  for (let i = 0; i < zeros; i++) s += '1';
  for (let i = digits.length - 1; i >= 0; i--) s += B58.charAt(digits[i] as number);
  return s;
}

/** little-endian u64 from bytes as a JS number (exact below 2^53) */
function u64At(b: number[], o: number): number {
  let lo = 0;
  let hi = 0;
  for (let i = 3; i >= 0; i--) lo = lo * 256 + (b[o + i] as number);
  for (let i = 7; i >= 4; i--) hi = hi * 256 + (b[o + i] as number);
  return hi * 4294967296 + lo;
}

export type DecodedSwapEvent = { trader: string; pool: string; aToB: boolean; amountIn: number; amountOut: number; feeBps: number; tier: number };

/** Decode Fairway `SwapExecuted` events from "Program data: <base64>" log lines. */
export function decodeSwapEvents(logs: string[] | null | undefined): DecodedSwapEvent[] {
  const out: DecodedSwapEvent[] = [];
  if (!logs) return out;
  for (let i = 0; i < logs.length; i++) {
    const l = logs[i];
    if (typeof l !== 'string' || l.indexOf('Program data: ') !== 0) continue;
    const b = base64ToBytes(l.slice(14).trim());
    if (b.length < 92) continue;
    let match = true;
    for (let j = 0; j < 8; j++) if (b[j] !== SWAP_EXECUTED_DISC[j]) match = false;
    if (!match) continue;
    out.push({
      trader: bytesToBase58(b.slice(8, 40)),
      pool: bytesToBase58(b.slice(40, 72)),
      aToB: b[72] === 1,
      amountIn: u64At(b, 73),
      amountOut: u64At(b, 81),
      feeBps: (b[89] as number) | ((b[90] as number) << 8),
      tier: b[91] as number,
    });
  }
  return out;
}

/** exact (post − pre) for raw integer strings, as a number (exact while |diff| < 2^53) */
function rawDiff(pre: string, post: string): number {
  if (pre.length <= 15 && post.length <= 15) return Number(post) - Number(pre);
  const split = (s: string) => (s.length > 9 ? [Number(s.slice(0, s.length - 9)), Number(s.slice(s.length - 9))] : [0, Number(s)]);
  const a = split(pre);
  const c = split(post);
  return ((c[0] as number) - (a[0] as number)) * 1e9 + ((c[1] as number) - (a[1] as number));
}

function rawOf(tb: TokenBal | undefined): { raw: string; decimals: number } | null {
  if (!tb || !tb.uiTokenAmount) return null;
  const u = tb.uiTokenAmount;
  const decimals = typeof u.decimals === 'number' ? u.decimals : 0;
  if (typeof u.amount === 'string' && /^\d+$/.test(u.amount)) return { raw: u.amount, decimals };
  // fallback: uiAmountString / uiAmount (less precise)
  const ui = typeof u.uiAmountString === 'string' ? Number(u.uiAmountString) : typeof u.uiAmount === 'number' ? u.uiAmount : NaN;
  if (!isFinite(ui)) return null;
  return { raw: String(Math.round(ui * Math.pow(10, decimals))), decimals };
}

/** Full account key list: static keys (strings or {pubkey}) + ALT writable + ALT readonly. */
export function accountKeysOf(tx: any): string[] {
  const msg = tx && tx.transaction && tx.transaction.message;
  const keys: string[] = [];
  const raw: AnyKey[] = (msg && msg.accountKeys) || [];
  for (let i = 0; i < raw.length; i++) {
    const k = raw[i];
    keys.push(typeof k === 'string' ? k : k && (k as { pubkey: string }).pubkey);
  }
  const la = tx && tx.meta && tx.meta.loadedAddresses;
  if (la) {
    const w = la.writable || [];
    const r = la.readonly || [];
    for (let i = 0; i < w.length; i++) keys.push(w[i]);
    for (let i = 0; i < r.length; i++) keys.push(r[i]);
  }
  return keys;
}

type VaultRef = { pool: ParserPool; isBase: boolean };

export function buildVaultIndex(pools: ParserPool[]): Record<string, VaultRef> {
  const idx: Record<string, VaultRef> = {};
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i] as ParserPool;
    if (!p || !p.baseVault || !p.quoteVault || p.baseVault.indexOf('<') === 0) continue; // skip placeholders
    idx[p.baseVault] = { pool: p, isBase: true };
    idx[p.quoteVault] = { pool: p, isBase: false };
  }
  return idx;
}

/** Parse one transaction. Returns one swap per configured pool whose vaults moved in opposite directions. */
export function parseTransaction(tx: any, slot: number, ts: number, vaultIndex: Record<string, VaultRef>): ParsedSwap[] {
  const out: ParsedSwap[] = [];
  const meta = tx && tx.meta;
  if (!meta || meta.err) return out; // failed or meta-less transactions never count
  const sig = tx.transaction && tx.transaction.signatures && tx.transaction.signatures[0];
  if (!sig) return out;
  const keys = accountKeysOf(tx);
  const pre: TokenBal[] = meta.preTokenBalances || [];
  const post: TokenBal[] = meta.postTokenBalances || [];
  // per pool: {base: {diff, decimals}, quote: {...}}
  const moves: Record<string, { pool: ParserPool; base?: { d: number; dec: number }; quote?: { d: number; dec: number } }> = {};
  const seen: Record<number, boolean> = {};
  const consider = (accountIndex: number) => {
    if (seen[accountIndex]) return;
    seen[accountIndex] = true;
    const key = keys[accountIndex];
    const ref = key ? vaultIndex[key] : undefined;
    if (!ref) return;
    let a: TokenBal | undefined;
    let b: TokenBal | undefined;
    for (let i = 0; i < pre.length; i++) if ((pre[i] as TokenBal).accountIndex === accountIndex) a = pre[i];
    for (let i = 0; i < post.length; i++) if ((post[i] as TokenBal).accountIndex === accountIndex) b = post[i];
    const ra = rawOf(a);
    const rb = rawOf(b);
    if (!ra && !rb) return;
    const dec = rb ? rb.decimals : (ra as { decimals: number }).decimals;
    const d = rawDiff(ra ? ra.raw : '0', rb ? rb.raw : '0');
    const m = moves[ref.pool.id] || (moves[ref.pool.id] = { pool: ref.pool });
    if (ref.isBase) m.base = { d, dec };
    else m.quote = { d, dec };
  };
  for (let i = 0; i < pre.length; i++) consider((pre[i] as TokenBal).accountIndex);
  for (let i = 0; i < post.length; i++) consider((post[i] as TokenBal).accountIndex);

  let events: DecodedSwapEvent[] | null = null;
  const trader = keys[0] as string;
  for (const id in moves) {
    const m = moves[id] as { pool: ParserPool; base?: { d: number; dec: number }; quote?: { d: number; dec: number } };
    if (!m.base || !m.quote || m.base.d === 0 || m.quote.d === 0) continue;
    let side: 'buy' | 'sell';
    if (m.base.d < 0 && m.quote.d > 0) side = 'buy';
    else if (m.base.d > 0 && m.quote.d < 0) side = 'sell';
    else continue; // both up / both down → liquidity add / remove
    const baseDec = typeof m.pool.baseDecimals === 'number' ? m.pool.baseDecimals : m.base.dec;
    const quoteDec = typeof m.pool.quoteDecimals === 'number' ? m.pool.quoteDecimals : m.quote.dec;
    const baseAmount = Math.abs(m.base.d) / Math.pow(10, baseDec);
    const quoteAmount = Math.abs(m.quote.d) / Math.pow(10, quoteDec);
    let feeBps = m.pool.feeBps;
    let tier: ParsedSwap['tier'];
    let source: ParsedSwap['source'] = 'vault-delta';
    if (m.pool.venue === 'fairway') {
      if (events === null) events = decodeSwapEvents(meta.logMessages);
      for (let i = 0; i < events.length; i++) {
        const e = events[i] as DecodedSwapEvent;
        if (e.pool === m.pool.id && e.aToB === (side === 'sell')) {
          feeBps = e.feeBps;
          tier = TIERS[e.tier] || 'STANDARD';
          source = 'event';
          break;
        }
      }
    }
    // Pre-fee execution price. The fee is charged on the INPUT and stays in the vault, so the vault delta of
    // the input token is the gross amount: buy → quote is input; sell → base is input.
    // (Approximation for external venues: uses the pool's configured fee; exact for Fairway via the event.)
    const f = feeBps / 10000;
    const execPrice = side === 'buy' ? (quoteAmount * (1 - f)) / baseAmount : quoteAmount / (baseAmount * (1 - f));
    const rec: ParsedSwap = { sig, slot, ts, pool: m.pool.id, venue: m.pool.venue, trader, side, baseAmount, quoteAmount, execPrice, feeBps, source };
    if (tier) rec.tier = tier;
    out.push(rec);
  }
  return out;
}

/** Parse one getBlock-shaped block. Slot = block.slot if present, else parentSlot + 1. */
export function parseBlock(block: any, pools: ParserPool[], vaultIndex?: Record<string, VaultRef>): ParsedSwap[] {
  const out: ParsedSwap[] = [];
  if (!block || !block.transactions) return out;
  const idx = vaultIndex || buildVaultIndex(pools);
  const slot = typeof block.slot === 'number' ? block.slot : typeof block.parentSlot === 'number' ? block.parentSlot + 1 : 0;
  const ts = typeof block.blockTime === 'number' ? block.blockTime : 0;
  for (let i = 0; i < block.transactions.length; i++) {
    const r = parseTransaction(block.transactions[i], slot, ts, idx);
    for (let j = 0; j < r.length; j++) out.push(r[j] as ParsedSwap);
  }
  return out;
}

/**
 * Normalise a Streams payload into a list of blocks. Handles: an array of blocks, an array of arrays,
 * a single block, and `{ data: [...] }` / `{ block: {...} }` wrappers.
 */
export function blocksFromPayload(data: any): any[] {
  const out: any[] = [];
  const visit = (x: any, depth: number) => {
    if (!x || depth > 4) return;
    if (Array.isArray(x)) {
      for (let i = 0; i < x.length; i++) visit(x[i], depth + 1);
      return;
    }
    if (x.transactions && (x.blockTime !== undefined || x.parentSlot !== undefined)) {
      out.push(x);
      return;
    }
    if (x.data) visit(x.data, depth + 1);
    else if (x.block) visit(x.block, depth + 1);
  };
  visit(data, 0);
  return out;
}

/** Parse a whole Streams payload; de-duplicated on (sig, pool). */
export function parsePayload(data: any, pools: ParserPool[]): ParsedSwap[] {
  const idx = buildVaultIndex(pools);
  const blocks = blocksFromPayload(data);
  const seen: Record<string, boolean> = {};
  const out: ParsedSwap[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const r = parseBlock(blocks[i], pools, idx);
    for (let j = 0; j < r.length; j++) {
      const s = r[j] as ParsedSwap;
      const k = s.sig + ':' + s.pool;
      if (seen[k]) continue;
      seen[k] = true;
      out.push(s);
    }
  }
  return out;
}
