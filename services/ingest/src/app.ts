import { gunzipSync } from 'node:zlib';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { explainTier, makeConfig, type ScoringConfig, type Swap, type Tier } from '@fairway/scoring';
import { parseFundingPayload, parsePayload, parsePumpPayload, type FundingRecord, type LaunchTradeRecord, type ParserPool } from '@fairway/parser';
import { verifyDelivery } from './auth';
import { allSwaps, countSwaps, getScore, lastDeliveries, listScores, logDelivery, maxTs, swapsOfPool, tierCounts, upsertSwaps, validSwap, type Db } from './db';
import { getSniper, listBundleFlags, listBundleFunders, listSnipers, recomputeBundles, recomputeSnipers, upsertFundings, upsertLaunchTrades, validFunding, validLaunchTrade } from './launches';
import { launchCounts } from './launches';
import { checkTokenFromDb, checkWalletFromDb, listTokenChecks } from './check';
import { recompute, tierTimeline, tradesWithMarkouts, type MidSource } from './recompute';

export type AppOptions = {
  db: Db;
  pools: ParserPool[];
  mids: MidSource;
  token?: string;
  mode: 'fixture' | 'live';
  /** recompute affected wallets right after each delivery (default true) */
  recomputeOnIngest?: boolean;
  /** answer Stream POSTs right after storing and run rescoring in the background (server default; tests keep it sync) */
  asyncRecompute?: boolean;
  scoring?: ScoringConfig;
  logger?: boolean;
  /** fixture mode: show these labels on wallet pages */
  labels?: Record<string, string>;
};

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

/** Hard cap on a request body, compressed or decompressed. */
export const MAX_BODY_BYTES = 16 * 1024 * 1024;
/** Raw (unfiltered) block payloads are rejected above this size: a Stream without a filter sends whole blocks (tens of MB). */
export const MAX_RAW_BLOCK_BYTES = 2 * 1024 * 1024;

const isLaunchShape = (b: any): boolean => !!b && !Array.isArray(b) && !Array.isArray(b.swaps) && (Array.isArray(b.launchTrades) || Array.isArray(b.fundings));
/** Batches: an array of filter outputs, or `{ data: [outputs] }`, merged into one `{ launchTrades, fundings }`. */
function mergeLaunchBatch(b: any): any {
  const items = Array.isArray(b) ? b : Array.isArray(b?.data) && b.data.length && b.data.every(isLaunchShape) ? b.data : null;
  if (!items || !items.length || !items.every((x: any) => x === null || isLaunchShape(x))) return b;
  const xs = items.filter(Boolean);
  return { launchTrades: xs.flatMap((x: any) => x.launchTrades ?? []), fundings: xs.flatMap((x: any) => x.fundings ?? []) };
}
/** QuickNode sends `null` (filter returned nothing) for empty blocks in some setups: acknowledge it. */
const isEmptyDelivery = (b: any) => b === null || b === undefined || (typeof b === 'object' && !Array.isArray(b) && Object.keys(b).length === 0);

export function buildApp(o: AppOptions): FastifyInstance {
  const app = Fastify({ logger: o.logger ?? false, bodyLimit: MAX_BODY_BYTES });
  const cfg = o.scoring ?? makeConfig();

  // background rescoring (asyncRecompute): coalesced, one run at a time, errors logged and never thrown at the Stream
  let pending: { launch: boolean; bundles: boolean; traders: Set<string> } = { launch: false, bundles: false, traders: new Set() };
  let timer: NodeJS.Timeout | null = null;
  const runBackground = () => {
    timer = null;
    const job = pending;
    pending = { launch: false, bundles: false, traders: new Set() };
    const t0 = Date.now();
    try {
      const snipers = job.launch ? recomputeSnipers(o.db) : null;
      const b = job.bundles ? recomputeBundles(o.db) : null;
      const w = job.traders.size ? recompute(o.db, o.mids, [...job.traders], cfg).wallets : 0;
      app.log.info({ snipers, bundles: b && { bundles: b.bundles, flagged: b.flagged }, wallets: w, ms: Date.now() - t0 }, 'background rescoring done');
    } catch (e) {
      app.log.error({ err: e }, 'background rescoring failed');
    }
  };
  const schedule = (j: { launch?: boolean; bundles?: boolean; traders?: string[] }) => {
    pending.launch ||= !!j.launch;
    pending.bundles ||= !!j.bundles;
    for (const t of j.traders ?? []) pending.traders.add(t);
    timer ??= setTimeout(runBackground, 1_000);
  };
  app.addHook('onClose', async () => {
    if (timer) clearTimeout(timer);
  });
  const deny = (req: { log: FastifyInstance['log']; headers: Record<string, unknown>; url: string }, reason: string) =>
    req.log.warn({ url: req.url, reason, headers: Object.keys(req.headers).filter((h) => h.startsWith('x-')) }, `REJECTED Stream delivery (401): ${reason}`);

  // keep the raw (decompressed) body for HMAC verification
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(['application/json', 'text/plain', 'application/octet-stream'], { parseAs: 'buffer' }, (req, body: Buffer, done) => {
    try {
      const enc = String(req.headers['content-encoding'] ?? '');
      const isGzip = enc.includes('gzip') || (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b);
      const text = (isGzip ? gunzipSync(body, { maxOutputLength: MAX_BODY_BYTES }) : body).toString('utf8');
      req.rawBody = text;
      done(null, text.length ? JSON.parse(text) : {});
    } catch (e) {
      const err = e as Error & { statusCode?: number; code?: string };
      err.statusCode = err.code === 'ERR_BUFFER_TOO_LARGE' ? 413 : 400;
      if (err.statusCode === 413) err.message = `payload too large (> ${MAX_BODY_BYTES} bytes decompressed). Add the Pump.fun / swap filter to the Stream so it sends compact records`;
      done(err, undefined);
    }
  });

  // permissive CORS for the demo frontend
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-headers', 'content-type, x-fairway-token');
    return payload;
  });
  app.options('/*', async (_req, reply) => reply.code(204).send());

  app.get('/health', async () => ({
    ok: true,
    mode: o.mode,
    swaps: countSwaps(o.db),
    wallets: tierCounts(o.db),
    pools: o.pools.length,
    latestTs: maxTs(o.db),
    mids: o.mids.name,
    launch: launchCounts(o.db),
    recentDeliveries: lastDeliveries(o.db, 5),
  }));

  /** QuickNode Streams webhook. Accepts filter output `{swaps:[...]}` or raw blocks (parsed server-side). */
  app.post('/streams/solana', async (req, reply) => {
    const auth = verifyDelivery(o.token, req.headers, req.rawBody ?? '');
    if (!auth.ok) {
      deny(req, auth.reason);
      return reply.code(401).send({ error: auth.reason });
    }
    if (isEmptyDelivery(req.body)) return { ok: true, kind: 'empty', received: 0, stored: 0 };
    const body = mergeLaunchBatch(req.body as any);
    if (isLaunchShape(body)) return ingestLaunch(body, reply, undefined, req.log);
    let kind: 'filtered' | 'raw-blocks';
    let incoming: Array<Swap & { source?: string }>;
    if (body && Array.isArray(body.swaps)) {
      kind = 'filtered';
      incoming = body.swaps;
    } else {
      kind = 'raw-blocks';
      const tooBig = rawTooLarge(req.rawBody);
      if (tooBig) return reply.code(413).send({ error: tooBig });
      incoming = parsePayload(body, o.pools);
    }
    const valid = incoming.filter(validSwap);
    const { stored, traders } = upsertSwaps(o.db, valid);
    logDelivery(o.db, kind, incoming.length, stored);
    let recomputed = 0;
    if ((o.recomputeOnIngest ?? true) && traders.length) {
      if (o.asyncRecompute) schedule({ traders });
      else recomputed = recompute(o.db, o.mids, traders, cfg).wallets;
    }
    req.log.info({ kind, received: incoming.length, stored, recomputed }, `stored ${stored} swaps`);
    return { ok: true, kind, received: incoming.length, invalid: incoming.length - valid.length, stored, recomputed };
  });

  const rawTooLarge = (raw?: string): string | null =>
    raw && raw.length > MAX_RAW_BLOCK_BYTES
      ? `raw-blocks payload is ${raw.length} bytes (max ${MAX_RAW_BLOCK_BYTES}). The Stream has no filter: paste streams/pumpfun-filter.js (or filter.js) into the Stream's filter so it sends { launchTrades, fundings } / { swaps }`
      : null;

  /** Shared by /streams/pumpfun and /streams/solana (when a Stream sends the Pump.fun filter's output). */
  function ingestLaunch(body: any, reply: FastifyReply, raw?: string, log?: FastifyInstance['log']) {
    const t0 = Date.now();
    const kind = body && Array.isArray(body.launchTrades) ? 'filtered' : Array.isArray(body?.fundings) ? 'filtered' : 'raw-blocks';
    if (kind === 'raw-blocks') {
      const tooBig = rawTooLarge(raw);
      if (tooBig) return reply.code(413).send({ error: tooBig });
    }
    const filtered = kind === 'filtered';
    const incoming: LaunchTradeRecord[] = filtered ? (Array.isArray(body.launchTrades) ? body.launchTrades : []) : parsePumpPayload(body);
    const fundingsIn: FundingRecord[] = filtered ? (Array.isArray(body.fundings) ? body.fundings : []) : parseFundingPayload(body);
    const valid = incoming.filter(validLaunchTrade);
    const validFundings = fundingsIn.filter(validFunding);
    const stored = upsertLaunchTrades(o.db, valid);
    const storedFundings = upsertFundings(o.db, validFundings);
    logDelivery(o.db, `launch-${kind}`, incoming.length + fundingsIn.length, stored + storedFundings);
    let snipers: ReturnType<typeof recomputeSnipers> | 'queued' | null;
    let bundles: { bundles: number; flagged: number; knownBundlers: number } | 'queued' | null;
    if (o.asyncRecompute) {
      if (stored || storedFundings) schedule({ launch: !!stored, bundles: true });
      snipers = stored ? 'queued' : null;
      bundles = stored || storedFundings ? 'queued' : null;
    } else {
      snipers = stored ? recomputeSnipers(o.db) : null;
      const b = stored || storedFundings ? recomputeBundles(o.db) : null;
      bundles = b ? { bundles: b.bundles, flagged: b.flagged, knownBundlers: b.knownBundlers } : null;
    }
    log?.info({ kind, launchTrades: incoming.length, fundings: fundingsIn.length, stored, storedFundings, invalid: incoming.length - valid.length, ms: Date.now() - t0 }, `launch delivery stored ${stored} trades, ${storedFundings} fundings`);
    return { ok: true, kind, received: incoming.length, invalid: incoming.length - valid.length, stored, fundings: { received: fundingsIn.length, invalid: fundingsIn.length - validFundings.length, stored: storedFundings }, snipers, bundles, launches: launchCounts(o.db) };
  }

  /** QuickNode Streams webhook for launches: streams/pumpfun-filter.js output `{launchTrades:[...], fundings:[...]}` or raw blocks. */
  app.post('/streams/pumpfun', async (req, reply) => {
    const auth = verifyDelivery(o.token, req.headers, req.rawBody ?? '');
    if (!auth.ok) {
      deny(req, auth.reason);
      return reply.code(401).send({ error: auth.reason });
    }
    if (isEmptyDelivery(req.body)) return { ok: true, kind: 'empty', received: 0, stored: 0 };
    return ingestLaunch(mergeLaunchBatch(req.body as any), reply, req.rawBody, req.log);
  });

  /** Bundle detection: wallets funded by one source shortly before a launch (and new wallets of known bundlers). */
  app.get('/bundles', async () => ({ flags: listBundleFlags(o.db), funders: listBundleFunders(o.db) }));

  /** Fairway Check (M18): public fairness reports. `source` says whether the data is live (Stream) or synthetic fixtures. */
  const source = o.mode === 'live' ? 'live' : 'simulated';
  const validId = (x: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
  app.get('/check/token/:mint', async (req, reply) => {
    const { mint } = req.params as { mint: string };
    if (!validId(mint)) return reply.code(400).send({ error: 'Not a Solana address' });
    return { source, ...checkTokenFromDb(o.db, mint) };
  });
  app.get('/check/wallet/:address', async (req, reply) => {
    const { address } = req.params as { address: string };
    if (!validId(address)) return reply.code(400).send({ error: 'Not a Solana address' });
    return { source, ...checkWalletFromDb(o.db, address) };
  });
  app.get('/check/tokens', async (req) => {
    const q = req.query as { limit?: string };
    return { source, tokens: listTokenChecks(o.db, Math.min(400, Math.max(1, Number(q.limit) || 12))) };
  });

  /** Cross-launch sniper scores (bootstrap TOXIC from Pump.fun history). */
  app.get('/snipers', async (req) => {
    const q = req.query as { tier?: Tier; limit?: string };
    return listSnipers(o.db, { tier: q.tier, limit: q.limit ? Number(q.limit) : undefined });
  });

  app.post('/recompute', async (req) => {
    const body = (req.body ?? {}) as { traders?: string[] };
    const traders = Array.isArray(body.traders) ? body.traders.filter((t) => typeof t === 'string') : undefined;
    return recompute(o.db, o.mids, traders, cfg);
  });

  app.get('/wallet/:address', async (req, reply) => {
    const { address } = req.params as { address: string };
    const score = getScore(o.db, address);
    const trades = tradesWithMarkouts(o.db, address, o.mids, cfg);
    if (!score && trades.length === 0) {
      return reply.send({
        address,
        known: false,
        tier: 'STANDARD' as Tier,
        explanation: explainTier(undefined, cfg),
        score: null,
        trades: [],
        timeline: [],
        label: o.labels?.[address] ?? null,
        sniper: getSniper(o.db, address),
      });
    }
    const tierIn = score ? { scoreBps: score.scoreBps, maxScoreBps: score.maxScoreBps, trades: score.byHorizon[cfg.primaryHorizon]?.scoredTrades ?? score.trades, historyDays: score.historyDays } : undefined;
    return {
      address,
      known: true,
      tier: score?.tier ?? 'STANDARD',
      explanation: explainTier(tierIn, cfg),
      score,
      trades,
      timeline: tierTimeline(trades, cfg),
      label: o.labels?.[address] ?? null,
      sniper: getSniper(o.db, address),
      config: { horizons: cfg.horizons, primaryHorizon: cfg.primaryHorizon, priorNotional: cfg.priorNotional, toxicScoreBps: cfg.toxicScoreBps, retailScoreBps: cfg.retailScoreBps, minTrades: cfg.retailMinTrades, retailMinHistoryDays: cfg.retailMinHistoryDays },
    };
  });

  app.get('/wallets', async (req) => {
    const q = req.query as { tier?: Tier; limit?: string; offset?: string };
    return listScores(o.db, { tier: q.tier, limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined });
  });

  app.get('/pool/:id/stats', async (req, reply) => {
    const { id } = req.params as { id: string };
    const swaps = swapsOfPool(o.db, id);
    if (!swaps.length) return reply.code(404).send({ error: 'unknown pool or no swaps yet', pool: id });
    const tierOf = new Map(listScores(o.db, { limit: 10_000 }).map((s) => [s.trader, s.tier]));
    const zero = () => ({ RETAIL: 0, STANDARD: 0, TOXIC: 0 }) as Record<Tier, number>;
    const volumeByTier = zero();
    const feesByTier = zero();
    const tradesByTier = zero();
    const traders = new Set<string>();
    for (const s of swaps) {
      // tier: what the trade paid (Fairway event) or the wallet's current tier
      const t = s.tier ?? tierOf.get(s.trader) ?? 'STANDARD';
      volumeByTier[t] += s.quoteAmount;
      feesByTier[t] += (s.quoteAmount * (s.feeBps ?? 0)) / 10_000;
      tradesByTier[t] += 1;
      traders.add(s.trader);
    }
    const last = swaps[swaps.length - 1]!;
    return {
      pool: id,
      venue: last.venue,
      trades: swaps.length,
      uniqueTraders: traders.size,
      volumeUsd: swaps.reduce((a, s) => a + s.quoteAmount, 0),
      volumeByTier,
      feesByTier,
      tradesByTier,
      lastPrice: last.execPrice,
      firstTs: swaps[0]!.ts,
      lastTs: last.ts,
    };
  });

  /** All stored swaps as JSON lines (for historical replay). */
  app.get('/export.jsonl', async (_req, reply) => {
    reply.header('content-type', 'application/x-ndjson');
    return allSwaps(o.db)
      .map((s) => JSON.stringify(s))
      .join('\n');
  });

  return app;
}
