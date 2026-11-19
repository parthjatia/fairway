import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  accumulateOnchain,
  assignTier,
  EMPTY_SUMS,
  execPriceE6,
  makeConfig,
  markoutBps,
  onchainMarkoutBps,
  onchainParamsFrom,
  onchainScoreBps,
  onchainTier,
  pythToPriceE6,
  shrunkScore,
  TIER_FROM_INDEX,
  type OnchainTierParams,
} from '../src';

type Trade = { side: 0 | 1; exec: number; mid: number; notional: number };
const V = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'crates', 'fairway-math', 'vectors', 'onchain.json'), 'utf8'));
const P: OnchainTierParams = {
  priorNotional: BigInt(V.params.prior_notional),
  toxicBps: V.params.toxic_bps,
  toxicMinTrades: V.params.toxic_min_trades,
  retailBps: V.params.retail_bps,
  retailMinTrades: V.params.retail_min_trades,
  retailMinHistorySlots: BigInt(V.params.retail_min_history_slots),
};

describe('shared onchain vectors (same file as crates/fairway-math/tests/onchain_vectors.rs)', () => {
  it('markout', () => {
    for (const c of V.markout) expect(onchainMarkoutBps(c.side, BigInt(c.exec), BigInt(c.mid)), JSON.stringify(c)).toBe(BigInt(c.expected));
  });
  it('exec price + pyth conversion', () => {
    for (const c of V.exec_price) expect(execPriceE6(BigInt(c.quote_raw), c.quote_decimals, BigInt(c.base_raw), c.base_decimals)).toBe(BigInt(c.expected));
    for (const c of V.pyth) expect(pythToPriceE6(BigInt(c.price), c.expo)).toBe(BigInt(c.expected));
    expect(() => pythToPriceE6(1n, -8)).toThrow();
  });
  it('scenarios: sums, shrunk score and tier', () => {
    for (const sc of V.scenarios) {
      let s = EMPTY_SUMS;
      for (const t of sc.trades as Trade[]) s = accumulateOnchain(s, BigInt(t.notional), onchainMarkoutBps(t.side, BigInt(t.exec), BigInt(t.mid)));
      const e = sc.expected;
      expect(s.sumNotional, sc.name).toBe(BigInt(e.sum_notional));
      expect(s.sumWeightedMarkout, sc.name).toBe(BigInt(e.sum_weighted_markout));
      expect(s.trades, sc.name).toBe(e.trades);
      expect(onchainScoreBps(s, P.priorNotional), sc.name).toBe(e.score_bps);
      expect(onchainTier(s, BigInt(sc.history_slots), P), sc.name).toBe(e.tier);
    }
  });
});

describe('onchain integer math agrees with the float scorer', () => {
  const cfg = makeConfig({ tierRule: 'primary' });
  it('vector params are the package defaults (K = 2000 USDC, 10/3 bps, 5 trades, 3 days)', () => {
    expect(onchainParamsFrom(cfg)).toEqual(P);
  });
  it('same tier and score within 1 bps on every scenario', () => {
    for (const sc of V.scenarios) {
      const trades = sc.trades as Trade[];
      let nm = 0;
      let n = 0;
      for (const t of trades) {
        const m = markoutBps(t.side === 0 ? 'buy' : 'sell', t.exec / 1e6, t.mid / 1e6);
        nm += (t.notional / 1e6) * m;
        n += t.notional / 1e6;
      }
      const score = shrunkScore(nm, n, cfg.priorNotional);
      const historyDays = (sc.history_slots * 0.4) / cfg.secondsPerDay;
      const floatTier = trades.length === 0 ? 'STANDARD' : assignTier({ scoreBps: score, trades: trades.length, historyDays }, cfg);
      expect(TIER_FROM_INDEX[sc.expected.tier], sc.name).toBe(floatTier);
      expect(Math.abs(score - sc.expected.score_bps), sc.name).toBeLessThan(1);
    }
  });
  it('sign conventions', () => {
    expect(onchainMarkoutBps('buy', 100_000_000n, 101_000_000n)).toBe(100n);
    expect(onchainMarkoutBps('sell', 100_000_000n, 101_000_000n)).toBe(-100n);
    expect(onchainMarkoutBps('buy', 1_000_000n, 900_000_000n)).toBe(10_000n); // clamped
  });
});
