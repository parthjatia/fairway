import { Connection, PublicKey } from '@solana/web3.js';
import { decodeConfig, decodePool, decodeTraderScore, type ConfigAccount, type PoolAccount, type TraderScoreAccount } from './accounts';
import { PROGRAM_ID } from './constants';
import { resolveTier, swapQuote } from './math';
import { configPda, poolAddresses, scorePda } from './pda';

/** Thin read-side client; instruction builders live in ./instructions. */
export class FairwayClient {
  constructor(
    readonly connection: Connection,
    readonly programId: PublicKey = PROGRAM_ID,
  ) {}

  async fetchConfig(): Promise<ConfigAccount | null> {
    const info = await this.connection.getAccountInfo(configPda(this.programId)[0]);
    return info ? decodeConfig(info.data) : null;
  }

  async fetchPool(baseMint: PublicKey, quoteMint: PublicKey): Promise<(PoolAccount & { address: PublicKey; reserveBase: bigint; reserveQuote: bigint }) | null> {
    const a = poolAddresses(baseMint, quoteMint, this.programId);
    const info = await this.connection.getAccountInfo(a.pool);
    if (!info) return null;
    const pool = decodePool(info.data);
    const [b, q] = await Promise.all([this.connection.getTokenAccountBalance(pool.baseVault), this.connection.getTokenAccountBalance(pool.quoteVault)]);
    return { ...pool, address: a.pool, reserveBase: BigInt(b.value.amount), reserveQuote: BigInt(q.value.amount) };
  }

  async fetchScore(trader: PublicKey): Promise<TraderScoreAccount | null> {
    const info = await this.connection.getAccountInfo(scorePda(trader, this.programId)[0]);
    if (!info || !info.owner.equals(this.programId)) return null;
    try {
      return decodeTraderScore(info.data);
    } catch {
      return null;
    }
  }

  /** Tier + fee a swap signed by `trader` would pay right now (mirrors the program). */
  async effectiveFee(trader: PublicKey): Promise<{ tier: number; source: string; feeBps: number } | null> {
    const [config, score, slot] = await Promise.all([this.fetchConfig(), this.fetchScore(trader), this.connection.getSlot()]);
    if (!config) return null;
    const r = resolveTier(score ? { tier: score.tier, updatedSlot: score.updatedSlot } : null, BigInt(slot), config.scoreTtlSlots, config.defaultTier);
    return { ...r, feeBps: config.feeBps[r.tier as 0 | 1 | 2] };
  }

  async quote(trader: PublicKey, baseMint: PublicKey, quoteMint: PublicKey, amountIn: bigint, aToB: boolean) {
    const [pool, fee] = await Promise.all([this.fetchPool(baseMint, quoteMint), this.effectiveFee(trader)]);
    if (!pool || !fee) return null;
    const [rin, rout] = aToB ? [pool.reserveBase, pool.reserveQuote] : [pool.reserveQuote, pool.reserveBase];
    return { ...swapQuote(amountIn, rin, rout, fee.feeBps), ...fee };
  }
}
