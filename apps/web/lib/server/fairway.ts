import 'server-only';
// Real devnet data: every Fairway pool (getProgramAccounts), its reserves, launch phase, recent SwapExecuted events, and
// a Fairway Check report built from those swaps (TOXIC-tier buyers count as snipers). Cached briefly per process.
import { Connection, PublicKey } from '@solana/web3.js';
import { decodePool, discriminator, launchPhase, parseSwapEvents, PROGRAM_ID, TIER_NAMES, type PoolAccount } from '@fairway/sdk';
import { buildTokenCheck } from '@fairway/scoring';
import { metaOf } from '../registry';

export const RPC = process.env.RPC_URL || process.env.DEVNET_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
const conn = () => new Connection(RPC, 'confirmed');

import type { FwData, FwSwap, FwToken } from './fairway-types';
export type { FwData, FwSwap, FwToken };

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes: Uint8Array): string {
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = '1' + s;
  }
  return s;
}
const u64At = (d: Uint8Array, o: number) => Number(new DataView(d.buffer, d.byteOffset + o, 8).getBigUint64(0, true));

/** Transactions never change: cache their logs forever and fetch only new signatures, in small chunks (public RPCs rate-limit batches). */
const logCache = new Map<string, string[]>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function logsOf(c: Connection, sigs: string[]): Promise<string[][]> {
  const missing = sigs.filter((s) => !logCache.has(s));
  for (const sig of missing) {
    for (let attempt = 0; ; attempt++) {
      try {
        const tx = await c.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        if (tx) logCache.set(sig, tx.meta?.logMessages ?? []);
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        await sleep(600 * (attempt + 1));
      }
    }
  }
  return sigs.map((s) => logCache.get(s) ?? []);
}

async function poolDetail(c: Connection, address: PublicKey, p: PoolAccount, dec: Map<string, number>, vaults: Map<string, number>, slot: number): Promise<{ t: FwToken; swaps: FwSwap[] }> {
  const mint = p.baseMint.toBase58();
  const q = p.quoteMint.toBase58();
  const bd = dec.get(mint) ?? 6;
  const qd = dec.get(q) ?? 6;
  const rb = ((vaults.get(p.baseVault.toBase58()) ?? 0) - Number(p.protocolOwedBase + p.creatorFees.owedBase)) / 10 ** bd;
  const rq = ((vaults.get(p.quoteVault.toBase58()) ?? 0) - Number(p.protocolOwedQuote + p.creatorFees.owedQuote)) / 10 ** qd;
  const sigs = await c.getSignaturesForAddress(address, { limit: 60 }, 'confirmed');
  const ok = sigs.filter((s) => !s.err);
  const logs = await logsOf(c, ok.map((s) => s.signature));
  const swaps: FwSwap[] = [];
  logs.forEach((l, i) => {
    for (const e of parseSwapEvents(l)) {
      if (!e.pool.equals(address)) continue;
      const buy = !e.aToB;
      swaps.push({
        sig: ok[i]!.signature, slot: ok[i]!.slot, ts: ok[i]!.blockTime ?? null, trader: e.trader.toBase58(), side: buy ? 'buy' : 'sell',
        tokens: Number(buy ? e.amountOut : e.amountIn) / 10 ** bd, quote: Number(buy ? e.amountIn : e.amountOut) / 10 ** qd, feeBps: e.feeBps, tier: TIER_NAMES[e.tier] ?? 'STANDARD',
      });
    }
  });
  swaps.sort((a, b) => b.slot - a.slot);
  const oldest = sigs[sigs.length - 1];
  const isLaunch = p.launch.windowSlots > 0n;
  const launchSlot = isLaunch ? Number(p.launch.launchSlot) : swaps.length ? Math.min(...swaps.map((s) => s.slot)) : oldest?.slot ?? slot;
  const toxic = new Set(swaps.filter((s) => s.tier === 'TOXIC').map((s) => s.trader));
  const known = new Set(swaps.filter((s) => s.tier !== 'STANDARD').map((s) => s.trader));
  const check = buildTokenCheck({
    mint, launchSlot,
    trades: swaps.map((s) => ({ wallet: s.trader, slot: s.slot, kind: s.side, tokens: s.tokens, sol: s.quote })),
    tierOf: (w) => (toxic.has(w) ? 'TOXIC' : 'STANDARD'),
    hadHistory: (w) => known.has(w),
  });
  const ph = launchPhase(BigInt(slot), p.launch.launchSlot, p.launch.windowSlots);
  const meta = metaOf(mint);
  const createdTs = oldest?.blockTime ?? null;
  const t: FwToken = {
    mint, symbol: meta.symbol, name: meta.name, decimals: bd, pool: address.toBase58(), quoteMint: q, quoteSymbol: metaOf(q).symbol, quoteDecimals: qd,
    reserveBase: rb, reserveQuote: rq, price: rb > 0 ? rq / rb : 0, liquidityQuote: 2 * rq, createdTs, isLaunch,
    launch: isLaunch
      ? {
          launchSlot, windowSlots: Number(p.launch.windowSlots), phase: ph.kind,
          progressPct: ph.kind === 'window' ? Math.min(100, (Number(ph.elapsed) / Number(p.launch.windowSlots)) * 100) : ph.kind === 'after' ? 100 : 0,
          // the launch opens in the configure_launch tx, right after the pool is created: estimate from the slot gap
          launchTs: createdTs !== null && oldest ? createdTs + Math.max(0, launchSlot - oldest.slot) * 0.4 : null,
        }
      : null,
    swaps: swaps.length, check,
  };
  return { t, swaps };
}

type Cache = { at: number; data: FwData; swaps: Map<string, FwSwap[]> };
let cache: Cache | null = null;
let inflight: Promise<Cache> | null = null;

async function load(): Promise<Cache> {
  const c = conn();
  const [accs, slot] = await Promise.all([
    c.getProgramAccounts(PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: b58(discriminator('account', 'Pool')) } }] }),
    c.getSlot('confirmed'),
  ]);
  const pools = accs.flatMap((a) => {
    try {
      return [{ address: a.pubkey, p: decodePool(a.account.data) }];
    } catch {
      return [];
    }
  });
  const mints = [...new Set(pools.flatMap(({ p }) => [p.baseMint.toBase58(), p.quoteMint.toBase58()]))];
  const vaultKeys = pools.flatMap(({ p }) => [p.baseVault, p.quoteVault]);
  const [mintInfos, vaultInfos] = await Promise.all([
    mints.length ? c.getMultipleAccountsInfo(mints.map((m) => new PublicKey(m))) : [],
    vaultKeys.length ? c.getMultipleAccountsInfo(vaultKeys) : [],
  ]);
  const dec = new Map(mints.map((m, i) => [m, mintInfos[i]?.data[44] ?? 6]));
  const vaults = new Map(vaultKeys.map((v, i) => [v.toBase58(), vaultInfos[i] ? u64At(vaultInfos[i]!.data, 64) : 0]));
  const details = [];
  for (const { address, p } of pools) details.push(await poolDetail(c, address, p, dec, vaults, slot)); // sequential: public RPCs rate-limit
  const tokens = details.map((d) => d.t).sort((a, b) => (b.launch?.launchTs ?? b.createdTs ?? 0) - (a.launch?.launchTs ?? a.createdTs ?? 0));
  const quotes = [...new Set(pools.map(({ p }) => p.quoteMint.toBase58()))].map((m) => ({ mint: m, symbol: metaOf(m).symbol, decimals: dec.get(m) ?? 6 }));
  return { at: Date.now(), data: { slot, updatedAt: Math.floor(Date.now() / 1000), tokens, quotes }, swaps: new Map(details.map((d) => [d.t.mint, d.swaps])) };
}

async function get(): Promise<Cache> {
  if (cache && Date.now() - cache.at < 20_000) return cache;
  inflight ??= load().finally(() => (inflight = null));
  try {
    cache = await inflight;
    return cache;
  } catch (e) {
    if (!cache) throw e;
    return cache; // serve the last good snapshot when the RPC hiccups
  }
}

export async function fairwayTokens(): Promise<FwData> {
  return (await get()).data;
}

export async function fairwayToken(mint: string): Promise<{ token: FwToken; swaps: FwSwap[]; slot: number; updatedAt: number } | null> {
  const g = await get();
  const token = g.data.tokens.find((t) => t.mint === mint);
  return token ? { token, swaps: g.swaps.get(mint) ?? [], slot: g.data.slot, updatedAt: g.data.updatedAt } : null;
}

/** Forces the next read to hit the chain (after a swap or a new launch). */
export const invalidateFairway = () => {
  cache = cache && { ...cache, at: 0 };
};
