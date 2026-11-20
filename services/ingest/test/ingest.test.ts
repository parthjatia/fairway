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

describe('launches: POST /streams/pumpfun + GET /snipers (M16)', () => {
  it('stores pumpfun-filter output idempotently and flags recurring snipers TOXIC', async () => {
    const { loadPumpfun } = await import('@fairway/fixtures/node');
    const { parsePumpPayload } = await import('@fairway/parser');
    const { desiredScores } = await import('../src');
    const pf = loadPumpfun();
    const { db, app } = fresh();
    const launchTrades = parsePumpPayload(pf.blocks);
    const send = (body: unknown) => app.inject({ method: 'POST', url: '/streams/pumpfun', payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    const r1 = await send({ launchTrades });
    expect(r1.json()).toMatchObject({ kind: 'filtered', stored: launchTrades.length, snipers: { toxic: pf.meta.snipers.length } });
    expect((await send({ launchTrades })).json().stored).toBe(0);
    expect((await send(pf.blocks)).json()).toMatchObject({ kind: 'raw-blocks', stored: 0 });
    const toxic = (await app.inject({ url: '/snipers?tier=TOXIC' })).json() as Array<{ wallet: string }>;
    expect(new Set(toxic.map((s) => s.wallet))).toEqual(new Set(pf.meta.snipers));
    const w = (await app.inject({ url: `/wallet/${pf.meta.snipers[0]}` })).json();
    expect(w.sniper).toMatchObject({ tier: 'TOXIC' });
    const d = desiredScores(db).filter((x) => x.source === 'launch-sniper');
    expect(d.map((x) => x.trader).sort()).toEqual([...pf.meta.snipers].sort());
    expect(d.every((x) => x.tier === 'TOXIC')).toBe(true);
  });
  it('bundle detection: stores fundings from the filter, flags bundles, raises tiers only (M16 step 11)', async () => {
    const { loadBundles } = await import('@fairway/fixtures/node');
    const { parseLaunchStream } = await import('@fairway/parser');
    const { desiredScores } = await import('../src');
    const bx = loadBundles();
    const { db, app } = fresh();
    const out = parseLaunchStream(bx.blocks)!;
    const send = (body: unknown) => app.inject({ method: 'POST', url: '/streams/pumpfun', payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    const r1 = (await send(out)).json();
    expect(r1).toMatchObject({ kind: 'filtered', fundings: { received: bx.expectedFundings.length, stored: bx.expectedFundings.length }, bundles: { bundles: 3, knownBundlers: 1 } });
    expect((await send(out)).json().fundings.stored).toBe(0); // idempotent
    expect((await send(bx.blocks)).json()).toMatchObject({ kind: 'raw-blocks', fundings: { stored: 0 } });
    const b = (await app.inject({ url: '/bundles' })).json() as { flags: { wallet: string; reason: string; funderKnownBundler: boolean }[]; funders: { funder: string; knownBundler: boolean }[] };
    const flagged = new Set(b.flags.map((f) => f.wallet));
    for (const x of bx.meta.bundles) for (const w of x.wallets) expect(flagged.has(w)).toBe(true);
    for (const w of bx.meta.notFlagged) expect(flagged.has(w)).toBe(false);
    expect(b.funders.filter((f) => f.knownBundler).map((f) => f.funder)).toEqual([bx.meta.bundler]);
    // the funder is a known bundler, so every flagged wallet is written TOXIC
    const d = desiredScores(db).filter((x) => x.source === 'bundle');
    expect(new Set(d.map((x) => x.trader))).toEqual(flagged);
    expect(d.every((x) => x.tier === 'TOXIC')).toBe(true);
    // a flagged wallet with a RETAIL markout score is raised to STANDARD, never lowered; a fresh flagged wallet with an
    // unknown funder needs no account (STANDARD is the default)
    upsertSwaps(db, ds.swaps);
    recompute(db, mids);
    const retail = (await app.inject({ url: '/wallets?tier=RETAIL' })).json() as Array<{ trader: string }>;
    expect(retail.length).toBeGreaterThan(0);
    const rita = retail[0]!.trader;
    db.prepare("INSERT INTO bundle_funders (funder, launches, wallets, known_bundler) VALUES ('X', 1, 2, 0)").run();
    db.prepare('INSERT INTO bundle_flags (wallet, funder, reason, mint, slot) VALUES (?, ?, ?, ?, ?)').run(rita, 'X', 'bundle', 'm', 1);
    db.prepare('INSERT INTO bundle_flags (wallet, funder, reason, mint, slot) VALUES (?, ?, ?, ?, ?)').run('w-fresh', 'X', 'bundle', 'm', 1);
    const ds2 = desiredScores(db);
    expect(ds2.find((x) => x.trader === rita)).toMatchObject({ tier: 'STANDARD', source: 'bundle' });
    expect(ds2.find((x) => x.trader === 'w-fresh')).toBeUndefined();
  });
  it('requires the token when configured', async () => {
    const { app } = fresh('s3cret');
    const r = await app.inject({ method: 'POST', url: '/streams/pumpfun', payload: '{"launchTrades":[]}', headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(401);
  });
});

describe('Fairway Check (M18)', () => {
  it('fixture mode: token reports have a grade, snipers and a ranked buyer table; wallet reports agree', async () => {
    const { createContext } = await import('../src');
    const ctx = createContext({ DATA_MODE: 'fixture', INGEST_DB_PATH: ':memory:' });
    const app = buildApp({ db: ctx.db, pools: ctx.pools, mids: ctx.mids, mode: 'fixture' });
    const list = (await app.inject({ method: 'GET', url: '/check/tokens?limit=20' })).json();
    expect(list.source).toBe('simulated');
    expect(list.tokens.length).toBeGreaterThanOrEqual(8);
    const grades = new Set(list.tokens.map((t: any) => t.grade));
    expect(grades.has('High')).toBe(true);
    const t = list.tokens.find((x: any) => x.sniperCount > 0)!;
    const one = (await app.inject({ method: 'GET', url: `/check/token/${t.mint}` })).json();
    expect(one).toMatchObject({ mint: t.mint, found: true, grade: t.grade, source: 'simulated' });
    expect(one.topBuyers.length).toBeGreaterThan(0);
    expect(one.topBuyers.some((b: any) => b.tier === 'TOXIC')).toBe(true);
    expect(one.verdict).toMatch(/risk/);
    const all = list.tokens.flatMap((x: any) => x.topBuyers);
    const sniper = all.find((b: any) => b.tier === 'TOXIC' && !b.bundle).wallet;
    const w = (await app.inject({ method: 'GET', url: `/check/wallet/${sniper}` })).json();
    expect(w).toMatchObject({ found: true, tier: 'TOXIC' });
    expect(w.launches).toBeGreaterThanOrEqual(3);
    expect(w.firstBlockBuys).toBeGreaterThan(0);
  });
  it('the check fixture produces the designed Low / Medium / High spread through the API', async () => {
    const { createContext } = await import('../src');
    const { loadChecks } = await import('@fairway/fixtures/node');
    const ctx = createContext({ DATA_MODE: 'fixture', INGEST_DB_PATH: ':memory:' });
    const app = buildApp({ db: ctx.db, pools: ctx.pools, mids: ctx.mids, mode: 'fixture' });
    for (const t of loadChecks().meta.tokens) {
      const r = (await app.inject({ method: 'GET', url: `/check/token/${t.mint}` })).json();
      expect(r.grade, t.name).toBe(t.expectGrade);
    }
  });
  it('the SQL-backed report equals the pure report computed from all stored trades', async () => {
    const { createContext, allLaunchTrades, listBundleFlags, checkTokenFromDb, checkWalletFromDb } = await import('../src');
    const { checkContextFrom, checkToken, checkWallet } = await import('@fairway/scoring');
    const ctx = createContext({ DATA_MODE: 'fixture', INGEST_DB_PATH: ':memory:' });
    const trades = allLaunchTrades(ctx.db);
    const bundled = listBundleFlags(ctx.db).filter((f) => f.funderKnownBundler).map((f) => f.wallet);
    const pure = checkContextFrom(trades, bundled);
    const mints = [...new Set(trades.map((t) => t.mint))];
    expect(mints.length).toBeGreaterThanOrEqual(20);
    for (const m of mints) expect(checkTokenFromDb(ctx.db, m)).toEqual(checkToken(trades, m, pure));
    const wallets = [...new Set(trades.filter((t) => t.kind === 'buy').map((t) => t.trader))].slice(0, 60);
    for (const w of wallets) expect(checkWalletFromDb(ctx.db, w)).toEqual(checkWallet(trades, w, pure));
  });
  it('unknown and malformed ids', async () => {
    const { createContext } = await import('../src');
    const ctx = createContext({ DATA_MODE: 'fixture', INGEST_DB_PATH: ':memory:' });
    const app = buildApp({ db: ctx.db, pools: ctx.pools, mids: ctx.mids, mode: 'fixture' });
    const none = (await app.inject({ method: 'GET', url: '/check/token/11111111111111111111111111111111' })).json();
    expect(none.found).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/check/token/not-an-address!' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/check/wallet/11111111111111111111111111111111' })).json().found).toBe(false);
  });
});
