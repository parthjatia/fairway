import { describe, expect, it } from 'vitest';
import { CheckError, checkToken, checkWallet, listChecks } from '../src';

const fake = (status: number, body: unknown, seen: string[] = []) =>
  (async (url: string) => {
    seen.push(url);
    return { ok: status < 400, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;

describe('check client', () => {
  it('checkToken calls /api/check/token/:mint by default and returns the typed report', async () => {
    const seen: string[] = [];
    const r = await checkToken(' MintAddr ', { fetch: fake(200, { source: 'simulated', grade: 'High', verdict: 'x' }, seen) });
    expect(seen).toEqual(['/api/check/token/MintAddr']);
    expect(r.grade).toBe('High');
    expect(r.source).toBe('simulated');
  });
  it('baseUrl points it at the ingest service', async () => {
    const seen: string[] = [];
    await checkWallet('W', { baseUrl: 'https://ingest.example.com/check/', fetch: fake(200, { source: 'live' }, seen) });
    expect(seen).toEqual(['https://ingest.example.com/check/wallet/W']);
  });
  it('list passes the limit; errors carry the API message and status', async () => {
    const seen: string[] = [];
    await listChecks({ limit: 5, fetch: fake(200, { source: 'live', tokens: [] }, seen) });
    expect(seen).toEqual(['/api/check/tokens?limit=5']);
    const err = await checkToken('x', { fetch: fake(400, { error: 'That does not look like a Solana address.' }) }).catch((e) => e);
    expect(err).toBeInstanceOf(CheckError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('That does not look like a Solana address.');
  });
});
