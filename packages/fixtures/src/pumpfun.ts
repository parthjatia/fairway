/**
 * Pump.fun-shaped fixture (M16): getBlock-shaped blocks for several token launches on a constant-product bonding curve,
 * with recurring sniper wallets (buy in the first slots, sell into the crowd), retail buyers, a one-off lucky early buyer,
 * PumpSwap trades after "graduation", and edge cases (failed tx, non-Pump tx, ALT-loaded curve accounts, create without a
 * dev buy). Deterministic (seeded). ADDITIVE: written to data/pumpfun.json; no other fixture is touched.
 * Synthetic data: addresses are random, the program ids are the (VERIFY) mainnet ids from packages/parser/src/pumpfun.ts.
 */
import { base58Encode } from './base58';
import { Rng } from './rng';

export const PUMP_FIXTURE_PROGRAMS = { pumpfun: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', pumpswap: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' };
const WSOL = 'So11111111111111111111111111111111111111112';
const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_DEC = 6;
const PUMP_FEE = 0.01;

export type PumpTradeExpected = { sig: string; slot: number; ts: number; mint: string; venue: 'pumpfun' | 'pumpswap'; trader: string; kind: 'create' | 'buy' | 'sell'; tokenAmount: number; solAmount: number; price: number };
export type PumpFixture = {
  synthetic: true;
  programs: typeof PUMP_FIXTURE_PROGRAMS;
  blocks: any[];
  expected: PumpTradeExpected[];
  meta: {
    snipers: string[];
    retail: string[];
    /** buys early in exactly one launch: must NOT be scored TOXIC */
    luckyEarly: string;
    launches: { mint: string; createSlot: number; creator: string }[];
    edgeCases: { kind: 'failed' | 'non-pump' | 'alt-loaded' | 'create-no-dev-buy' | 'pumpswap'; sig: string }[];
  };
};

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const raw = (ui: number, dec: number) => Math.round(ui * 10 ** dec);
const tokAmt = (rawAmt: number, dec: number) => ({ amount: String(rawAmt), decimals: dec, uiAmount: rawAmt / 10 ** dec, uiAmountString: String(rawAmt / 10 ** dec) });

export function generatePumpfunFixture(seed = 161): PumpFixture {
  const r = new Rng(seed);
  const addr = () => base58Encode(r.bytes(32));
  const sig = () => base58Encode(r.bytes(64));
  const snipers = Array.from({ length: 4 }, addr);
  const retail = Array.from({ length: 30 }, addr);
  const luckyEarly = addr();
  const feeRecipient = addr();
  const blocksBySlot = new Map<number, any[]>();
  const expected: PumpTradeExpected[] = [];
  const edgeCases: PumpFixture['meta']['edgeCases'] = [];
  const launches: PumpFixture['meta']['launches'] = [];
  const t0 = 1_763_000_000;
  const tsOf = (slot: number) => t0 + Math.floor((slot - 300_000_000) * 0.4);
  const push = (slot: number, tx: any) => {
    const l = blocksBySlot.get(slot) ?? [];
    l.push(tx);
    blocksBySlot.set(slot, l);
  };

  for (let L = 0; L < 8; L++) {
    const mint = addr();
    const curve = addr();
    const curveAta = addr();
    const creator = addr();
    const S = 300_000_000 + L * 5_000;
    let vSol = 30; // virtual SOL reserve
    let vTok = 1_073_000_000; // virtual token reserve
    let curveTokRaw = raw(1_000_000_000, TOKEN_DEC); // real tokens held by the curve
    let curveLamports = 2_000_000; // rent
    const holdings = new Map<string, number>(); // trader → raw tokens
    const traderAta = new Map<string, string>();
    const ataOf = (w: string) => traderAta.get(w) ?? (traderAta.set(w, addr()), traderAta.get(w)!);
    launches.push({ mint, createSlot: S, creator });

    // create (no dev buy in launch 3: edge case)
    const cs = sig();
    const createLogs = [`Program ${PUMP_FIXTURE_PROGRAMS.pumpfun} invoke [1]`, 'Program log: Instruction: Create', `Program ${PUMP_FIXTURE_PROGRAMS.pumpfun} success`];
    push(S, {
      transaction: { signatures: [cs], message: { accountKeys: [creator, mint, curve, curveAta, SYSTEM, TOKEN, PUMP_FIXTURE_PROGRAMS.pumpfun], instructions: [{ programIdIndex: 6, accounts: [0, 1, 2, 3], data: '' }], recentBlockhash: addr() } },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [5e9, 0, 0, 0, 1, 1, 1],
        postBalances: [5e9 - 2e7, 1461600, curveLamports, 2039280, 1, 1, 1],
        preTokenBalances: [],
        postTokenBalances: [{ accountIndex: 3, mint, owner: curve, uiTokenAmount: tokAmt(curveTokRaw, TOKEN_DEC) }],
        logMessages: createLogs,
      },
      version: 0,
    });
    expected.push({ sig: cs, slot: S, ts: tsOf(S), mint, venue: 'pumpfun', trader: creator, kind: 'create', tokenAmount: 0, solAmount: 0, price: 0 });
    if (L === 3) edgeCases.push({ kind: 'create-no-dev-buy', sig: cs });

    // one swap on the bonding curve
    const trade = (slot: number, w: string, side: 'buy' | 'sell', amount: number, opts: { failed?: boolean; alt?: boolean } = {}) => {
      const s = sig();
      const ata = ataOf(w);
      const had = holdings.get(w) ?? 0;
      let solCurve: number; // pre-fee SOL moved into/out of the curve
      let tokRaw: number;
      if (side === 'buy') {
        solCurve = amount;
        const out = vTok - (vSol * vTok) / (vSol + solCurve);
        tokRaw = Math.floor(out * 10 ** TOKEN_DEC);
      } else {
        tokRaw = had;
        const tokUi = tokRaw / 10 ** TOKEN_DEC;
        solCurve = vSol - (vSol * vTok) / (vTok + tokUi);
      }
      const lam = Math.round(solCurve * 1e9);
      const fee = Math.round(lam * PUMP_FEE);
      // static keys; with `alt` the curve + its token account come from an address lookup table
      const stat = opts.alt ? [w, mint, ata, feeRecipient, SYSTEM, TOKEN, PUMP_FIXTURE_PROGRAMS.pumpfun] : [w, mint, curve, curveAta, ata, feeRecipient, SYSTEM, TOKEN, PUMP_FIXTURE_PROGRAMS.pumpfun];
      const keys = opts.alt ? [...stat, curve, curveAta] : stat;
      const ix = (k: string) => keys.indexOf(k);
      const pre = keys.map(() => 1);
      const post = keys.map(() => 1);
      pre[ix(w)] = 50e9;
      post[ix(w)] = side === 'buy' ? 50e9 - lam - fee - 5000 : 50e9 + lam - fee - 5000;
      pre[ix(curve)] = curveLamports;
      post[ix(curve)] = side === 'buy' ? curveLamports + lam : curveLamports - lam;
      pre[ix(feeRecipient)] = 1e9;
      post[ix(feeRecipient)] = 1e9 + fee;
      const newCurveTok = side === 'buy' ? curveTokRaw - tokRaw : curveTokRaw + tokRaw;
      const newHold = side === 'buy' ? had + tokRaw : 0;
      const preTB = [{ accountIndex: ix(curveAta), mint, owner: curve, uiTokenAmount: tokAmt(curveTokRaw, TOKEN_DEC) }];
      if (had > 0) preTB.push({ accountIndex: ix(ata), mint, owner: w, uiTokenAmount: tokAmt(had, TOKEN_DEC) });
      const postTB = [
        { accountIndex: ix(curveAta), mint, owner: curve, uiTokenAmount: tokAmt(newCurveTok, TOKEN_DEC) },
        { accountIndex: ix(ata), mint, owner: w, uiTokenAmount: tokAmt(newHold, TOKEN_DEC) },
      ];
      const tx = {
        transaction: {
          signatures: [s],
          message: {
            accountKeys: stat,
            instructions: [{ programIdIndex: stat.indexOf(PUMP_FIXTURE_PROGRAMS.pumpfun), accounts: [], data: '' }],
            recentBlockhash: addr(),
            ...(opts.alt ? { addressTableLookups: [{ accountKey: addr(), writableIndexes: [0, 1], readonlyIndexes: [] }] } : {}),
          },
        },
        meta: {
          err: opts.failed ? { InstructionError: [0, { Custom: 6002 }] } : null,
          fee: 5000,
          preBalances: pre,
          postBalances: opts.failed ? pre : post,
          preTokenBalances: preTB,
          postTokenBalances: opts.failed ? preTB : postTB,
          logMessages: [`Program ${PUMP_FIXTURE_PROGRAMS.pumpfun} invoke [1]`, `Program log: Instruction: ${side === 'buy' ? 'Buy' : 'Sell'}`, `Program ${PUMP_FIXTURE_PROGRAMS.pumpfun} ${opts.failed ? 'failed' : 'success'}`],
          ...(opts.alt ? { loadedAddresses: { writable: [curve, curveAta], readonly: [] } } : {}),
        },
        version: 0,
      };
      push(slot, tx);
      if (opts.failed) {
        edgeCases.push({ kind: 'failed', sig: s });
        return;
      }
      if (opts.alt) edgeCases.push({ kind: 'alt-loaded', sig: s });
      if (side === 'buy') {
        vSol += solCurve;
        vTok -= tokRaw / 10 ** TOKEN_DEC;
      } else {
        vSol -= solCurve;
        vTok += tokRaw / 10 ** TOKEN_DEC;
      }
      curveTokRaw = newCurveTok;
      curveLamports = post[ix(curve)]!;
      holdings.set(w, newHold);
      const tokUi = tokRaw / 10 ** TOKEN_DEC;
      expected.push({ sig: s, slot, ts: tsOf(slot), mint, venue: 'pumpfun', trader: w, kind: side, tokenAmount: tokUi, solAmount: lam / 1e9, price: lam / 1e9 / tokUi });
    };

    // events of this launch, in slot order
    type Ev = { slot: number; run: () => void };
    const evs: Ev[] = [];
    snipers.forEach((w, i) => {
      if (L > 0 && r.bool(0.15)) return; // snipers skip a launch now and then (never the first)
      const at = S + r.int(3);
      const amt = round6(1 + 2 * r.next());
      const failFirst = L === 1 && i === 0;
      evs.push({ slot: at, run: () => (failFirst ? (trade(at, w, 'buy', amt, { failed: true }), trade(at + 1, w, 'buy', amt)) : trade(at, w, 'buy', amt, { alt: L === 2 && i === 1 })) });
      const exit = S + 120 + r.int(120);
      evs.push({ slot: exit, run: () => trade(exit, w, 'sell', 0) });
    });
    if (L === 4) evs.push({ slot: S + 3, run: () => trade(S + 3, luckyEarly, 'buy', 0.4) });
    const nRetail = 14 + r.int(8);
    for (let k = 0; k < nRetail; k++) {
      const w = r.pick(retail);
      const at = S + 10 + r.int(400);
      const amt = round6(0.05 + 0.9 * r.next() ** 2);
      evs.push({ slot: at, run: () => trade(at, w, 'buy', amt) });
    }
    evs.sort((a, b) => a.slot - b.slot);
    for (const e of evs) e.run();

    // launch 0 graduates: a few PumpSwap trades against a pool holding WSOL in a token account
    if (L === 0) {
      const pool = addr();
      const poolTok = addr();
      const poolWsol = addr();
      let pTok = 200_000_000;
      let pSol = 85;
      for (let k = 0; k < 3; k++) {
        const w = retail[k]!;
        const ata = addr();
        const wsolAta = addr();
        const slot = S + 3_000 + k * 10;
        const solIn = 0.5;
        const out = pTok - (pSol * pTok) / (pSol + solIn);
        const tokRaw = Math.floor(out * 10 ** TOKEN_DEC);
        const s = sig();
        const keys = [w, pool, poolTok, poolWsol, ata, wsolAta, mint, WSOL, TOKEN, PUMP_FIXTURE_PROGRAMS.pumpswap];
        const solRaw = raw(solIn, 9);
        push(slot, {
          transaction: { signatures: [s], message: { accountKeys: keys, instructions: [{ programIdIndex: 9, accounts: [], data: '' }], recentBlockhash: addr() } },
          meta: {
            err: null,
            fee: 5000,
            preBalances: keys.map(() => 2_039_280),
            postBalances: keys.map(() => 2_039_280),
            preTokenBalances: [
              { accountIndex: 2, mint, owner: pool, uiTokenAmount: tokAmt(raw(pTok, TOKEN_DEC), TOKEN_DEC) },
              { accountIndex: 3, mint: WSOL, owner: pool, uiTokenAmount: tokAmt(raw(pSol, 9), 9) },
              { accountIndex: 5, mint: WSOL, owner: w, uiTokenAmount: tokAmt(solRaw, 9) },
            ],
            postTokenBalances: [
              { accountIndex: 2, mint, owner: pool, uiTokenAmount: tokAmt(raw(pTok, TOKEN_DEC) - tokRaw, TOKEN_DEC) },
              { accountIndex: 3, mint: WSOL, owner: pool, uiTokenAmount: tokAmt(raw(pSol, 9) + solRaw, 9) },
              { accountIndex: 4, mint, owner: w, uiTokenAmount: tokAmt(tokRaw, TOKEN_DEC) },
              { accountIndex: 5, mint: WSOL, owner: w, uiTokenAmount: tokAmt(0, 9) },
            ],
            logMessages: [`Program ${PUMP_FIXTURE_PROGRAMS.pumpswap} invoke [1]`, 'Program log: Instruction: Buy', `Program ${PUMP_FIXTURE_PROGRAMS.pumpswap} success`],
          },
          version: 0,
        });
        pTok = (raw(pTok, TOKEN_DEC) - tokRaw) / 10 ** TOKEN_DEC;
        pSol += solIn;
        edgeCases.push({ kind: 'pumpswap', sig: s });
        expected.push({ sig: s, slot, ts: tsOf(slot), mint, venue: 'pumpswap', trader: w, kind: 'buy', tokenAmount: tokRaw / 10 ** TOKEN_DEC, solAmount: solIn, price: solIn / (tokRaw / 10 ** TOKEN_DEC) });
      }
    }
  }
  // a non-Pump transaction (plain token transfer) that must be ignored
  const np = sig();
  const a = addr();
  const b = addr();
  const m = addr();
  push(300_000_007, {
    transaction: { signatures: [np], message: { accountKeys: [a, b, TOKEN], instructions: [{ programIdIndex: 2, accounts: [0, 1], data: '' }], recentBlockhash: addr() } },
    meta: { err: null, fee: 5000, preBalances: [1e9, 1e9, 1], postBalances: [1e9 - 5000, 1e9, 1], preTokenBalances: [{ accountIndex: 0, mint: m, owner: a, uiTokenAmount: tokAmt(10, 0) }], postTokenBalances: [{ accountIndex: 0, mint: m, owner: a, uiTokenAmount: tokAmt(5, 0) }, { accountIndex: 1, mint: m, owner: b, uiTokenAmount: tokAmt(5, 0) }], logMessages: [] },
    version: 0,
  });
  edgeCases.push({ kind: 'non-pump', sig: np });

  const slots = [...blocksBySlot.keys()].sort((x, y) => x - y);
  const blocks = slots.map((slot) => ({ blockHeight: slot - 20_000_000, blockTime: tsOf(slot), blockhash: addr(), parentSlot: slot - 1, previousBlockhash: addr(), transactions: blocksBySlot.get(slot)! }));
  const order = new Map<string, number>();
  blocks.forEach((bl, i) => bl.transactions.forEach((t: any, j: number) => order.set(t.transaction.signatures[0], i * 1_000 + j)));
  expected.sort((x, y) => order.get(x.sig)! - order.get(y.sig)! || (x.kind === 'create' ? -1 : 1));
  return { synthetic: true, programs: PUMP_FIXTURE_PROGRAMS, blocks, expected, meta: { snipers, retail, luckyEarly, launches, edgeCases } };
}
