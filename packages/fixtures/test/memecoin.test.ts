import { describe, expect, it } from 'vitest';
import { FixtureMidPrice, onchainParamsFrom, onchainScoreFromSwaps } from '@fairway/scoring';
import { generateMemecoinMarket, generateMarket, cexPoints } from '../src';

const market = generateMarket();
const input = {
  start: market.config.start,
  days: market.config.days,
  stepSec: market.config.stepSec,
  baseSlot: market.config.baseSlot,
  fees: market.config.fairwayFees,
  wallets: market.wallets,
};

describe('BONK-test memecoin pool (additive fixture)', () => {
  const m = generateMemecoinMarket(input);
  it('is deterministic and independent of the SOL-USDC market', () => {
    expect(generateMemecoinMarket(input).swaps).toEqual(m.swaps);
    // generating it must not change the SOL market (own RNG stream)
    expect(generateMarket().swaps.length).toBe(market.swaps.length);
    expect(m.pool.venue).toBe('fairway');
    expect(m.pool.baseDecimals).toBe(5);
    expect(m.note).toMatch(/TEST mint/);
  });
  it('lives at a memecoin price (< $0.001) with 1e12 fixed point headroom', () => {
    expect(m.cex.prices[0]).toBeLessThan(0.001);
    expect(m.swaps.every((s) => s.execPrice > 0 && s.pool === m.pool.id && s.venue === 'fairway')).toBe(true);
  });
  it('snipers are TOXIC onchain on the memecoin pool; Rita-like retail is not', () => {
    const mids = new FixtureMidPrice(cexPoints(m.cex), 10);
    const P = { ...onchainParamsFrom(), onchainMinNotional: 1_000_000_000n };
    const score = (trader: string) =>
      onchainScoreFromSwaps(m.swaps.filter((s) => s.trader === trader), (ts) => mids.midAt(ts), P, { asOf: m.cex.start + 4 * 86_400 });
    const sniper = m.extraWallets[0]!.address;
    const s = score(sniper);
    expect(s.tradeCount).toBeGreaterThanOrEqual(5);
    expect(s.tier).toBe('TOXIC');
    expect(s.scoreBps).toBeGreaterThanOrEqual(10);
    const retail = market.wallets.find((w) => w.cls === 'retail')!.address;
    expect(score(retail).tier).not.toBe('TOXIC');
  });
});
