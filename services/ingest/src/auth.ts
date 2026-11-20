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
 *  - `x-fairway-token` (or `x-qn-api-key`) header equal to the token → accept (custom header set on the Stream destination).
 *  - else `x-qn-signature` → hex(HMAC-SHA256(token, nonce + timestamp + body)) must match (Stream security token = QN_STREAM_TOKEN).
 */
export function verifyDelivery(token: string | undefined, headers: Record<string, string | string[] | undefined>, rawBody: string): AuthResult {
  if (!token) return { ok: true, method: 'none' };
  const h = (k: string) => {
    const v = headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  // the custom header wins: QuickNode signs every delivery with the Stream's OWN security token, which need not equal ours,
  // so a valid x-fairway-token must not be rejected because an unrelated x-qn-signature does not verify
  const t = h('x-fairway-token') ?? h('x-qn-api-key');
  if (t && safeEq(t, token)) return { ok: true, method: 'token' };
  const sig = h('x-qn-signature');
  if (sig) {
    const nonce = h('x-qn-nonce') ?? '';
    const ts = h('x-qn-timestamp') ?? '';
    const expected = createHmac('sha256', token).update(nonce + ts + rawBody).digest('hex');
    if (safeEq(sig.toLowerCase(), expected)) return { ok: true, method: 'qn-signature' };
    return { ok: false, reason: t ? 'x-fairway-token does not match QN_STREAM_TOKEN (and x-qn-signature does not verify with it)' : 'x-qn-signature does not verify with QN_STREAM_TOKEN and no x-fairway-token header was sent' };
  }
  return { ok: false, reason: t ? 'x-fairway-token does not match QN_STREAM_TOKEN' : 'no x-fairway-token header (and no x-qn-signature)' };
}

export const signForTest = (token: string, nonce: string, ts: string, body: string) => createHmac('sha256', token).update(nonce + ts + body).digest('hex');
