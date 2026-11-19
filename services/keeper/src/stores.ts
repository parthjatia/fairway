import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Connection, PublicKey } from '@solana/web3.js';
import { decodeConfig, decodeTraderScore, configPda, scorePda } from '@fairway/sdk';
import type { OnchainScore, Update } from './diff';

/** Where the keeper reads the current onchain state from. */
export interface ScoreStore {
  readonly name: string;
  currentSlot(): Promise<bigint>;
  ttlSlots(): Promise<bigint>;
  fetch(traders: string[]): Promise<Map<string, OnchainScore | null>>;
}

/**
 * Dry-run mirror: a JSON file standing in for the chain. After a dry-run batch is "sent", the mirror is
 * updated, so the next run only proposes real changes. Slots advance 1 per second of wall clock (approx).
 */
export class MirrorStore implements ScoreStore {
  readonly name = 'mirror';
  private data: { slot: string; ttl: string; scores: Record<string, { tier: 0 | 1 | 2; scoreBps: number; trades: number; updatedSlot: string }> };
  constructor(
    readonly path: string,
    opts: { ttlSlots?: bigint; startSlot?: bigint } = {},
  ) {
    this.data = existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
      : { slot: String(opts.startSlot ?? 1_000n), ttl: String(opts.ttlSlots ?? 216_000n), scores: {} };
  }
  async currentSlot() {
    return BigInt(this.data.slot);
  }
  async ttlSlots() {
    return BigInt(this.data.ttl);
  }
  advance(slots: bigint) {
    this.data.slot = String(BigInt(this.data.slot) + slots);
  }
  async fetch(traders: string[]) {
    const m = new Map<string, OnchainScore | null>();
    for (const t of traders) {
      const s = this.data.scores[t];
      m.set(t, s ? { tier: s.tier, scoreBps: s.scoreBps, trades: s.trades, updatedSlot: BigInt(s.updatedSlot) } : null);
    }
    return m;
  }
  apply(updates: Update[]) {
    for (const u of updates) this.data.scores[u.trader] = { tier: u.tier, scoreBps: u.scoreBps, trades: u.trades, updatedSlot: this.data.slot };
  }
  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 1));
  }
  get size() {
    return Object.keys(this.data.scores).length;
  }
}

/** Reads TraderScore PDAs + Config over RPC (local validator or devnet). */
export class RpcStore implements ScoreStore {
  readonly name = 'rpc';
  constructor(
    readonly connection: Connection,
    readonly programId: PublicKey,
  ) {}
  async currentSlot() {
    return BigInt(await this.connection.getSlot('confirmed'));
  }
  async ttlSlots() {
    const info = await this.connection.getAccountInfo(configPda(this.programId)[0]);
    if (!info) throw new Error(`Fairway config not found for program ${this.programId.toBase58()} — run the seed script first`);
    return decodeConfig(info.data).scoreTtlSlots;
  }
  async fetch(traders: string[]) {
    const m = new Map<string, OnchainScore | null>();
    const cfgInfo = await this.connection.getAccountInfo(configPda(this.programId)[0]);
    const mk = cfgInfo ? decodeConfig(cfgInfo.data).markout : null;
    const minNotional = mk?.onchainMinNotional ?? 0n;
    const minTrades = mk ? Math.min(mk.toxicMinTrades, mk.retailMinTrades) : 0;
    for (let i = 0; i < traders.length; i += 100) {
      const part = traders.slice(i, i + 100);
      const infos = await this.connection.getMultipleAccountsInfo(part.map((t) => scorePda(new PublicKey(t), this.programId)[0]));
      part.forEach((t, j) => {
        const info = infos[j];
        if (!info || !info.owner.equals(this.programId)) return m.set(t, null);
        try {
          const s = decodeTraderScore(info.data);
          m.set(t, {
            tier: s.tier as 0 | 1 | 2,
            scoreBps: s.scoreBps,
            trades: s.trades,
            updatedSlot: s.updatedSlot,
            onchainVerified: minNotional > 0n && s.sumNotional >= minNotional && s.tradeCount >= minTrades,
          });
        } catch {
          m.set(t, null);
        }
      });
    }
    return m;
  }
}
