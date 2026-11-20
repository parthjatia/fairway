import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseFundingPayload, parsePumpPayload } from '@fairway/parser';
import { fairwayToken } from './fairway';
import { metaOf } from '../registry';
import { withTokenMeta } from './token-meta';
import { checkContextFrom, checkToken, checkWallet, detectBundles, listChecks, type CheckContext, type LaunchTrade, type TokenCheck, type WalletCheck } from '@fairway/scoring';

export type CheckSource = 'live' | 'simulated' | 'devnet';
const isAddress = (x: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);

function repoRoot(): string {
  let d = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(d, 'pnpm-workspace.yaml'))) return d;
    d = dirname(d);
  }
  return join(process.cwd(), '..', '..');
}
const readJson = <T>(...p: string[]): T => JSON.parse(readFileSync(join(/*turbopackIgnore: true*/ repoRoot(), ...p), 'utf8')) as T;

let cache: { trades: LaunchTrade[]; ctx: CheckContext; names: Record<string, string> } | null = null;
/** Simulated data: the same synthetic fixtures the ingest service seeds in fixture mode (Pump.fun blocks, bundle blocks, check launches). */
function fixtures() {
  if (cache) return cache;
  const pump = readJson<{ blocks: unknown[] }>('packages', 'fixtures', 'data', 'pumpfun.json');
  const bundles = readJson<{ blocks: unknown[] }>('packages', 'fixtures', 'data', 'bundles.json');
  const checks = readJson<{ meta: { tokens: { mint: string; name: string }[] }; trades: { sig: string; slot: number; mint: string; trader: string; kind: LaunchTrade['kind']; tokenAmount: number; solAmount: number; price: number }[] }>('packages', 'fixtures', 'data', 'checks.json');
  const trades: LaunchTrade[] = [...parsePumpPayload(pump.blocks), ...parsePumpPayload(bundles.blocks), ...checks.trades].map((t) => ({
    sig: t.sig, slot: t.slot, mint: t.mint, trader: t.trader, kind: t.kind, tokenAmount: t.tokenAmount, solAmount: t.solAmount, price: t.price,
  }));
  const report = detectBundles(trades, parseFundingPayload(bundles.blocks));
  const known = new Set(report.funders.filter((f) => f.knownBundler).map((f) => f.funder));
  const bundled = report.flags.filter((f) => known.has(f.funder)).map((f) => f.wallet);
  cache = { trades, ctx: checkContextFrom(trades, bundled), names: Object.fromEntries(checks.meta.tokens.map((t) => [t.mint, t.name])) };
  return cache;
}

export type CheckResult<T> = { status: number; body: (T & { source: CheckSource }) | { error: string } };

/** Real data: the ingest service (filled by a QuickNode Stream). Returns null when INGEST_URL is unset or the service answers with fixtures. */
async function ingest<T>(path: string): Promise<CheckResult<T> | null> {
  const base = process.env.INGEST_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/check${path}`, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
    const body = (await res.json()) as T & { source: CheckSource };
    if (res.ok && body.source !== 'live') return null; // a fixture-mode ingest is not real data
    return { status: res.status, body };
  } catch {
    return null;
  }
}

/** Real mainnet snapshot exported from a live ingest DB (scripts/snapshot-real.ts). Absent until the Stream has run. */
export type Snapshot = { source: 'live'; updatedAt: number; slot: number; tokens: NamedToken[]; wallets?: Record<string, WalletCheck> };
export function snapshot(): Snapshot | null {
  const p = join(/*turbopackIgnore: true*/ repoRoot(), 'apps', 'web', 'data', 'real-snapshot.json');
  if (!existsSync(p)) return null;
  try {
    const s = JSON.parse(readFileSync(p, 'utf8')) as Snapshot;
    return s.source === 'live' && Array.isArray(s.tokens) ? s : null;
  } catch {
    return null;
  }
}

export type NamedToken = TokenCheck & { name?: string; symbol?: string; image?: string | null };
const notFound = <T>(): CheckResult<T> => ({ status: 200, body: { found: false } as never });

/**
 * Default (real data only): a Fairway pool on devnet → report from its swaps; else the live ingest; else the real snapshot.
 * `demo` (hidden ?demo=1): the synthetic fixtures, labelled "Simulated data".
 */
export async function tokenCheck(mint: string, demo = false): Promise<CheckResult<NamedToken>> {
  if (!isAddress(mint)) return { status: 400, body: { error: 'That does not look like a Solana address.' } };
  if (demo) {
    const { trades, ctx, names } = fixtures();
    return { status: 200, body: { source: 'simulated', name: names[mint], ...checkToken(trades, mint, ctx) } };
  }
  const fw = await fairwayToken(mint).catch(() => null);
  if (fw) return { status: 200, body: { source: 'devnet', name: `${metaOf(mint).name}`, ...fw.token.check, found: true } };
  const live = await ingest<NamedToken>(`/token/${mint}`);
  if (live) {
    if (live.status === 200 && 'found' in live.body && live.body.found) {
      const [named] = await withTokenMeta([live.body as NamedToken & { source: CheckSource }]);
      return { status: 200, body: named! };
    }
    return live;
  }
  const t = snapshot()?.tokens.find((x) => x.mint === mint);
  if (t) return { status: 200, body: { source: 'live', ...(await withTokenMeta([t]))[0]! } };
  return notFound();
}

export async function walletCheck(address: string, demo = false): Promise<CheckResult<WalletCheck>> {
  if (!isAddress(address)) return { status: 400, body: { error: 'That does not look like a Solana address.' } };
  if (demo) {
    const { trades, ctx } = fixtures();
    return { status: 200, body: { source: 'simulated', ...checkWallet(trades, address, ctx) } };
  }
  const live = await ingest<WalletCheck>(`/wallet/${address}`);
  if (live) return live;
  const w = snapshot()?.wallets?.[address];
  if (w) return { status: 200, body: { source: 'live', ...w } };
  return notFound();
}

/** Real Pump.fun launches: live ingest first, then the snapshot. `updatedAt`/`slot` let the UI show the age of each launch. */
export async function pumpTokens(limit = 50): Promise<{ source: 'live'; via: 'ingest' | 'snapshot'; updatedAt: number; slot: number | null; tokens: NamedToken[] } | null> {
  const live = await ingest<{ tokens: NamedToken[] }>(`/tokens?limit=${limit}`);
  if (live && live.status === 200 && 'tokens' in live.body) {
    const slot = await mainnetSlot();
    return { source: 'live', via: 'ingest', updatedAt: Math.floor(Date.now() / 1000), slot, tokens: await withTokenMeta(live.body.tokens) };
  }
  const s = snapshot();
  return s ? { source: 'live', via: 'snapshot', updatedAt: s.updatedAt, slot: s.slot, tokens: await withTokenMeta(s.tokens.slice(0, limit)) } : null;
}

async function mainnetSlot(): Promise<number | null> {
  try {
    const res = await fetch(process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot' }), signal: AbortSignal.timeout(4_000), cache: 'no-store',
    });
    return ((await res.json()) as { result?: number }).result ?? null;
  } catch {
    return null;
  }
}

export async function tokenList(limit = 12, demo = false): Promise<CheckResult<{ tokens: NamedToken[] }>> {
  if (demo) {
    const { trades, ctx, names } = fixtures();
    return { status: 200, body: { source: 'simulated', tokens: listChecks(trades, ctx).slice(0, limit).map((t) => ({ ...t, name: names[t.mint] })) } };
  }
  const p = await pumpTokens(limit);
  return { status: 200, body: { source: 'live', tokens: p?.tokens ?? [] } };
}
