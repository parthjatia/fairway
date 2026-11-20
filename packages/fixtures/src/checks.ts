/**
 * Fairway Check fixture (M18): ten synthetic Pump.fun-style launches with a deliberate spread of outcomes (Low, Medium and
 * High risk, one with too few buyers), five recurring snipers who really score TOXIC through packages/scoring, and a pool
 * of human wallets reused across launches (so "fresh wallet" shares vary). Normalised launch-trade records (the shape
 * the Stream L filter emits), deterministic (own seed 181). ADDITIVE: written to data/checks.json; no other fixture is touched.
 * Synthetic data: addresses are random, nothing here is a real token.
 *
 * Snipers buy in the first 0-4 slots and the price then rises, so their 30 s markout is large and positive. Humans buy
 * 30-140 slots after the launch (inside the 60 s Check window, outside the 25-slot sniper-scoring window).
 */
import { base58Encode } from './base58';
import { Rng } from './rng';

export type CheckTradeRecord = { sig: string; slot: number; ts: number; mint: string; venue: 'pumpfun'; trader: string; kind: 'create' | 'buy' | 'sell'; tokenAmount: number; solAmount: number; price: number };
export type CheckFixtureToken = { mint: string; name: string; launchSlot: number; humans: number; sniperShare: number; sellFrac: number; snipers: string[]; expectGrade: 'Low' | 'Medium' | 'High' };
export type CheckFixture = { synthetic: true; trades: CheckTradeRecord[]; meta: { snipers: string[]; tokens: CheckFixtureToken[] } };

const SPECS: Omit<CheckFixtureToken, 'mint' | 'launchSlot'>[] = [
  { name: 'DOGEWIF2', humans: 10, sniperShare: 0.42, sellFrac: 0.95, snipers: ['S1', 'S2', 'S3'], expectGrade: 'High' },
  { name: 'PEPEKING', humans: 12, sniperShare: 0.38, sellFrac: 0, snipers: ['S1', 'S4'], expectGrade: 'High' },
  { name: 'MOONCAT', humans: 14, sniperShare: 0.17, sellFrac: 0, snipers: ['S2'], expectGrade: 'Medium' },
  { name: 'GIGACHAD', humans: 13, sniperShare: 0.12, sellFrac: 0.6, snipers: ['S5', 'S4'], expectGrade: 'Medium' },
  { name: 'FAIRFROG', humans: 16, sniperShare: 0, sellFrac: 0, snipers: [], expectGrade: 'Low' },
  { name: 'SOLPAW', humans: 14, sniperShare: 0.04, sellFrac: 0, snipers: ['S3'], expectGrade: 'Low' },
  { name: 'RUGDOLL', humans: 15, sniperShare: 0.2, sellFrac: 0.8, snipers: ['S1', 'S3', 'S5'], expectGrade: 'High' },
  { name: 'TINYCOIN', humans: 4, sniperShare: 0, sellFrac: 0, snipers: [], expectGrade: 'Low' },
  { name: 'HYPERCAT', humans: 18, sniperShare: 0.25, sellFrac: 0.3, snipers: ['S2', 'S4', 'S5'], expectGrade: 'Medium' },
  { name: 'CALMCOIN', humans: 20, sniperShare: 0, sellFrac: 0, snipers: [], expectGrade: 'Low' },
];

export function generateCheckFixture(seed = 181): CheckFixture {
  const r = new Rng(seed);
  const addr = () => base58Encode(r.bytes(32));
  const sig = () => base58Encode(r.bytes(64));
  const snipers = Object.fromEntries(['S1', 'S2', 'S3', 'S4', 'S5'].map((k) => [k, addr()]));
  const pool = Array.from({ length: 60 }, addr);
  const t0 = 1_764_100_000;
  const BASE = 320_000_000;
  const trades: CheckTradeRecord[] = [];
  const tokens: CheckFixtureToken[] = [];
  SPECS.forEach((spec, i) => {
    const mint = addr();
    const L = BASE + i * 30_000;
    const tsOf = (slot: number) => t0 + i * 3_000 + Math.floor((slot - L) * 0.4);
    const p0 = 3e-8 * (0.8 + 0.4 * r.next());
    const price = (off: number) => p0 * (1 + 0.003 * Math.min(off, 150)) * (off > 160 ? Math.max(0.35, 1 - 0.002 * (off - 160)) : 1);
    const dev = addr();
    const push = (slot: number, trader: string, kind: CheckTradeRecord['kind'], tokenAmount: number) => {
      const p = price(slot - L);
      trades.push({ sig: sig(), slot, ts: tsOf(slot), mint, venue: 'pumpfun', trader, kind, tokenAmount, solAmount: kind === 'create' ? 0 : tokenAmount * p, price: kind === 'create' ? 0 : p });
    };
    push(L, dev, 'create', 0);
    // humans: distinct wallets from the pool, buys 30-140 slots after launch
    const chosen = [...pool].sort(() => r.next() - 0.5).slice(0, spec.humans);
    let humanTokens = 0;
    const humanBuys = chosen.map((w) => {
      const off = 30 + Math.floor(r.next() * 110);
      const tokens = Math.round(r.lognormal(50_000_000, 0.5));
      humanTokens += tokens;
      return { w, off, tokens };
    });
    for (const h of humanBuys.sort((a, b) => a.off - b.off)) push(L + h.off, h.w, 'buy', h.tokens);
    // snipers: first slots, sized to hit the target share of early supply
    const sniperTokens = spec.sniperShare > 0 ? (humanTokens * spec.sniperShare) / (1 - spec.sniperShare) : 0;
    spec.snipers.forEach((k, j) => {
      const each = Math.round(sniperTokens / spec.snipers.length);
      push(L + j, snipers[k]!, 'buy', each);
      if (spec.sellFrac > 0) push(L + 200 + 10 * j, snipers[k]!, 'sell', Math.round(each * spec.sellFrac));
    });
    // a few humans sell later, so "sold" is not only a sniper thing
    for (const h of humanBuys.slice(0, 2)) push(L + 260, h.w, 'sell', Math.round(h.tokens * 0.4));
    tokens.push({ ...spec, mint, launchSlot: L });
  });
  trades.sort((a, b) => a.slot - b.slot || a.sig.localeCompare(b.sig));
  return { synthetic: true, trades, meta: { snipers: Object.values(snipers), tokens } };
}
