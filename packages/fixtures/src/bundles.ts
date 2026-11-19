/**
 * Bundle fixture (M16 step 11): getBlock-shaped blocks with Pump.fun-style launches AND System Program fundings of
 * brand-new wallets, for the funding parser (packages/parser/src/funding.ts), the Stream L filter and bundle detection
 * (packages/scoring/src/bundle.ts). Deterministic (own seed 211). ADDITIVE: written to data/bundles.json; no other
 * fixture is touched. Synthetic data: addresses are random; program ids are the verified mainnet ids.
 *
 * Story: funder F bundles launch 0 (4 fresh wallets) and launch 1 (3), so it becomes a KNOWN bundler; it then funds 2 new
 * wallets before launch 2, which are flagged pre-emptively, and bundles launch 2 (3 wallets). Edge cases that must NOT
 * produce a bundle or a funding record are listed in `meta.edgeCases`.
 */
import { base58Encode } from './base58';
import { PUMP_FIXTURE_PROGRAMS } from './pumpfun';
import { Rng } from './rng';

const SYSTEM = '11111111111111111111111111111111';
const COMPUTE = 'ComputeBudget111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_DEC = 6;

export type FundingExpected = { sig: string; slot: number; ts: number; funder: string; wallet: string; sol: number };
export type BundleEdge =
  | 'funded-too-early'
  | 'funded-after-buy'
  | 'single-wallet'
  | 'existing-wallet'
  | 'other-program'
  | 'failed'
  | 'dust'
  | 'different-launches'
  | 'alt-recipient'
  | 'compute-budget';
export type BundleFixture = {
  synthetic: true;
  programs: typeof PUMP_FIXTURE_PROGRAMS;
  blocks: any[];
  expectedFundings: FundingExpected[];
  meta: {
    launches: { mint: string; createSlot: number }[];
    bundler: string;
    bundles: { mint: string; funder: string; wallets: string[] }[];
    /** wallets funded by the bundler after it became known, before they bought anything */
    preemptive: string[];
    /** early buyers that must NOT be flagged */
    notFlagged: string[];
    edgeCases: { kind: BundleEdge; sig: string }[];
  };
};

const tokAmt = (rawAmt: number, dec: number) => ({ amount: String(rawAmt), decimals: dec, uiAmount: rawAmt / 10 ** dec, uiAmountString: String(rawAmt / 10 ** dec) });

export function generateBundleFixture(seed = 211): BundleFixture {
  const r = new Rng(seed);
  const addr = () => base58Encode(r.bytes(32));
  const sig = () => base58Encode(r.bytes(64));
  const blocksBySlot = new Map<number, any[]>();
  const expectedFundings: FundingExpected[] = [];
  const edgeCases: BundleFixture['meta']['edgeCases'] = [];
  const t0 = 1_764_000_000;
  const BASE = 310_000_000;
  const tsOf = (slot: number) => t0 + Math.floor((slot - BASE) * 0.4);
  const push = (slot: number, tx: any) => {
    const l = blocksBySlot.get(slot) ?? [];
    l.push(tx);
    blocksBySlot.set(slot, l);
  };

  /** System transfer(s) from `funder` to each recipient; `opts` builds the edge cases. */
  const fund = (
    slot: number,
    funder: string,
    to: { wallet: string; sol: number; pre?: number }[],
    opts: { failed?: boolean; extraProgram?: string; alt?: boolean; compute?: boolean; edge?: BundleEdge; expect?: boolean } = {},
  ) => {
    const s = sig();
    const stat = opts.alt ? [funder, SYSTEM] : [funder, ...to.map((t) => t.wallet), SYSTEM];
    const programs = [SYSTEM, ...(opts.extraProgram ? [opts.extraProgram] : []), ...(opts.compute ? [COMPUTE] : [])];
    for (const p of programs) if (!stat.includes(p)) stat.push(p);
    const keys = opts.alt ? [...stat, ...to.map((t) => t.wallet)] : stat;
    const idx = (k: string) => keys.indexOf(k);
    const total = to.reduce((a, t) => a + Math.round(t.sol * 1e9), 0);
    const pre = keys.map(() => 1);
    const post = keys.map(() => 1);
    pre[0] = 500e9;
    post[0] = 500e9 - total - 5000;
    for (const t of to) {
      pre[idx(t.wallet)] = t.pre ?? 0;
      post[idx(t.wallet)] = (t.pre ?? 0) + Math.round(t.sol * 1e9);
    }
    const ixs = [
      ...(opts.compute ? [{ programIdIndex: idx(COMPUTE), accounts: [], data: '' }] : []),
      ...to.map((t) => ({ programIdIndex: idx(SYSTEM), accounts: [0, idx(t.wallet)], data: '' })),
      ...(opts.extraProgram ? [{ programIdIndex: idx(opts.extraProgram), accounts: [0], data: '' }] : []),
    ];
    push(slot, {
      transaction: {
        signatures: [s],
        message: { accountKeys: stat, instructions: ixs, recentBlockhash: addr(), ...(opts.alt ? { addressTableLookups: [{ accountKey: addr(), writableIndexes: to.map((_, i) => i), readonlyIndexes: [] }] } : {}) },
      },
      meta: {
        err: opts.failed ? { InstructionError: [0, { Custom: 1 }] } : null,
        fee: 5000,
        preBalances: pre,
        postBalances: opts.failed ? pre.map((x, i) => (i === 0 ? x - 5000 : x)) : post,
        preTokenBalances: [],
        postTokenBalances: [],
        logMessages: [`Program ${SYSTEM} invoke [1]`, `Program ${SYSTEM} success`],
        ...(opts.alt ? { loadedAddresses: { writable: to.map((t) => t.wallet), readonly: [] } } : {}),
      },
      version: 0,
    });
    if (opts.edge) edgeCases.push({ kind: opts.edge, sig: s });
    if (opts.expect ?? !(opts.failed || opts.extraProgram)) {
      for (const t of to) if ((t.pre ?? 0) === 0 && t.sol >= 0.05) expectedFundings.push({ sig: s, slot, ts: tsOf(slot), funder, wallet: t.wallet, sol: Math.round(t.sol * 1e9) / 1e9 });
    }
  };

  const launches: BundleFixture['meta']['launches'] = [];
  const curves = new Map<string, { curve: string; curveAta: string; vSol: number; vTok: number; curveTok: number; curveLam: number }>();
  const launch = (S: number) => {
    const mint = addr();
    const curve = addr();
    const curveAta = addr();
    const creator = addr();
    const curveTok = 1_000_000_000 * 10 ** TOKEN_DEC;
    curves.set(mint, { curve, curveAta, vSol: 30, vTok: 1_073_000_000, curveTok, curveLam: 2_000_000 });
    push(S, {
      transaction: { signatures: [sig()], message: { accountKeys: [creator, mint, curve, curveAta, SYSTEM, TOKEN, PUMP_FIXTURE_PROGRAMS.pumpfun], instructions: [{ programIdIndex: 6, accounts: [0, 1, 2, 3], data: '' }], recentBlockhash: addr() } },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [5e9, 0, 0, 0, 1, 1, 1],
        postBalances: [5e9 - 2e7, 1461600, 2_000_000, 2039280, 1, 1, 1],
        preTokenBalances: [],
        postTokenBalances: [{ accountIndex: 3, mint, owner: curve, uiTokenAmount: tokAmt(curveTok, TOKEN_DEC) }],
        logMessages: [`Program ${PUMP_FIXTURE_PROGRAMS.pumpfun} invoke [1]`, 'Program log: Instruction: Create', `Program ${PUMP_FIXTURE_PROGRAMS.pumpfun} success`],
      },
      version: 0,
    });
    launches.push({ mint, createSlot: S });
    return mint;
  };
  /** a Pump.fun buy of `sol` by a wallet with no prior token balance */
  const buy = (slot: number, mint: string, w: string, sol: number) => {
    const c = curves.get(mint)!;
    const ata = addr();
    const fr = addr();
    const out = c.vTok - (c.vSol * c.vTok) / (c.vSol + sol);
    const tokRaw = Math.floor(out * 10 ** TOKEN_DEC);
    const lam = Math.round(sol * 1e9);
    const keys = [w, mint, c.curve, c.curveAta, ata, fr, SYSTEM, TOKEN, PUMP_FIXTURE_PROGRAMS.pumpfun];
    const pre = keys.map(() => 1);
    const post = keys.map(() => 1);
    pre[0] = 2e9;
    post[0] = 2e9 - lam - Math.round(lam * 0.01) - 5000;
    pre[2] = c.curveLam;
    post[2] = c.curveLam + lam;
    pre[5] = 1e9;
    post[5] = 1e9 + Math.round(lam * 0.01);
    push(slot, {
      transaction: { signatures: [sig()], message: { accountKeys: keys, instructions: [{ programIdIndex: 8, accounts: [], data: '' }], recentBlockhash: addr() } },
      meta: {
        err: null,
        fee: 5000,
        preBalances: pre,
        postBalances: post,
        preTokenBalances: [{ accountIndex: 3, mint, owner: c.curve, uiTokenAmount: tokAmt(c.curveTok, TOKEN_DEC) }],
        postTokenBalances: [
          { accountIndex: 3, mint, owner: c.curve, uiTokenAmount: tokAmt(c.curveTok - tokRaw, TOKEN_DEC) },
          { accountIndex: 4, mint, owner: w, uiTokenAmount: tokAmt(tokRaw, TOKEN_DEC) },
        ],
        logMessages: [`Program ${PUMP_FIXTURE_PROGRAMS.pumpfun} invoke [1]`, 'Program log: Instruction: Buy', `Program ${PUMP_FIXTURE_PROGRAMS.pumpfun} success`],
      },
      version: 0,
    });
    c.vSol += sol;
    c.vTok -= tokRaw / 10 ** TOKEN_DEC;
    c.curveTok -= tokRaw;
    c.curveLam += lam;
  };

  const F = addr(); // the bundler's funding wallet
  const bundles: BundleFixture['meta']['bundles'] = [];
  const notFlagged: string[] = [];
  const S = [BASE + 10_000, BASE + 20_000, BASE + 30_000, BASE + 40_000];
  const bundle = (L: number, n: number, fundAt: number) => {
    const ws = Array.from({ length: n }, addr);
    // half the wallets in one multi-transfer tx (one with a compute-budget ix), the rest one per tx
    const half = Math.ceil(n / 2);
    fund(fundAt, F, ws.slice(0, half).map((w) => ({ wallet: w, sol: 1 + r.int(3) })), { compute: L === 1, edge: L === 1 ? 'compute-budget' : undefined });
    ws.slice(half).forEach((w, i) => fund(fundAt + 1 + i, F, [{ wallet: w, sol: 1.5 }], { alt: L === 2 && i === 0, edge: L === 2 && i === 0 ? 'alt-recipient' : undefined }));
    return ws;
  };
  // launch 0 and 1: F bundles (→ known bundler after launch 1)
  const m0 = launch(S[0]!);
  const b0 = bundle(0, 4, S[0]! - 300);
  b0.forEach((w, i) => buy(S[0]! + 1 + (i % 2), m0, w, 1));
  bundles.push({ mint: m0, funder: F, wallets: [...b0].sort() });
  const m1 = launch(S[1]!);
  const b1 = bundle(1, 3, S[1]! - 120);
  b1.forEach((w) => buy(S[1]! + 2, m1, w, 0.8));
  bundles.push({ mint: m1, funder: F, wallets: [...b1].sort() });
  // after launch 1: F funds 2 fresh wallets that have not bought anything yet → pre-emptive flags
  const preemptive = [addr(), addr()];
  fund(S[1]! + 2_000, F, preemptive.map((w) => ({ wallet: w, sol: 2 })));
  // launch 2: F bundles again
  const m2 = launch(S[2]!);
  const b2 = bundle(2, 3, S[2]! - 60);
  b2.forEach((w) => buy(S[2]! + 1, m2, w, 1.2));
  bundles.push({ mint: m2, funder: F, wallets: [...b2].sort() });

  // ---- edge cases on launch 3
  const m3 = launch(S[3]!);
  // (a) two wallets funded by G, but 2,000 slots before the launch (outside the 1,500 lookback)
  const G = addr();
  const early = [addr(), addr()];
  fund(S[3]! - 2_000, G, early.map((w) => ({ wallet: w, sol: 1 })), { edge: 'funded-too-early' });
  early.forEach((w) => buy(S[3]! + 1, m3, w, 0.5));
  notFlagged.push(...early);
  // (b) two wallets funded by H after their buy (they had SOL from elsewhere): not a bundle
  const H = addr();
  const late = [addr(), addr()];
  late.forEach((w) => buy(S[3]! + 1, m3, w, 0.5));
  fund(S[3]! + 6, H, late.map((w) => ({ wallet: w, sol: 1 })), { edge: 'funded-after-buy' });
  notFlagged.push(...late);
  // (c) one wallet funded by J: a single wallet is not a bundle
  const J = addr();
  const solo = addr();
  fund(S[3]! - 40, J, [{ wallet: solo, sol: 3 }], { edge: 'single-wallet' });
  buy(S[3]! + 1, m3, solo, 1);
  notFlagged.push(solo);
  // (d) K tops up two EXISTING wallets (balance > 0 before): not a funding of a new wallet
  const K = addr();
  const existing = [addr(), addr()];
  fund(S[3]! - 30, K, existing.map((w) => ({ wallet: w, sol: 1, pre: 50_000_000 })), { edge: 'existing-wallet' });
  existing.forEach((w) => buy(S[3]! + 2, m3, w, 0.5));
  notFlagged.push(...existing);
  // (e) a funding that also invokes another program (token program): not a plain funding
  const M = addr();
  const mixed = [addr(), addr()];
  fund(S[3]! - 20, M, mixed.map((w) => ({ wallet: w, sol: 1 })), { extraProgram: TOKEN, edge: 'other-program' });
  mixed.forEach((w) => buy(S[3]! + 3, m3, w, 0.5));
  notFlagged.push(...mixed);
  // (f) a failed funding tx
  const N = addr();
  const failedTo = [addr(), addr()];
  fund(S[3]! - 15, N, failedTo.map((w) => ({ wallet: w, sol: 1 })), { failed: true, edge: 'failed' });
  // (g) dust: 0.01 SOL each is below the 0.05 SOL minimum
  const P = addr();
  const dust = [addr(), addr()];
  fund(S[3]! - 10, P, dust.map((w) => ({ wallet: w, sol: 0.01 })), { edge: 'dust', expect: false });
  dust.forEach((w) => buy(S[3]! + 3, m3, w, 0.2));
  notFlagged.push(...dust);
  // (h) an "exchange" Q funds two new wallets that buy DIFFERENT launches: no bundle
  const Q = addr();
  const ex = [addr(), addr()];
  fund(S[2]! - 30, Q, [{ wallet: ex[0]!, sol: 1 }], { edge: 'different-launches' });
  buy(S[2]! + 2, m2, ex[0]!, 0.3);
  fund(S[3]! - 30, Q, [{ wallet: ex[1]!, sol: 1 }]);
  buy(S[3]! + 2, m3, ex[1]!, 0.3);
  notFlagged.push(...ex);

  const slots = [...blocksBySlot.keys()].sort((x, y) => x - y);
  const blocks = slots.map((slot) => ({ blockHeight: slot - 20_000_000, blockTime: tsOf(slot), blockhash: addr(), parentSlot: slot - 1, previousBlockhash: addr(), transactions: blocksBySlot.get(slot)! }));
  const order = new Map<string, number>();
  blocks.forEach((bl, i) => bl.transactions.forEach((t: any, j: number) => order.set(t.transaction.signatures[0], i * 1_000 + j)));
  expectedFundings.sort((x, y) => order.get(x.sig)! - order.get(y.sig)!);
  return { synthetic: true, programs: PUMP_FIXTURE_PROGRAMS, blocks, expectedFundings, meta: { launches, bundler: F, bundles, preemptive, notFlagged, edgeCases } };
}
