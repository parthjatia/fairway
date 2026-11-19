import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { loadBlocks, loadDataset } from '@fairway/fixtures/node';
import { fixtureMids } from '@fairway/fixtures';
import { parsePayload, toParserPools } from '@fairway/parser';
import { buildApp, countSwaps, getScore, openDb, recompute, signForTest, upsertSwaps, verifyDelivery, type MidSource } from '../src';

const ds = loadDataset();
const fx = loadBlocks();
const pools = toParserPools(ds.meta.pools);
const mids: MidSource = { name: 'fixture-cex', provider: () => fixtureMids(ds.cex) };
const fresh = (token?: string) => {
  const db = openDb(':memory:');
  return { db, app: buildApp({ db, pools, mids, mode: 'fixture', token }) };
};
const post = (app: ReturnType<typeof buildApp>, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/streams/solana', payload: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

describe('POST /streams/solana', () => {
  it('stores filter output idempotently on (sig, pool)', async () => {
    const { db, app } = fresh();
    const swaps = parsePayload(fx.blocks, pools);
    const r1 = await post(app, { swaps });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ kind: 'filtered', received: swaps.length, stored: swaps.length });
    const r2 = await post(app, { swaps });
    expect(r2.json().stored).toBe(0);
    expect(countSwaps(db)).toBe(swaps.length);
  });
  it('parses raw blocks server-side (same result as the filter)', async () => {
    const { db, app } = fresh();
    const r = await post(app, fx.blocks);
    expect(r.json()).toMatchObject({ kind: 'raw-blocks', stored: fx.expected.length });
    expect(countSwaps(db)).toBe(fx.expected.length);
  });
  it('accepts gzip bodies', async () => {
    const { db, app } = fresh();
    const res = await app.inject({ method: 'POST', url: '/streams/solana', payload: gzipSync(JSON.stringify({ data: fx.blocks.slice(0, 20) })), headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } });
    expect(res.statusCode).toBe(200);
    expect(countSwaps(db)).toBeGreaterThan(0);
  });
  it('rejects malformed records and bad JSON', async () => {
    const { db, app } = fresh();
    const r = await post(app, { swaps: [{ sig: 'x' }, { ...ds.swaps[0], baseAmount: -1 }, ds.swaps[1]] });
    expect(r.json()).toMatchObject({ received: 3, invalid: 2, stored: 1 });
    expect(countSwaps(db)).toBe(1);
    expect((await post(app, '{not json')).statusCode).toBe(400);
  });
  it('enforces the shared secret / QuickNode HMAC when a token is set', async () => {
    const { app } = fresh('s3cret');
    const body = JSON.stringify({ swaps: [ds.swaps[0]] });
    expect((await post(app, body)).statusCode).toBe(401);
    expect((await post(app, body, { 'x-fairway-token': 'wrong' })).statusCode).toBe(401);
    expect((await post(app, body, { 'x-fairway-token': 's3cret' })).statusCode).toBe(200);
    const sig = signForTest('s3cret', 'n1', '1700000000', body);
    expect((await post(app, body, { 'x-qn-signature': sig, 'x-qn-nonce': 'n1', 'x-qn-timestamp': '1700000000' })).statusCode).toBe(200);
    expect((await post(app, body, { 'x-qn-signature': sig, 'x-qn-nonce': 'n2', 'x-qn-timestamp': '1700000000' })).statusCode).toBe(401);
  });
  it('verifyDelivery without a token accepts everything', () => {
    expect(verifyDelivery(undefined, {}, '')).toEqual({ ok: true, method: 'none' });
  });
});

describe('scores + read APIs (full fixture dataset)', () => {
  const db = openDb(':memory:');
  upsertSwaps(db, ds.swaps);
  const res = recompute(db, mids);
  const app = buildApp({ db, pools, mids, mode: 'fixture', labels: Object.fromEntries(ds.meta.personas.map((p) => [p.address, p.name])) });
  it('recompute scores every wallet and matches the fixture personas', () => {
    expect(res.wallets).toBe(new Set(ds.swaps.map((s) => s.trader)).size);
    for (const p of ds.meta.personas) {
      const s = getScore(db, p.address);
      expect(s?.tier ?? 'STANDARD').toBe(p.expectedTier);
    }
  });
  it('GET /wallet/:address returns score, trades with markouts, timeline and explanation', async () => {
    const rita = ds.meta.personas.find((p) => p.key === 'rita')!;
    const r = (await app.inject({ url: `/wallet/${rita.address}` })).json();
    expect(r).toMatchObject({ known: true, tier: 'RETAIL', label: 'Retail Rita' });
    expect(r.trades.length).toBeGreaterThan(5);
    expect(r.trades[0].markouts).toHaveProperty('30');
    expect(r.timeline.at(-1).tier).toBe('RETAIL');
    expect(r.explanation).toMatch(/uninformed/);
  });
  it('unknown wallet → STANDARD with explanation', async () => {
    const r = (await app.inject({ url: '/wallet/NewWa11et1111111111111111111111111111111111' })).json();
    expect(r).toMatchObject({ known: false, tier: 'STANDARD' });
    expect(r.explanation).toMatch(/rotating wallets/);
  });
  it('GET /pool/:id/stats aggregates by tier; 404 for unknown pools', async () => {
    const fw = ds.meta.pools.find((p) => p.venue === 'fairway')!;
    const r = (await app.inject({ url: `/pool/${fw.id}/stats` })).json();
    expect(r.trades).toBeGreaterThan(100);
    expect(r.volumeByTier.TOXIC).toBeGreaterThan(0);
    expect(r.feesByTier.RETAIL).toBeGreaterThan(0);
    expect((await app.inject({ url: '/pool/nope/stats' })).statusCode).toBe(404);
  });
  it('GET /health, /wallets, /export.jsonl, POST /recompute', async () => {
    const h = (await app.inject({ url: '/health' })).json();
    expect(h).toMatchObject({ ok: true, mode: 'fixture', swaps: ds.swaps.length });
    const toxic = (await app.inject({ url: '/wallets?tier=TOXIC' })).json();
    expect(toxic.length).toBeGreaterThanOrEqual(5);
    const ex = await app.inject({ url: '/export.jsonl' });
    expect(ex.body.split('\n')).toHaveLength(ds.swaps.length);
    const rc = (await app.inject({ method: 'POST', url: '/recompute', payload: { traders: [ds.swaps[0]!.trader] } })).json();
    expect(rc.wallets).toBe(1);
  });
});
