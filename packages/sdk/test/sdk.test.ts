import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { encodeSwapExecuted } from '@fairway/fixtures';
import {
  addLiquidityIx,
  closeScoreIx,
  configPda,
  createPoolIx,
  decodeConfig,
  decodePool,
  decodeTraderScore,
  deposit,
  discriminator,
  errorFromCode,
  FAIRWAY_ERRORS,
  feeOnInput,
  initialLp,
  initializeConfigIx,
  isqrt,
  parseFairwayError,
  parseSwapEvents,
  poolAddresses,
  PROGRAM_ID,
  removeLiquidityIx,
  resolveTier,
  scorePda,
  setScoreIx,
  setScoresBatchIx,
  settleMarkoutIx,
  defaultMarkoutParams,
  writeMarkoutParams,
  resolveBlendedTier,
  swapIx,
  swapQuote,
  updateConfigIx,
  withdraw,
  Writer,
} from '../src';

const idl = JSON.parse(readFileSync(join(__dirname, '..', 'idl', 'fairway.json'), 'utf8'));
const k = () => Keypair.generate().publicKey;

describe('IDL parity', () => {
  it('program id matches the IDL', () => {
    expect(PROGRAM_ID.toBase58()).toBe(idl.address);
  });
  it('instruction discriminators and account counts match the IDL', () => {
    const base = k();
    const quote = k();
    const t = k();
    const built: Record<string, ReturnType<typeof swapIx>> = {
      initialize_config: initializeConfigIx({ admin: t, scoreAuthority: t, feeBps: [5, 30, 80], scoreTtlSlots: 1000 }),
      update_config: updateConfigIx({ admin: t, update: {} }),
      create_pool: createPoolIx({ payer: t, baseMint: base, quoteMint: quote }),
      add_liquidity: addLiquidityIx({ owner: t, baseMint: base, quoteMint: quote, maxBase: 1n, maxQuote: 1n, minLp: 0n }),
      remove_liquidity: removeLiquidityIx({ owner: t, baseMint: base, quoteMint: quote, lpAmount: 1n, minBase: 0n, minQuote: 0n }),
      swap: swapIx({ trader: t, baseMint: base, quoteMint: quote, amountIn: 1n, minAmountOut: 0n, aToB: true }),
      set_score: setScoreIx({ authority: t, entry: { trader: t, tier: 0, scoreBps: 0, trades: 0 } }),
      set_scores_batch: setScoresBatchIx({ authority: t, entries: [{ trader: t, tier: 0, scoreBps: 0, trades: 0 }] }),
      close_score: closeScoreIx({ closer: t, trader: t }),
      settle_markout: settleMarkoutIx({ cranker: t, trader: t, pythPriceAccount: k() }),
    };
    for (const i of idl.instructions) {
      const ix = built[i.name]!;
      expect(ix, i.name).toBeDefined();
      expect(Array.from(ix.data.subarray(0, 8)), i.name).toEqual(i.discriminator);
      const extra = i.name === 'set_scores_batch' ? 1 : 0; // one remaining account
      expect(ix.keys.length, i.name).toBe(i.accounts.length + extra);
      i.accounts.forEach((a: { name: string; signer?: boolean; writable?: boolean }, j: number) => {
        expect(ix.keys[j]!.isSigner, `${i.name}.${a.name} signer`).toBe(!!a.signer);
        expect(ix.keys[j]!.isWritable, `${i.name}.${a.name} writable`).toBe(!!a.writable);
      });
    }
  });
  it('account + event discriminators match the IDL', () => {
    for (const a of idl.accounts) expect(Array.from(discriminator('account', a.name))).toEqual(a.discriminator);
    for (const e of idl.events) expect(Array.from(discriminator('event', e.name))).toEqual(e.discriminator);
  });
  it('error codes match the IDL', () => {
    expect(idl.errors.map((e: { code: number; name: string }) => [e.code, e.name])).toEqual(FAIRWAY_ERRORS.map(([n], i) => [6000 + i, n]));
  });
});

describe('PDAs', () => {
  it('derive deterministically and differ per trader', () => {
    const a = k();
    expect(scorePda(a)[0].equals(scorePda(a)[0])).toBe(true);
    expect(scorePda(a)[0].equals(scorePda(k())[0])).toBe(false);
    const [cfg] = configPda();
    expect(PublicKey.isOnCurve(cfg.toBytes())).toBe(false);
    const p = poolAddresses(k(), k());
    expect(new Set([p.pool, p.baseVault, p.quoteVault, p.lpMint].map((x) => x.toBase58())).size).toBe(4);
  });
  it('swap uses the signer-derived score PDA', () => {
    const t = k();
    const ix = swapIx({ trader: t, baseMint: k(), quoteMint: k(), amountIn: 5n, minAmountOut: 1n, aToB: false });
    expect(ix.keys[3]!.pubkey.equals(scorePda(t)[0])).toBe(true);
    expect(Array.from(ix.data.subarray(8))).toEqual([5, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('account decoders', () => {
  it('decode Config / Pool / TraderScore', () => {
    const admin = k();
    const auth = k();
    const oracle = k();
    const cw = new Writer().bytes(discriminator('account', 'Config')).pubkey(admin).pubkey(auth).u16(5).u16(30).u16(80).u8(1).u64(1000n).u8(254);
    writeMarkoutParams(cw, defaultMarkoutParams({ pythPriceAccount: oracle, pythMaxConfBps: 77 }));
    const cfg = cw.toBytes();
    expect(decodeConfig(cfg)).toMatchObject({ feeBps: [5, 30, 80], defaultTier: 1, scoreTtlSlots: 1000n, bump: 254 });
    expect(decodeConfig(cfg).markout).toMatchObject({ markoutSlots: 75n, priorNotional: 2_000_000_000n, toxicBps: 10, pythMaxConfBps: 77 });
    expect(decodeConfig(cfg).markout.pythPriceAccount.equals(oracle)).toBe(true);
    expect(decodeConfig(cfg).admin.equals(admin)).toBe(true);
    const keys = [k(), k(), k(), k(), k()];
    const w = new Writer().bytes(discriminator('account', 'Pool'));
    keys.forEach((x) => w.pubkey(x));
    w.u64(777n);
    for (let i = 0; i < 9; i++) w.u64(BigInt(i));
    w.u8(1).u8(2).u8(3).u8(4);
    const pool = decodePool(w.toBytes());
    expect(pool.lpSupply).toBe(777n);
    expect(pool.feesQuote).toEqual([3n, 4n, 5n]);
    expect(pool.swaps).toEqual([6n, 7n, 8n]);
    expect(pool.lpMintBump).toBe(4);
    const tr = k();
    const sw = new Writer().bytes(discriminator('account', 'TraderScore')).pubkey(tr).u8(2).i32(-12).u32(40).u64(99n).u8(250);
    sw.u64(5_000n).i128(-123_456_789_012_345_678_901n).u32(6).u64(10n).u8(0).i32(-3).u32(1);
    sw.u64(150_000_000n).u64(500n).u8(1).u64(42n); // one pending sell
    for (let i = 0; i < 3; i++) sw.u64(0n).u64(0n).u8(0).u64(0n);
    const sc = sw.toBytes();
    expect(decodeTraderScore(sc)).toMatchObject({ tier: 2, tierName: 'TOXIC', scoreBps: -12, trades: 40, updatedSlot: 99n });
    expect(decodeTraderScore(sc)).toMatchObject({
      sumNotional: 5_000n,
      sumWeightedMarkout: -123_456_789_012_345_678_901n,
      tradeCount: 6,
      onchainTierName: 'RETAIL',
      onchainScoreBps: -3,
      droppedTrades: 1,
      pending: [{ execPrice: 150_000_000n, slot: 500n, side: 'sell', notional: 42n }],
    });
    // account size matches the program's InitSpace (8 + 185 + 4 × 25)
    expect(sc.length).toBe(8 + 32 + 1 + 4 + 4 + 8 + 1 + 8 + 16 + 4 + 8 + 1 + 4 + 4 + 4 * 25);
    expect(() => decodeTraderScore(cfg)).toThrow(/TraderScore/);
  });
});

describe('onchain/bootstrap blend', () => {
  it('keeper score until onchain notional reaches the threshold, then onchain wins', () => {
    const boot = { tier: 0, updatedSlot: 90n };
    const r = (sumNotional: bigint, pendingFull = false, trades = 5) =>
      resolveBlendedTier({ onchain: { tier: 2, sumNotional, trades }, onchainMinNotional: 100n, minTrades: 5, bootstrap: boot, pendingFull }, 100n, 50n, 1);
    expect(r(99n)).toEqual({ tier: 0, source: 'score' });
    expect(r(100n)).toEqual({ tier: 2, source: 'onchain' });
    expect(r(100n, false, 4)).toEqual({ tier: 0, source: 'score' }); // too few trades
    expect(r(99n, true).tier).toBe(1); // full buffer: no RETAIL discount
  });
});

describe('events', () => {
  it('decodes SwapExecuted from logs (same bytes as the fixtures encoder)', () => {
    const trader = k();
    const pool = k();
    const b64 = encodeSwapExecuted({ trader: trader.toBase58(), pool: pool.toBase58(), aToB: true, amountIn: 123n, amountOut: 456n, feeBps: 80, tier: 2 });
    const ev = parseSwapEvents(['Program log: Instruction: Swap', `Program data: ${b64}`, 'Program data: AAAA'])!;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ aToB: true, amountIn: 123n, amountOut: 456n, feeBps: 80, tier: 2, tierName: 'TOXIC' });
    expect(ev[0]!.trader.equals(trader)).toBe(true);
  });
});

describe('math parity with crates/fairway-math', () => {
  it('known vectors', () => {
    expect(feeOnInput(10_000n, 30)).toBe(30n);
    expect(feeOnInput(1n, 30)).toBe(1n);
    expect(feeOnInput(3_334n, 30)).toBe(11n);
    expect(swapQuote(10_000n, 1_000_000n, 1_000_000n, 30)).toEqual({ amountOut: 9_871n, fee: 30n, inAfterFee: 9_970n });
    expect(() => swapQuote(1n, 1_000_000n, 1_000n, 30)).toThrow('InsufficientOutput');
    expect(initialLp(1_001n * 1_001n, 1n)).toEqual({ lp: 1n, total: 1_001n });
    expect(() => initialLp(1_000n, 1_000n)).toThrow('InsufficientLiquidity');
    expect(deposit(1_000n, 5_000n, 10_000n, 20_000n, 14_142n)).toEqual({ lp: 1_414n, usedA: 1_000n, usedB: 2_000n });
    expect(withdraw(2_500n, 10_000n, 40_000n, 10_000n)).toEqual([2_500n, 10_000n]);
    const big = (1n << 64n) - 1n;
    expect(isqrt(big * big)).toBe(big);
  });
  it('tier resolution mirrors the program', () => {
    expect(resolveTier(null, 100n, 50n, 1)).toEqual({ tier: 1, source: 'missing' });
    expect(resolveTier({ tier: 0, updatedSlot: 50n }, 100n, 50n, 1)).toEqual({ tier: 0, source: 'score' });
    expect(resolveTier({ tier: 0, updatedSlot: 49n }, 100n, 50n, 1)).toEqual({ tier: 1, source: 'stale' });
    expect(resolveTier({ tier: 5, updatedSlot: 99n }, 100n, 50n, 1).source).toBe('invalid');
    expect(resolveTier(null, 100n, 50n, 0).tier).toBe(1);
  });
});

describe('errors', () => {
  it('maps custom codes from logs, messages and InstructionError', () => {
    expect(errorFromCode(6005)!.errorName).toBe('SlippageExceeded');
    expect(errorFromCode(2006)!.errorName).toBe('ConstraintSeeds');
    expect(errorFromCode(1)).toBeNull();
    expect(parseFairwayError(null, ['Program log: AnchorError ... Error Code: SlippageExceeded. Error Number: 6005. Error Message: x'])!.code).toBe(6005);
    expect(parseFairwayError({ message: 'Transaction simulation failed: custom program error: 0x1771' })!.errorName).toBe('NotScoreAuthority');
    expect(parseFairwayError({ InstructionError: [0, { Custom: 6013 }] })!.errorName).toBe('ScoreAccountMismatch');
    expect(() => setScoresBatchIx({ authority: k(), entries: [] })).toThrow();
  });
});
