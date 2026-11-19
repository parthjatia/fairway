import { createHmac, timingSafeEqual } from 'node:crypto';

export type AuthResult = { ok: true; method: 'none' | 'qn-signature' | 'token' } | { ok: false; reason: string };

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Verify a Streams delivery.
 *  - No token configured → accept (local / fixture mode).
 *  - `x-qn-signature` present → hex(HMAC-SHA256(token, nonce + timestamp + body)) must match.
 *  - `x-fairway-token` (or `x-qn-api-key`) header equal to the token → accept (curl / custom header).
 */
export function verifyDelivery(token: string | undefined, headers: Record<string, string | string[] | undefined>, rawBody: string): AuthResult {
  if (!token) return { ok: true, method: 'none' };
  const h = (k: string) => {
    const v = headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const sig = h('x-qn-signature');
  if (sig) {
    const nonce = h('x-qn-nonce') ?? '';
    const ts = h('x-qn-timestamp') ?? '';
    const expected = createHmac('sha256', token).update(nonce + ts + rawBody).digest('hex');
    return safeEq(sig.toLowerCase(), expected) ? { ok: true, method: 'qn-signature' } : { ok: false, reason: 'bad signature' };
  }
  const t = h('x-fairway-token') ?? h('x-qn-api-key');
  if (t && safeEq(t, token)) return { ok: true, method: 'token' };
  return { ok: false, reason: 'missing or invalid token' };
}

export const signForTest = (token: string, nonce: string, ts: string, body: string) => createHmac('sha256', token).update(nonce + ts + body).digest('hex');
