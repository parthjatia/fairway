import 'server-only';
// Name / symbol / image for real mainnet (Pump.fun) mints, read from chain through the mainnet RPC (MAINNET_RPC_URL, the
// QuickNode endpoint; server-only, never NEXT_PUBLIC_). Results are cached per process by the SDK; misses fall back to a short mint.
import { Connection } from '@solana/web3.js';
import { fetchTokenMetadata, tokenLabel } from '@fairway/sdk';

const RPC = process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com';
let conn: Connection | null = null;

export type WithMeta = { mint: string; name?: string; symbol?: string; image?: string | null };

/** Fills name/symbol/image on tokens that do not have them yet (snapshot rows already carry them). Never throws. */
export async function withTokenMeta<T extends WithMeta>(tokens: T[]): Promise<T[]> {
  const missing = tokens.filter((t) => !t.symbol).map((t) => t.mint);
  let meta = new Map<string, Awaited<ReturnType<typeof fetchTokenMetadata>> extends Map<string, infer V> ? V : never>();
  if (missing.length) {
    try {
      conn ??= new Connection(RPC, 'confirmed');
      meta = await fetchTokenMetadata(conn, missing, { imageTimeoutMs: 2_500 });
    } catch {
      /* RPC down: fall back to short mints */
    }
  }
  return tokens.map((t) => {
    if (t.symbol) return t;
    const m = meta.get(t.mint) ?? null;
    const l = tokenLabel(t.mint, m);
    return { ...t, name: m ? l.name : t.name ?? l.name, symbol: l.symbol, image: m?.image ?? null };
  });
}
