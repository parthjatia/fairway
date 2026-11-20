// Token name / symbol / image for any SPL mint, read from chain:
//  1. Metaplex Token Metadata account (PDA ["metadata", program, mint]) — what Pump.fun's classic create writes;
//  2. Token-2022 TokenMetadata extension on the mint itself — what newer Token-2022 launches use.
// The image lives in the off-chain JSON at `uri`; it is fetched with a short timeout and is optional.
import { Connection, PublicKey } from '@solana/web3.js';

export const METAPLEX_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
export const TOKEN_2022_PROGRAM_ID_STR = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export type TokenMetadata = { mint: string; name: string; symbol: string; uri: string; image: string | null; source: 'metaplex' | 'token-2022' };

const clean = (s: string) => s.replace(/\0/g, '').trim();
const dec = new TextDecoder();

export const metadataPda = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([new TextEncoder().encode('metadata'), METAPLEX_METADATA_PROGRAM_ID.toBytes(), mint.toBytes()], METAPLEX_METADATA_PROGRAM_ID)[0];

function borshString(d: Uint8Array, o: number): [string, number] {
  if (o + 4 > d.length) throw new Error('truncated');
  const len = new DataView(d.buffer, d.byteOffset + o, 4).getUint32(0, true);
  if (len > 1_000 || o + 4 + len > d.length) throw new Error('bad string length');
  return [clean(dec.decode(d.subarray(o + 4, o + 4 + len))), o + 4 + len];
}

/** Metaplex `Metadata` v1 layout: key u8, update_authority [32], mint [32], name, symbol, uri (borsh strings). */
export function parseMetaplexMetadata(data: Uint8Array): { name: string; symbol: string; uri: string } | null {
  try {
    if (data.length < 69 || data[0] !== 4) return null; // Key::MetadataV1 = 4
    const [name, a] = borshString(data, 65);
    const [symbol, b] = borshString(data, a);
    const [uri] = borshString(data, b);
    return { name, symbol, uri };
  } catch {
    return null;
  }
}

/** Token-2022 mint with extensions: base mint (82) + padding to 165 + account type (1) + TLV entries; TokenMetadata is type 19. */
export function parseToken2022Metadata(data: Uint8Array): { name: string; symbol: string; uri: string } | null {
  try {
    if (data.length <= 166) return null;
    let o = 166;
    const dv = new DataView(data.buffer, data.byteOffset, data.length);
    while (o + 4 <= data.length) {
      const type = dv.getUint16(o, true);
      const len = dv.getUint16(o + 2, true);
      if (type === 19) {
        // update_authority [32], mint [32], name, symbol, uri, additional_metadata
        const [name, a] = borshString(data, o + 4 + 64);
        const [symbol, b] = borshString(data, a);
        const [uri] = borshString(data, b);
        return { name, symbol, uri };
      }
      if (type === 0 && len === 0) break;
      o += 4 + len;
    }
    return null;
  } catch {
    return null;
  }
}

/** ipfs:// and ar:// to HTTP gateways; only http(s) results are returned. */
export function gatewayUrl(u: string): string | null {
  const s = u.trim();
  if (s.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${s.slice(7).replace(/^ipfs\//, '')}`;
  if (s.startsWith('ar://')) return `https://arweave.net/${s.slice(5)}`;
  return /^https?:\/\//.test(s) ? s : null;
}

async function imageOf(uri: string, timeoutMs: number): Promise<string | null> {
  const url = gatewayUrl(uri);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    if ((res.headers.get('content-type') ?? '').startsWith('image/')) return url; // the uri is the image itself
    const j = (await res.json()) as { image?: unknown };
    return typeof j.image === 'string' ? gatewayUrl(j.image) : null;
  } catch {
    return null;
  }
}

const cache = new Map<string, TokenMetadata | null>();

/**
 * Metadata for many mints in two getMultipleAccounts round trips (chunks of 100), cached per process (misses too).
 * Mints without metadata map to null: callers fall back to a shortened address.
 */
export async function fetchTokenMetadata(
  connection: Connection,
  mints: readonly string[],
  opts: { images?: boolean; imageTimeoutMs?: number; concurrency?: number } = {},
): Promise<Map<string, TokenMetadata | null>> {
  const out = new Map<string, TokenMetadata | null>();
  const todo = [...new Set(mints)].filter((m) => {
    if (cache.has(m)) {
      out.set(m, cache.get(m)!);
      return false;
    }
    try {
      new PublicKey(m);
      return true;
    } catch {
      out.set(m, null);
      return false;
    }
  });
  for (let i = 0; i < todo.length; i += 100) {
    const part = todo.slice(i, i + 100);
    const keys = part.map((m) => new PublicKey(m));
    const [metas, mintsInfo] = await Promise.all([connection.getMultipleAccountsInfo(keys.map(metadataPda)), connection.getMultipleAccountsInfo(keys)]);
    part.forEach((m, j) => {
      const mp = metas[j] && metas[j]!.owner.equals(METAPLEX_METADATA_PROGRAM_ID) ? parseMetaplexMetadata(metas[j]!.data) : null;
      const t22 = !mp && mintsInfo[j]?.owner.toBase58() === TOKEN_2022_PROGRAM_ID_STR ? parseToken2022Metadata(mintsInfo[j]!.data) : null;
      const r = mp ?? t22;
      out.set(m, r && (r.name || r.symbol) ? { mint: m, ...r, image: null, source: mp ? 'metaplex' : 'token-2022' } : null);
    });
  }
  if (opts.images !== false) {
    const withUri = todo.map((m) => out.get(m)).filter((x): x is TokenMetadata => !!x?.uri);
    const n = opts.concurrency ?? 8;
    for (let i = 0; i < withUri.length; i += n) {
      await Promise.all(withUri.slice(i, i + n).map(async (t) => (t.image = await imageOf(t.uri, opts.imageTimeoutMs ?? 4_000))));
    }
  }
  for (const m of todo) cache.set(m, out.get(m) ?? null);
  return out;
}

/** "Bonk (BONK)" style label; falls back to a shortened mint. */
export const tokenLabel = (mint: string, meta: Pick<TokenMetadata, 'name' | 'symbol'> | null | undefined) =>
  meta?.symbol || meta?.name ? { name: meta.name || meta.symbol, symbol: meta.symbol || meta.name.slice(0, 8) } : { name: `${mint.slice(0, 4)}…${mint.slice(-4)}`, symbol: mint.slice(0, 4) };
