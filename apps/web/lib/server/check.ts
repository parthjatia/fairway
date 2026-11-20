import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseFundingPayload, parsePumpPayload } from '@fairway/parser';
import { checkContextFrom, checkToken, checkWallet, detectBundles, listChecks, type CheckContext, type LaunchTrade, type TokenCheck, type WalletCheck } from '@fairway/scoring';

export type CheckSource = 'live' | 'simulated';
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

/** Live mode: the ingest service (filled by a QuickNode Stream) answers. Simulated mode: computed from fixtures here. */
async function ingest<T>(path: string): Promise<CheckResult<T> | null> {
  const base = process.env.INGEST_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/check${path}`, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
    return { status: res.status, body: (await res.json()) as T & { source: CheckSource } };
  } catch {
    return { status: 502, body: { error: 'The live data service is not reachable right now. Try again in a moment.' } };
  }
}

export type NamedToken = TokenCheck & { name?: string };

export async function tokenCheck(mint: string): Promise<CheckResult<NamedToken>> {
  if (!isAddress(mint)) return { status: 400, body: { error: 'That does not look like a Solana address.' } };
  const live = await ingest<NamedToken>(`/token/${mint}`);
  if (live) return live;
  const { trades, ctx, names } = fixtures();
  return { status: 200, body: { source: 'simulated', name: names[mint], ...checkToken(trades, mint, ctx) } };
}

export async function walletCheck(address: string): Promise<CheckResult<WalletCheck>> {
  if (!isAddress(address)) return { status: 400, body: { error: 'That does not look like a Solana address.' } };
  const live = await ingest<WalletCheck>(`/wallet/${address}`);
  if (live) return live;
  const { trades, ctx } = fixtures();
  return { status: 200, body: { source: 'simulated', ...checkWallet(trades, address, ctx) } };
}

export async function tokenList(limit = 12): Promise<CheckResult<{ tokens: NamedToken[] }>> {
  const live = await ingest<{ tokens: NamedToken[] }>(`/tokens?limit=${limit}`);
  if (live) return live;
  const { trades, ctx, names } = fixtures();
  return { status: 200, body: { source: 'simulated', tokens: listChecks(trades, ctx).slice(0, limit).map((t) => ({ ...t, name: names[t.mint] })) } };
}
