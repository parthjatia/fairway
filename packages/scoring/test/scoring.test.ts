import { describe, expect, it } from 'vitest';
import {
  assignTier,
  DEFAULT_SCORING_CONFIG,
  explainTier,
  FixtureMidPrice,
  makeConfig,
  markoutBps,
  PoolImpliedMidPrice,
  PythMidPrice,
  scoreWallet,
  scoreWallets,
  SeriesMidPrice,
  shrunkScore,
  toOnchainScore,
  type Swap,
} from '../src';

const cfg = DEFAULT_SCORING_CONFIG;
let n = 0;
const swap = (p: Partial<Swap>): Swap => ({
  sig: `sig${n++}`,
  slot: 1,
  ts: 1_000,
  pool: 'P',
  venue: 'fixture',
  trader: 'W',
  side: 'buy',
  baseAmount: 1,
  quoteAmount: 100,
  execPrice: 100,
  ...p,
});
const flat = (px: number) => new FixtureMidPrice([[0, px], [1e9, px]], Infinity);

describe('markout sign conventions', () => {
  it('buy then price up is positive', () => {
    expect(markoutBps('buy', 100, 101)).toBeCloseTo(100);
  });
  it('buy then price down is negative', () => {
    expect(markoutBps('buy', 100, 99)).toBeCloseTo(-100);
  });
  it('sell then price down is positive', () => {
    expect(markoutBps('sell', 100, 99)).toBeCloseTo(100);
  });
  it('sell then price up is negative', () => {
    expect(markoutBps('sell', 100, 101)).toBeCloseTo(-100);
  });
  it('no move is zero, invalid price is NaN', () => {
    expect(markoutBps('buy', 150, 150)).toBe(0);
    expect(markoutBps('buy', 0, 150)).toBeNaN();
  });
});

describe('shrinkage', () => {
  it('pulls small samples toward zero', () => {
    // one $100 trade at +50 bps → 50*100/(100+2000)
    expect(shrunkScore(50 * 100, 100, 2000)).toBeCloseTo(2.381, 3);
  });
  it('converges to the raw mean with lots of notional', () => {
    expect(shrunkScore(50 * 1e7, 1e7, 2000)).toBeCloseTo(49.99, 1);
  });
  it('zero prior + zero notional is 0, not NaN', () => {
    expect(shrunkScore(0, 0, 0)).toBe(0);
  });
  it('scoreWallet applies K from config', () => {
    const swaps = [swap({ ts: 0, execPrice: 100, quoteAmount: 2000 })];
    const mids = new FixtureMidPrice([[0, 100], [30, 101], [100, 101]], Infinity);
    const k0 = scoreWallet('W', swaps, mids, makeConfig({ priorNotional: 0 }));
    const k2 = scoreWallet('W', swaps, mids, cfg);
    expect(k0.scoreBps).toBeCloseTo(100);
    expect(k2.scoreBps).toBeCloseTo(50);
    expect(k2.byHorizon[30]!.rawBps).toBeCloseTo(100);
  });
});

describe('tier boundaries', () => {
  const base = { trades: 5, historyDays: 3 };
  it('TOXIC exactly at threshold', () => {
    expect(assignTier({ ...base, scoreBps: 10 }, cfg)).toBe('TOXIC');
    expect(assignTier({ ...base, scoreBps: 9.999 }, cfg)).toBe('STANDARD');
  });
  it('TOXIC needs min trades', () => {
    expect(assignTier({ ...base, trades: 4, scoreBps: 50 }, cfg)).toBe('STANDARD');
  });
  it('RETAIL exactly at threshold', () => {
    expect(assignTier({ ...base, scoreBps: 3 }, cfg)).toBe('RETAIL');
    expect(assignTier({ ...base, scoreBps: 3.001 }, cfg)).toBe('STANDARD');
    expect(assignTier({ ...base, scoreBps: -40 }, cfg)).toBe('RETAIL');
  });
  it('RETAIL needs trades and history', () => {
    expect(assignTier({ trades: 4, historyDays: 10, scoreBps: 0 }, cfg)).toBe('STANDARD');
    expect(assignTier({ trades: 50, historyDays: 2.99, scoreBps: 0 }, cfg)).toBe('STANDARD');
  });
  it('unknown wallets are STANDARD', () => {
    expect(assignTier(undefined, cfg)).toBe('STANDARD');
    expect(assignTier(null, cfg)).toBe('STANDARD');
    expect(assignTier({ trades: 10, historyDays: 10, scoreBps: NaN }, cfg)).toBe('STANDARD');
  });
  it('explainTier gives a reason for every tier', () => {
    expect(explainTier(undefined, cfg)).toMatch(/STANDARD/);
    expect(explainTier({ ...base, scoreBps: 20 }, cfg)).toMatch(/informed/);
    expect(explainTier({ ...base, scoreBps: 0 }, cfg)).toMatch(/uninformed/);
    expect(explainTier({ trades: 1, historyDays: 0, scoreBps: 0 }, cfg)).toMatch(/more trades/);
  });
});

describe('wallet scoring', () => {
  it('empty history → STANDARD with zeros', () => {
    const w = scoreWallet('nobody', [], flat(100), cfg);
    expect(w).toMatchObject({ tier: 'STANDARD', trades: 0, scoreBps: 0, totalNotional: 0 });
  });

  it('single huge informed trade is not enough for TOXIC (min trades)', () => {
    const mids = new FixtureMidPrice([[0, 100], [30, 110], [1000, 110]], Infinity);
    const w = scoreWallet('W', [swap({ ts: 0, quoteAmount: 10_000_000, baseAmount: 100_000 })], mids, cfg);
    expect(w.scoreBps).toBeGreaterThan(990); // shrinkage negligible at $10M
    expect(w.trades).toBe(1);
    expect(w.tier).toBe('STANDARD');
  });

  it('consistent informed trader becomes TOXIC; noise trader with history becomes RETAIL', () => {
    // price path: up 20 bps every 30s, forever
    const path: Array<[number, number]> = [];
    for (let t = 0; t <= 10 * 86_400; t += 30) path.push([t, 100 * Math.pow(1.002, t / 30)]);
    const mids = new FixtureMidPrice(path, 60);
    const swaps: Swap[] = [];
    for (let i = 0; i < 10; i++) {
      const t = i * 3_000;
      swaps.push(swap({ trader: 'BOT', ts: t, side: 'buy', execPrice: mids.midAt(t)!, quoteAmount: 5_000 }));
    }
    // retail: alternating directions spread over 4 days -> markouts cancel
    for (let i = 0; i < 12; i++) {
      const t = i * 30_000;
      swaps.push(swap({ trader: 'RITA', ts: t, side: i % 2 ? 'buy' : 'sell', execPrice: mids.midAt(t)!, quoteAmount: 150 }));
    }
    const res = scoreWallets(swaps, mids, cfg);
    const bot = res.find((r) => r.trader === 'BOT')!;
    const rita = res.find((r) => r.trader === 'RITA')!;
    expect(bot.tier).toBe('TOXIC');
    expect(bot.scoreBps).toBeGreaterThan(10);
    expect(rita.tier).toBe('RETAIL');
    expect(Math.abs(rita.scoreBps)).toBeLessThan(3);
    expect(rita.historyDays).toBeGreaterThan(3);
  });

  it('missing mids are skipped per horizon, not treated as zero', () => {
    const mids = new SeriesMidPrice([[0, 100], [5, 101]], { maxStaleSec: 1 });
    const w = scoreWallet('W', [swap({ ts: 0 })], mids, makeConfig({ priorNotional: 0 }));
    expect(w.byHorizon[5]!.scoredTrades).toBe(1);
    expect(w.byHorizon[5]!.scoreBps).toBeCloseTo(100);
    expect(w.byHorizon[30]!.scoredTrades).toBe(0);
    expect(w.scoreBps).toBe(0);
  });

  it('is deterministic and order-independent', () => {
    const mids = new FixtureMidPrice([[0, 100], [40, 103], [80, 99], [500, 99]], Infinity);
    const swaps = [
      swap({ trader: 'B', ts: 10, side: 'sell', execPrice: 100 }),
      swap({ trader: 'A', ts: 20, side: 'buy', execPrice: 100.5 }),
      swap({ trader: 'B', ts: 45, side: 'buy', execPrice: 103 }),
    ];
    const a = scoreWallets(swaps, mids, cfg);
    const b = scoreWallets([...swaps].reverse(), mids, cfg);
    expect(a).toEqual(b);
    expect(a.map((x) => x.trader)).toEqual(['A', 'B']);
    expect(JSON.stringify(scoreWallets(swaps, mids, cfg))).toBe(JSON.stringify(a));
  });

  it('secondsPerDay compresses history for fixtures', () => {
    const w = scoreWallet('W', [swap({ ts: 0 }), swap({ ts: 360 })], flat(100), makeConfig({ secondsPerDay: 60 }));
    expect(w.historyDays).toBeCloseTo(6);
  });

  it('toOnchainScore maps to integers and tier indexes', () => {
    expect(toOnchainScore({ tier: 'RETAIL', scoreBps: 1.6, trades: 9 })).toEqual({ tier: 0, scoreBps: 2, trades: 9 });
    expect(toOnchainScore({ tier: 'TOXIC', scoreBps: -1e12, trades: 3 }).scoreBps).toBe(-2_147_483_648);
    expect(toOnchainScore({ tier: 'STANDARD', scoreBps: 0, trades: 0 }).tier).toBe(1);
  });
});

describe('mid price providers', () => {
  it('series is a step function and respects staleness', () => {
    const s = new SeriesMidPrice([[10, 1], [20, 2]], { maxStaleSec: 5 });
    expect(s.midAt(9)).toBeUndefined();
    expect(s.midAt(10)).toBe(1);
    expect(s.midAt(14)).toBe(1);
    expect(s.midAt(16)).toBeUndefined();
    expect(s.midAt(20)).toBe(2);
    expect(s.midAt(26)).toBeUndefined();
  });
  it('pool implied uses last trade per pool and reserve snapshots', () => {
    const p = new PoolImpliedMidPrice(
      [
        { ts: 1, pool: 'A', execPrice: 150 },
        { ts: 2, pool: 'B', execPrice: 7 },
      ],
      { reserveSnapshots: [{ ts: 3, pool: 'A', base: 10, quote: 1510 }] },
    );
    expect(p.midAt(2, 'A')).toBe(150);
    expect(p.midAt(4, 'A')).toBe(151);
    expect(p.midAt(4, 'B')).toBe(7);
    expect(p.midAt(4)).toBeUndefined();
    expect(p.midAt(4, 'C')).toBeUndefined();
  });
  it('pyth stub is safe: undefined until seeded', async () => {
    const p = new PythMidPrice();
    expect(await p.load(0, 10)).toBe(0);
    expect(p.midAt(5)).toBeUndefined();
    p.seed([[0, 150]]);
    expect(p.midAt(5)).toBe(150);
  });
});

describe('all-horizons tier rule', () => {
  const base = { trades: 10, historyDays: 5, scoreBps: 0 };
  it('flags informed flow that hides beyond the primary horizon', () => {
    expect(assignTier({ ...base, maxScoreBps: 15 }, cfg)).toBe('TOXIC');
    expect(assignTier({ ...base, maxScoreBps: 15 }, makeConfig({ tierRule: 'primary' }))).toBe('RETAIL');
  });
  it('RETAIL requires every horizon below the retail threshold', () => {
    expect(assignTier({ ...base, maxScoreBps: 5 }, cfg)).toBe('STANDARD');
    expect(assignTier({ ...base, maxScoreBps: 2 }, cfg)).toBe('RETAIL');
  });
  it('scoreWallet uses the 60s horizon when 30s looks clean', () => {
    // price flat for 30s after each trade, then +30 bps by 60s
    const pts: Array<[number, number]> = [];
    const swaps: Swap[] = [];
    for (let i = 0; i < 8; i++) {
      const t = i * 1000;
      pts.push([t, 100], [t + 59, 100.3], [t + 999, 100]);
      swaps.push(swap({ trader: 'S', ts: t, execPrice: 100, quoteAmount: 10_000 }));
    }
    const w = scoreWallet('S', swaps, new SeriesMidPrice(pts), cfg);
    expect(Math.abs(w.scoreBps)).toBeLessThan(1);
    expect(w.maxScoreBps).toBeGreaterThan(20);
    expect(w.tier).toBe('TOXIC');
  });
});
