import { createHash } from 'node:crypto';
import type { Swap } from '@fairway/scoring';
import { TIER_INDEX } from '@fairway/scoring';
import { base58Encode } from './base58';
import { encodeSwapExecuted } from './event';
import type { FixturePool, Market } from './market';
import { PROGRAMS } from './market';
import { Rng } from './rng';

/** Minimal getBlock-shaped types (json / jsonParsed encodings, maxSupportedTransactionVersion=0). */
export type UiTokenAmount = { amount: string; decimals: number; uiAmount: number | null; uiAmountString: string };
export type TokenBalance = { accountIndex: number; mint: string; owner?: string; programId?: string; uiTokenAmount: UiTokenAmount };
export type ParsedAccountKey = { pubkey: string; signer: boolean; writable: boolean; source?: 'transaction' | 'lookupTable' };
export type RpcTransaction = {
  transaction: {
    signatures: string[];
    message: {
      accountKeys: Array<string | ParsedAccountKey>;
      header?: { numRequiredSignatures: number; numReadonlySignedAccounts: number; numReadonlyUnsignedAccounts: number };
      instructions: Array<{ programIdIndex?: number; programId?: string; accounts: number[] | string[]; data: string }>;
      recentBlockhash: string;
      addressTableLookups?: Array<{ accountKey: string; writableIndexes: number[]; readonlyIndexes: number[] }>;
    };
  };
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances: TokenBalance[];
    postTokenBalances: TokenBalance[];
    logMessages: string[];
    loadedAddresses?: { writable: string[]; readonly: string[] };
    computeUnitsConsumed?: number;
  } | null;
  version?: 'legacy' | 0;
};
export type RpcBlock = {
  blockHeight: number | null;
  blockTime: number | null;
  blockhash: string;
  parentSlot: number;
  previousBlockhash: string;
  transactions: RpcTransaction[];
  rewards?: unknown[];
  /** not part of getBlock; some Streams payloads add it. Parser falls back to parentSlot + 1. */
  slot?: number;
};

const derive = (...parts: string[]) => base58Encode(createHash('sha256').update(parts.join('/')).digest());
const toRaw = (ui: number, decimals: number) => BigInt(Math.round(ui * 10 ** decimals));
const uiAmt = (raw: bigint, decimals: number): UiTokenAmount => {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const s = abs.toString().padStart(decimals + 1, '0');
  const str = (neg ? '-' : '') + (decimals ? `${s.slice(0, -decimals)}.${s.slice(-decimals)}` : s);
  const trimmed = decimals ? str.replace(/\.?0+$/, '') : str;
  return { amount: raw.toString(), decimals, uiAmount: Number(trimmed), uiAmountString: trimmed };
};

type BalanceChange = { account: string; mint: string; owner: string; decimals: number; pre: bigint; post: bigint };

export type EdgeCaseKind = 'failed' | 'liquidity-add' | 'liquidity-remove' | 'unrelated-transfer' | 'vote' | 'fairway-no-event';

export type BlocksFixture = {
  blocks: RpcBlock[];
  /** swaps a correct parser must produce from `blocks` for the configured pools, in order */
  expected: Swap[];
  edgeCases: Array<{ sig: string; kind: EdgeCaseKind; note: string }>;
};

/**
 * Render a window of market swaps as getBlock-shaped blocks, sprinkling in edge cases:
 * v0 transactions with vaults in address lookup tables (Orca), jsonParsed account keys + Anchor
 * events (Fairway), failed transactions, liquidity adds/removes, unrelated transfers and votes.
 */
export function buildBlocks(market: Market, opts: { fromIndex?: number; count?: number; seed?: number } = {}): BlocksFixture {
  const rng = new Rng(opts.seed ?? 4242);
  const count = opts.count ?? 300;
  const from = opts.fromIndex ?? Math.max(0, market.swaps.length - count);
  const window = market.swaps.slice(from, from + count);
  const poolById = new Map(market.pools.map((p) => [p.id, p]));

  // vault balances (raw) replayed from genesis using GROSS amounts (fees stay in the vault)
  const vault = new Map<string, bigint>();
  for (const p of market.pools) {
    vault.set(p.baseVault, toRaw(p.initialBase, p.baseDecimals));
    vault.set(p.quoteVault, toRaw(p.initialBase * market.config.s0, p.quoteDecimals));
  }
  const applySwap = (s: Swap, p: FixturePool) => {
    const b = toRaw(s.baseAmount, p.baseDecimals);
    const q = toRaw(s.quoteAmount, p.quoteDecimals);
    const sign = s.side === 'buy' ? -1n : 1n;
    vault.set(p.baseVault, vault.get(p.baseVault)! + sign * b);
    vault.set(p.quoteVault, vault.get(p.quoteVault)! - sign * q);
  };
  for (let i = 0; i < from; i++) applySwap(market.swaps[i]!, poolById.get(market.swaps[i]!.pool)!);

  const bySlot = new Map<number, RpcTransaction[]>();
  const blockTimeBySlot = new Map<number, number>();
  const push = (slot: number, ts: number, tx: RpcTransaction) => {
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot)!.push(tx);
    blockTimeBySlot.set(slot, ts);
  };
  const edgeCases: BlocksFixture['edgeCases'] = [];
  const sig = () => base58Encode(rng.bytes(64));
  const blockhash = () => base58Encode(rng.bytes(32));

  const tokenBalances = (keys: string[], changes: BalanceChange[]) => {
    const pre: TokenBalance[] = [];
    const post: TokenBalance[] = [];
    for (const c of changes) {
      const accountIndex = keys.indexOf(c.account);
      if (accountIndex < 0) throw new Error('balance account missing from keys');
      const base = { accountIndex, mint: c.mint, owner: c.owner, programId: PROGRAMS.token };
      pre.push({ ...base, uiTokenAmount: uiAmt(c.pre, c.decimals) });
      post.push({ ...base, uiTokenAmount: uiAmt(c.post, c.decimals) });
    }
    return { pre, post };
  };

  const traderAtas = (trader: string, p: FixturePool) => ({ base: derive('ata', trader, p.baseMint), quote: derive('ata', trader, p.quoteMint) });

  /** build one swap-like tx. deltas are signed raw amounts for the vaults (from the pool's view). */
  const makeTx = (o: {
    signature: string;
    pool: FixturePool;
    trader: string;
    baseDelta: bigint;
    quoteDelta: bigint;
    err?: unknown;
    layout: 'legacy-strings' | 'v0-alt' | 'legacy-parsed';
    logs?: string[];
  }): RpcTransaction => {
    const p = o.pool;
    const atas = traderAtas(o.trader, p);
    const baseVaultPre = vault.get(p.baseVault)!;
    const quoteVaultPre = vault.get(p.quoteVault)!;
    let staticKeys: string[];
    let loaded = { writable: [] as string[], readonly: [] as string[] };
    let programIndex: number;
    if (o.layout === 'v0-alt') {
      staticKeys = [o.trader, atas.base, atas.quote, PROGRAMS.computeBudget, PROGRAMS.token, p.programId];
      // vaults live in an address lookup table; note the swapped order (quote first)
      loaded = { writable: [p.id, p.quoteVault, p.baseVault], readonly: [derive('oracle', p.id)] };
      programIndex = 5;
    } else if (o.layout === 'legacy-parsed') {
      staticKeys = [o.trader, derive('config'), p.id, derive('score', o.trader), p.baseVault, p.quoteVault, atas.base, atas.quote, PROGRAMS.token, p.programId];
      programIndex = 9;
    } else {
      staticKeys = [o.trader, atas.base, atas.quote, p.id, p.baseVault, p.quoteVault, PROGRAMS.computeBudget, PROGRAMS.token, p.programId];
      programIndex = 8;
    }
    const allKeys = [...staticKeys, ...loaded.writable, ...loaded.readonly];
    const traderBasePre = toRaw(50 + rng.next() * 500, p.baseDecimals);
    const traderQuotePre = toRaw(1_000 + rng.next() * 50_000, p.quoteDecimals);
    const applied = !o.err;
    const changes: BalanceChange[] = [
      { account: atas.base, mint: p.baseMint, owner: o.trader, decimals: p.baseDecimals, pre: traderBasePre, post: traderBasePre - (applied ? o.baseDelta : 0n) },
      { account: atas.quote, mint: p.quoteMint, owner: o.trader, decimals: p.quoteDecimals, pre: traderQuotePre, post: traderQuotePre - (applied ? o.quoteDelta : 0n) },
      // NOTE: for the failed-tx edge case we deliberately keep the vault deltas so the parser's `err` check is exercised
      { account: p.baseVault, mint: p.baseMint, owner: p.id, decimals: p.baseDecimals, pre: baseVaultPre, post: baseVaultPre + o.baseDelta },
      { account: p.quoteVault, mint: p.quoteMint, owner: p.id, decimals: p.quoteDecimals, pre: quoteVaultPre, post: quoteVaultPre + o.quoteDelta },
    ];
    if (applied) {
      vault.set(p.baseVault, baseVaultPre + o.baseDelta);
      vault.set(p.quoteVault, quoteVaultPre + o.quoteDelta);
    }
    const tb = tokenBalances(allKeys, changes);
    const lamports = allKeys.map((_, i) => (i === 0 ? 2_000_000_000 + rng.int(1e9) : 2_039_280));
    const accountKeys: Array<string | ParsedAccountKey> =
      o.layout === 'legacy-parsed'
        ? staticKeys.map((k, i) => ({ pubkey: k, signer: i === 0, writable: i < 8 && i !== 1, source: 'transaction' as const }))
        : staticKeys;
    return {
      transaction: {
        signatures: [o.signature],
        message: {
          accountKeys,
          header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 3 },
          instructions: [
            { programIdIndex: programIndex, accounts: allKeys.map((_, i) => i).filter((i) => i !== programIndex), data: base58Encode(rng.bytes(17)) },
          ],
          recentBlockhash: blockhash(),
          ...(o.layout === 'v0-alt' ? { addressTableLookups: [{ accountKey: derive('alt', p.id), writableIndexes: [0, 1, 2], readonlyIndexes: [3] }] } : {}),
        },
      },
      meta: {
        err: o.err ?? null,
        fee: 5_000 + rng.int(20_000),
        preBalances: lamports,
        postBalances: lamports.map((l, i) => (i === 0 ? l - 5_000 : l)),
        preTokenBalances: tb.pre,
        postTokenBalances: tb.post,
        logMessages: o.logs ?? [`Program ${p.programId} invoke [1]`, `Program ${p.programId} consumed ${20_000 + rng.int(40_000)} of 200000 compute units`, `Program ${p.programId} success`],
        loadedAddresses: loaded,
        computeUnitsConsumed: 30_000 + rng.int(50_000),
      },
      version: o.layout === 'v0-alt' ? 0 : 'legacy',
    };
  };

  const layoutFor = (p: FixturePool) => (p.venue === 'orca' ? 'v0-alt' : p.venue === 'fairway' ? 'legacy-parsed' : 'legacy-strings') as 'v0-alt' | 'legacy-parsed' | 'legacy-strings';
  let dropEventOnce = true;

  window.forEach((s, idx) => {
    const p = poolById.get(s.pool)!;
    const b = toRaw(s.baseAmount, p.baseDecimals);
    const q = toRaw(s.quoteAmount, p.quoteDecimals);
    const baseDelta = s.side === 'buy' ? -b : b;
    const quoteDelta = s.side === 'buy' ? q : -q;
    let logs: string[] | undefined;
    if (p.venue === 'fairway') {
      const aToB = s.side === 'sell';
      const ev = encodeSwapExecuted({
        trader: s.trader,
        pool: p.id,
        aToB,
        amountIn: aToB ? b : q,
        amountOut: aToB ? q : b,
        feeBps: s.feeBps ?? 30,
        tier: TIER_INDEX[s.tier ?? 'STANDARD'],
      });
      const dropEvent = dropEventOnce && idx > 10;
      if (dropEvent) {
        dropEventOnce = false;
        edgeCases.push({ sig: s.sig, kind: 'fairway-no-event', note: 'Fairway swap whose logs were truncated: parser must fall back to vault deltas + configured fee' });
      }
      logs = [
        `Program ${p.programId} invoke [1]`,
        'Program log: Instruction: Swap',
        `Program ${PROGRAMS.token} invoke [2]`,
        `Program ${PROGRAMS.token} success`,
        ...(dropEvent ? ['Log truncated'] : [`Program data: ${ev}`]),
        `Program ${p.programId} consumed 41234 of 200000 compute units`,
        `Program ${p.programId} success`,
      ];
    }
    push(s.slot, s.ts, makeTx({ signature: s.sig, pool: p, trader: s.trader, baseDelta, quoteDelta, layout: layoutFor(p), logs }));

    // sprinkle edge cases right after some swaps (same slot)
    const r = idx % 50;
    if (r === 7) {
      const fs = sig();
      push(s.slot, s.ts, makeTx({ signature: fs, pool: p, trader: s.trader, baseDelta: -b, quoteDelta: q, layout: layoutFor(p), err: { InstructionError: [0, { Custom: 6001 }] } }));
      edgeCases.push({ sig: fs, kind: 'failed', note: 'failed tx (slippage) — must be ignored even though balances are present' });
    } else if (r === 19) {
      const ls = sig();
      const lp = market.pools[0]!;
      push(s.slot, s.ts, makeTx({ signature: ls, pool: lp, trader: derive('lp', String(idx)), baseDelta: toRaw(25, 9), quoteDelta: toRaw(25 * s.execPrice, 6), layout: 'legacy-strings' }));
      edgeCases.push({ sig: ls, kind: 'liquidity-add', note: 'both vaults increase — liquidity add, not a swap' });
    } else if (r === 29) {
      const ls = sig();
      const lp = market.pools[1]!;
      push(s.slot, s.ts, makeTx({ signature: ls, pool: lp, trader: derive('lp', String(idx)), baseDelta: -toRaw(10, 9), quoteDelta: -toRaw(10 * s.execPrice, 6), layout: 'v0-alt' }));
      edgeCases.push({ sig: ls, kind: 'liquidity-remove', note: 'both vaults decrease (via lookup table) — liquidity removal' });
    } else if (r === 37) {
      const us = sig();
      const a = derive('u', String(idx), 'a');
      const bAcc = derive('u', String(idx), 'b');
      const keys = [a, bAcc, derive('u', String(idx), 'c'), PROGRAMS.token];
      push(s.slot, s.ts, {
        transaction: { signatures: [us], message: { accountKeys: keys, instructions: [{ programIdIndex: 3, accounts: [1, 2, 0], data: '3Bxs4h24hBtQy9rw' }], recentBlockhash: blockhash() } },
        meta: {
          err: null,
          fee: 5_000,
          preBalances: [1e9, 2_039_280, 2_039_280, 1],
          postBalances: [1e9 - 5_000, 2_039_280, 2_039_280, 1],
          preTokenBalances: [
            { accountIndex: 1, mint: p.quoteMint, owner: a, uiTokenAmount: uiAmt(500_000_000n, 6) },
            { accountIndex: 2, mint: p.quoteMint, owner: derive('x'), uiTokenAmount: uiAmt(0n, 6) },
          ],
          postTokenBalances: [
            { accountIndex: 1, mint: p.quoteMint, owner: a, uiTokenAmount: uiAmt(400_000_000n, 6) },
            { accountIndex: 2, mint: p.quoteMint, owner: derive('x'), uiTokenAmount: uiAmt(100_000_000n, 6) },
          ],
          logMessages: [`Program ${PROGRAMS.token} invoke [1]`, 'Program log: Instruction: Transfer', `Program ${PROGRAMS.token} success`],
          loadedAddresses: { writable: [], readonly: [] },
        },
        version: 'legacy',
      });
      edgeCases.push({ sig: us, kind: 'unrelated-transfer', note: 'USDC transfer between unrelated accounts' });
    } else if (r === 43) {
      const vs = sig();
      const voter = derive('voter', String(idx));
      push(s.slot, s.ts, {
        transaction: { signatures: [vs], message: { accountKeys: [voter, derive('vote-acc', String(idx)), PROGRAMS.vote], instructions: [{ programIdIndex: 2, accounts: [1, 0], data: 'Vote' }], recentBlockhash: blockhash() } },
        meta: { err: null, fee: 5_000, preBalances: [1e9, 1e9, 1], postBalances: [1e9 - 5_000, 1e9, 1], preTokenBalances: [], postTokenBalances: [], logMessages: [], loadedAddresses: { writable: [], readonly: [] } },
        version: 'legacy',
      });
      edgeCases.push({ sig: vs, kind: 'vote', note: 'vote transaction without token balances' });
    }
  });

  const slots = [...bySlot.keys()].sort((a, b) => a - b);
  let prevHash = blockhash();
  const blocks: RpcBlock[] = slots.map((slot, i) => {
    const hash = blockhash();
    const blk: RpcBlock = {
      blockHeight: slot - 20_000_000,
      blockTime: blockTimeBySlot.get(slot)!,
      blockhash: hash,
      parentSlot: slot - 1,
      previousBlockhash: prevHash,
      transactions: bySlot.get(slot)!,
      rewards: [],
      // half of the blocks carry an explicit slot (Streams metadata), half rely on parentSlot + 1
      ...(i % 2 === 0 ? { slot } : {}),
    };
    prevHash = hash;
    return blk;
  });
  return { blocks, expected: window.map((s) => ({ ...s })), edgeCases };
}
