/**
 * Fairway Check client (M18): who bought a token early, and is this wallet a sniper? Thin typed wrappers over the
 * check API, which is served by the web app (`/api/check`) or directly by the ingest service (`<ingest>/check`).
 *
 *   const r = await checkToken('<mint>');                    // same-origin web app
 *   const r = await checkToken('<mint>', { baseUrl: 'https://ingest.example.com/check' });
 *   r.grade === 'High' && r.verdict                           // "High risk: snipers bought 38% of early supply ..."
 *
 * `source` tells you whether the data is 'live' (a QuickNode Stream filled the ingest DB) or 'simulated' (synthetic fixtures).
 */
import type { TokenCheck, WalletCheck } from '@fairway/scoring';

export type { CheckBuyer, RiskGrade, TokenCheck, WalletCheck } from '@fairway/scoring';
export type CheckSource = 'live' | 'simulated';
export type TokenCheckResponse = TokenCheck & { source: CheckSource };
export type WalletCheckResponse = WalletCheck & { source: CheckSource };
export type TokenListResponse = { source: CheckSource; tokens: TokenCheck[] };

export type CheckClientOptions = {
  /** Root of the check API. Default `/api/check` (the web app). The ingest service serves the same routes at `<ingest>/check`. */
  baseUrl?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
};

export class CheckError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CheckError';
  }
}

async function get<T>(path: string, o: CheckClientOptions): Promise<T> {
  const f = o.fetch ?? fetch;
  const res = await f(`${(o.baseUrl ?? '/api/check').replace(/\/$/, '')}${path}`, { signal: o.signal, headers: { accept: 'application/json' } });
  if (!res.ok) {
    let msg = `Check API returned ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* keep the default message */
    }
    throw new CheckError(msg, res.status);
  }
  return (await res.json()) as T;
}

/** Fairness report for a token: sniper share of early supply, fresh-wallet share, dumped-already, grade, top early buyers. */
export function checkToken(mint: string, o: CheckClientOptions = {}): Promise<TokenCheckResponse> {
  return get(`/token/${encodeURIComponent(mint.trim())}`, o);
}

/** Wallet report: tier, launches participated in, first-block buys, average markout. */
export function checkWallet(address: string, o: CheckClientOptions = {}): Promise<WalletCheckResponse> {
  return get(`/wallet/${encodeURIComponent(address.trim())}`, o);
}

/** The most recent tokens with their grade. */
export function listChecks(o: CheckClientOptions & { limit?: number } = {}): Promise<TokenListResponse> {
  return get(`/tokens${o.limit ? `?limit=${o.limit}` : ''}`, o);
}
