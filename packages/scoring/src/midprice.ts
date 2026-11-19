import type { Swap } from './types';

/**
 * Source of "true" mid prices used to evaluate markouts.
 * Synchronous on purpose: async sources (Pyth) preload a window, then answer from cache.
 */
export interface MidPriceProvider {
  readonly name: string;
  /** Mid price (quote per base) at unix time `ts` for `pool`, or undefined if unknown. */
  midAt(ts: number, pool?: string): number | undefined;
}

/** Step-function lookup over a sorted [ts, price] series: last observation at or before ts. */
export class SeriesMidPrice implements MidPriceProvider {
  readonly name: string;
  private readonly ts: Float64Array;
  private readonly px: Float64Array;
  /** observations older than this (seconds) are considered unknown */
  private readonly maxStaleSec: number;

  constructor(points: ReadonlyArray<readonly [number, number]>, opts: { name?: string; maxStaleSec?: number } = {}) {
    const sorted = [...points].filter((p) => Number.isFinite(p[0]) && p[1] > 0).sort((a, b) => a[0] - b[0]);
    this.ts = Float64Array.from(sorted.map((p) => p[0]));
    this.px = Float64Array.from(sorted.map((p) => p[1]));
    this.name = opts.name ?? 'series';
    this.maxStaleSec = opts.maxStaleSec ?? Infinity;
  }

  get size(): number {
    return this.ts.length;
  }

  midAt(ts: number): number | undefined {
    const n = this.ts.length;
    if (n === 0 || ts < this.ts[0]!) return undefined;
    // the series must extend to (at least) ts, otherwise we would extrapolate into the unknown future
    if (ts > this.ts[n - 1]! + 1e-9 && ts - this.ts[n - 1]! > this.maxStaleSec) return undefined;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.ts[mid]! <= ts) lo = mid;
      else hi = mid - 1;
    }
    if (ts - this.ts[lo]! > this.maxStaleSec) return undefined;
    return this.px[lo];
  }
}

/** Mid from the simulated CEX path (fixtures / simulator). Exact series, no staleness allowance needed. */
export class FixtureMidPrice extends SeriesMidPrice {
  constructor(path: ReadonlyArray<readonly [number, number]>, maxStaleSec = 5) {
    super(path, { name: 'fixture-cex', maxStaleSec });
  }
}

/**
 * Mid implied by the stream itself: last traded price (or reserve ratio snapshot) of a pool.
 * Per-pool series. Useful when no external oracle is available (e.g. pure Streams backfill).
 */
export class PoolImpliedMidPrice implements MidPriceProvider {
  readonly name = 'pool-implied';
  private readonly byPool = new Map<string, SeriesMidPrice>();

  constructor(
    swaps: ReadonlyArray<Pick<Swap, 'ts' | 'pool' | 'execPrice'>>,
    opts: { maxStaleSec?: number; reserveSnapshots?: ReadonlyArray<{ ts: number; pool: string; base: number; quote: number }> } = {},
  ) {
    const pts = new Map<string, Array<[number, number]>>();
    const push = (pool: string, ts: number, px: number) => {
      if (!pts.has(pool)) pts.set(pool, []);
      pts.get(pool)!.push([ts, px]);
    };
    for (const s of swaps) push(s.pool, s.ts, s.execPrice);
    for (const r of opts.reserveSnapshots ?? []) if (r.base > 0) push(r.pool, r.ts, r.quote / r.base);
    for (const [pool, p] of pts) this.byPool.set(pool, new SeriesMidPrice(p, { name: pool, maxStaleSec: opts.maxStaleSec ?? 600 }));
  }

  midAt(ts: number, pool?: string): number | undefined {
    if (pool !== undefined) return this.byPool.get(pool)?.midAt(ts);
    // no pool given: use the first (only) pool if unambiguous
    if (this.byPool.size === 1) return [...this.byPool.values()][0]!.midAt(ts);
    return undefined;
  }
}

/**
 * Pyth price feed provider (STUB).
 * TODO(live): implement `load()` against Pyth Hermes (`GET /v2/updates/price/{publish_time}` or the
 * benchmarks API) to fill the cache for a time window, e.g. SOL/USD feed
 * 0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d. Until then it returns undefined,
 * which the scorer treats as "no markout available" — it never breaks the build or the pipeline.
 */
export class PythMidPrice implements MidPriceProvider {
  readonly name = 'pyth';
  private cache: SeriesMidPrice = new SeriesMidPrice([]);

  constructor(readonly opts: { hermesUrl?: string; feedId?: string } = {}) {}

  /** Preload prices for [fromTs, toTs]. Stub: no network calls yet. */
  async load(_fromTs: number, _toTs: number): Promise<number> {
    return 0;
  }

  /** Allows tests / callers to inject already-fetched points. */
  seed(points: ReadonlyArray<readonly [number, number]>): void {
    this.cache = new SeriesMidPrice(points, { name: 'pyth', maxStaleSec: 10 });
  }

  midAt(ts: number): number | undefined {
    return this.cache.midAt(ts);
  }
}
