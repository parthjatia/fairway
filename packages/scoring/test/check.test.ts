import { describe, expect, it } from 'vitest';
import { buildTokenCheck, checkContextFrom, checkToken, checkWallet, gradeOf, listChecks, type CheckTrade, type LaunchTrade } from '../src';

const buy = (wallet: string, slot: number, tokens: number, sol = 1): CheckTrade => ({ wallet, slot, kind: 'buy', tokens, sol });
const sell = (wallet: string, slot: number, tokens: number): CheckTrade => ({ wallet, slot, kind: 'sell', tokens, sol: 1 });
const base = { mint: 'M', launchSlot: 1000 };

describe('gradeOf: thresholds', () => {
  it('High at 30%, or at 15% with a 50% dump', () => {
    expect(gradeOf(30, 0)).toBe('High');
    expect(gradeOf(29.9, 0)).toBe('Medium');
    expect(gradeOf(15, 50)).toBe('High');
    expect(gradeOf(15, 49.9)).toBe('Medium');
    expect(gradeOf(14.9, 100)).toBe('Medium');
  });
  it('Medium from 10%, Low below', () => {
    expect(gradeOf(10, 0)).toBe('Medium');
    expect(gradeOf(9.99, 0)).toBe('Low');
    expect(gradeOf(0, 0)).toBe('Low');
  });
});

describe('buildTokenCheck', () => {
  const tierOf = (w: string) => (w.startsWith('s') ? ('TOXIC' as const) : ('STANDARD' as const));
  it('sniper share is token-weighted over the first 60 s only', () => {
    const r = buildTokenCheck({ ...base, trades: [buy('s1', 1000, 300), buy('h1', 1005, 600), buy('h2', 1010, 100), buy('s2', 1000 + 151, 9_999)], tierOf });
    expect(r.earlyBuyers).toBe(3); // s2 bought at +151 slots: outside the window
    expect(r.sniperSharePct).toBeCloseTo(30, 6);
    expect(r.grade).toBe('High');
  });
  it('dumped = sniper tokens sold ÷ sniper tokens bought, capped per wallet', () => {
    const r = buildTokenCheck({ ...base, trades: [buy('s1', 1000, 100), buy('s2', 1001, 100), buy('h1', 1002, 800), sell('s1', 1200, 100), sell('s2', 1300, 50), sell('h1', 1300, 800)], tierOf });
    expect(r.snipersSold).toBe(2);
    expect(r.snipersDumpedPct).toBeCloseTo(75, 6);
    expect(r.topBuyers.find((b) => b.wallet === 'h1')!.soldPct).toBe(100);
  });
  it('a sell before the first buy is not a dump; selling more than bought caps at 100%', () => {
    const r = buildTokenCheck({ ...base, trades: [buy('s1', 1010, 100), sell('s1', 1005, 999), buy('h1', 1010, 900)], tierOf });
    expect(r.snipersDumpedPct).toBe(0);
    const r2 = buildTokenCheck({ ...base, trades: [buy('s1', 1010, 100), sell('s1', 1020, 999), buy('h1', 1010, 900)], tierOf });
    expect(r2.snipersDumpedPct).toBe(100);
  });
  it('fresh share counts early buyers with no history; first-block flag; top buyers sorted', () => {
    const r = buildTokenCheck({ ...base, trades: [buy('a', 1000, 5), buy('b', 1003, 50), buy('c', 1004, 20)], tierOf, hadHistory: (w) => w === 'a' });
    expect(r.freshWalletSharePct).toBeCloseTo(200 / 3, 6);
    expect(r.topBuyers.map((b) => b.wallet)).toEqual(['b', 'c', 'a']);
    expect(r.topBuyers.find((b) => b.wallet === 'a')!.firstBlock).toBe(true);
    expect(r.topBuyers.find((b) => b.wallet === 'b')!.firstBlock).toBe(false);
    expect(r.topBuyers[0]!.entrySlots).toBe(3);
  });
  it('fair launch verified needs a low sniper share AND enough buyers; few buyers is low confidence', () => {
    const many: CheckTrade[] = Array.from({ length: 12 }, (_, i) => buy(`h${i}`, 1000 + i, 100));
    expect(buildTokenCheck({ ...base, trades: many, tierOf }).fairLaunchVerified).toBe(true);
    expect(buildTokenCheck({ ...base, trades: [...many, buy('s1', 1001, 300)], tierOf }).fairLaunchVerified).toBe(false);
    const few = buildTokenCheck({ ...base, trades: many.slice(0, 3), tierOf });
    expect(few.lowConfidence).toBe(true);
    expect(few.fairLaunchVerified).toBe(false);
  });
  it('no early buys: not found-with-data, Low, no crash', () => {
    const r = buildTokenCheck({ ...base, trades: [sell('x', 1500, 1)], tierOf });
    expect(r.earlyBuyers).toBe(0);
    expect(r.topBuyers).toEqual([]);
    expect(Number.isFinite(r.sniperSharePct)).toBe(true);
  });
  it('verdict says it plainly', () => {
    const r = buildTokenCheck({ ...base, trades: [buy('s1', 1000, 380), buy('h1', 1002, 620), sell('s1', 1300, 380)], tierOf });
    expect(r.verdict).toBe('High risk: snipers bought 38% of early supply and have already sold 100% of it.');
  });
  it('is deterministic', () => {
    const t = [buy('s1', 1000, 100), buy('h1', 1001, 100), buy('h2', 1001, 100)];
    expect(buildTokenCheck({ ...base, trades: t, tierOf })).toEqual(buildTokenCheck({ ...base, trades: [...t].reverse(), tierOf }));
  });
});

// ---- from raw launch trades: three launches where `bot` always buys in the first slot and the price then rises
function launches(): LaunchTrade[] {
  const out: LaunchTrade[] = [];
  let n = 0;
  const T = (mint: string, slot: number, trader: string, kind: LaunchTrade['kind'], tokenAmount: number, solAmount: number, price: number) => out.push({ sig: `s${n++}`, mint, slot, trader, kind, tokenAmount, solAmount, price });
  for (let i = 0; i < 4; i++) {
    const mint = `T${i}`;
    const L = 10_000 * (i + 1);
    T(mint, L, 'dev', 'create', 0, 0, 0);
    T(mint, L, 'bot', 'buy', 1000, 10, 0.01);
    for (let k = 0; k < 6; k++) T(mint, L + 2 + k, `h${i}${k}`, 'buy', 500, 6, 0.012 + k * 0.001);
    T(mint, L + 80, 'late', 'buy', 100, 3, 0.03);
    T(mint, L + 200, 'bot', 'sell', 1000, 30, 0.03);
  }
  return out;
}

describe('checkToken / checkWallet from launch trades', () => {
  const trades = launches();
  const ctx = checkContextFrom(trades);
  it('the repeat early buyer is TOXIC and dominates the early supply of its launches', () => {
    const r = checkToken(trades, 'T3', ctx);
    expect(ctx.snipers.get('bot')!.tier).toBe('TOXIC');
    expect(r.sniperSharePct).toBeCloseTo((1000 / (1000 + 6 * 500 + 100)) * 100, 6);
    expect(r.snipersDumpedPct).toBe(100);
    expect(r.topBuyers[0]!.wallet).toBe('bot');
    expect(r.topBuyers[0]!.tier).toBe('TOXIC');
  });
  it('fresh = no trade on another token BEFORE this launch', () => {
    const t0 = checkToken(trades, 'T0', ctx); // bot and dev's creates are the first trades anywhere
    expect(t0.topBuyers.find((b) => b.wallet === 'bot')!.fresh).toBe(true);
    const t2 = checkToken(trades, 'T2', ctx);
    expect(t2.topBuyers.find((b) => b.wallet === 'bot')!.fresh).toBe(false);
  });
  it('unknown token: found = false', () => {
    expect(checkToken(trades, 'nope', ctx).found).toBe(false);
  });
  it('bundled wallets count as snipers', () => {
    const c2 = checkContextFrom(trades, ['h30', 'h31']);
    expect(checkToken(trades, 'T3', c2).sniperSharePct).toBeGreaterThan(checkToken(trades, 'T3', ctx).sniperSharePct);
    expect(checkToken(trades, 'T3', c2).topBuyers.find((b) => b.wallet === 'h30')!.bundle).toBe(true);
  });
  it('wallet check: tier, launches, first-block buys, markout', () => {
    const w = checkWallet(trades, 'bot', ctx);
    expect(w.tier).toBe('TOXIC');
    expect(w.launches).toBe(4);
    expect(w.firstBlockBuys).toBe(4);
    expect(w.avgMarkoutBps).toBeGreaterThan(500);
    expect(w.recent.length).toBeGreaterThan(0);
    const h = checkWallet(trades, 'h00', ctx);
    expect(h.tier).toBe('STANDARD');
    expect(h.firstBlockBuys).toBe(0);
    expect(checkWallet(trades, 'stranger', ctx).found).toBe(false);
  });
  it('listChecks: newest launch first', () => {
    expect(listChecks(trades, ctx).map((c) => c.mint)).toEqual(['T3', 'T2', 'T1', 'T0']);
  });
});
