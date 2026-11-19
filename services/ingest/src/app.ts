import { gunzipSync } from 'node:zlib';
import Fastify, { type FastifyInstance } from 'fastify';
import { explainTier, makeConfig, type ScoringConfig, type Swap, type Tier } from '@fairway/scoring';
import { parsePayload, parsePumpPayload, type LaunchTradeRecord, type ParserPool } from '@fairway/parser';
import { verifyDelivery } from './auth';
import { allSwaps, countSwaps, getScore, lastDeliveries, listScores, logDelivery, maxTs, swapsOfPool, tierCounts, upsertSwaps, validSwap, type Db } from './db';
import { getSniper, listSnipers, recomputeSnipers, upsertLaunchTrades, validLaunchTrade } from './launches';
import { recompute, tierTimeline, tradesWithMarkouts, type MidSource } from './recompute';

export type AppOptions = {
  db: Db;
  pools: ParserPool[];
  mids: MidSource;
  token?: string;
  mode: 'fixture' | 'live';
  /** recompute affected wallets right after each delivery (default true) */
  recomputeOnIngest?: boolean;
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

export function buildApp(o: AppOptions): FastifyInstance {
  const app = Fastify({ logger: o.logger ?? false, bodyLimit: 64 * 1024 * 1024 });
  const cfg = o.scoring ?? makeConfig();

  // keep the raw (decompressed) body for HMAC verification
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(['application/json', 'text/plain', 'application/octet-stream'], { parseAs: 'buffer' }, (req, body: Buffer, done) => {
    try {
      const enc = String(req.headers['content-encoding'] ?? '');
      const isGzip = enc.includes('gzip') || (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b);
      const text = (isGzip ? gunzipSync(body) : body).toString('utf8');
      req.rawBody = text;
      done(null, text.length ? JSON.parse(text) : {});
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      err.statusCode = 400;
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
    recentDeliveries: lastDeliveries(o.db, 5),
  }));

  /** QuickNode Streams webhook. Accepts filter output `{swaps:[...]}` or raw blocks (parsed server-side). */
  app.post('/streams/solana', async (req, reply) => {
    const auth = verifyDelivery(o.token, req.headers, req.rawBody ?? '');
    if (!auth.ok) return reply.code(401).send({ error: auth.reason });
    const body = req.body as any;
    let kind: 'filtered' | 'raw-blocks';
    let incoming: Array<Swap & { source?: string }>;
    if (body && Array.isArray(body.swaps)) {
      kind = 'filtered';
      incoming = body.swaps;
    } else {
      kind = 'raw-blocks';
      incoming = parsePayload(body, o.pools);
    }
    const valid = incoming.filter(validSwap);
    const { stored, traders } = upsertSwaps(o.db, valid);
    logDelivery(o.db, kind, incoming.length, stored);
    let recomputed = 0;
    if ((o.recomputeOnIngest ?? true) && traders.length) recomputed = recompute(o.db, o.mids, traders, cfg).wallets;
    req.log.info({ kind, received: incoming.length, stored, recomputed }, `stored ${stored} swaps`);
    return { ok: true, kind, received: incoming.length, invalid: incoming.length - valid.length, stored, recomputed };
  });

  /** QuickNode Streams webhook for launches: streams/pumpfun-filter.js output `{launchTrades:[...]}` or raw blocks. */
  app.post('/streams/pumpfun', async (req, reply) => {
    const auth = verifyDelivery(o.token, req.headers, req.rawBody ?? '');
    if (!auth.ok) return reply.code(401).send({ error: auth.reason });
    const body = req.body as any;
    const kind = body && Array.isArray(body.launchTrades) ? 'filtered' : 'raw-blocks';
    const incoming: LaunchTradeRecord[] = kind === 'filtered' ? body.launchTrades : parsePumpPayload(body);
    const valid = incoming.filter(validLaunchTrade);
    const stored = upsertLaunchTrades(o.db, valid);
    logDelivery(o.db, `launch-${kind}`, incoming.length, stored);
    const snipers = stored ? recomputeSnipers(o.db) : null;
    return { ok: true, kind, received: incoming.length, invalid: incoming.length - valid.length, stored, snipers };
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
