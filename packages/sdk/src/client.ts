import { Connection, PublicKey } from '@solana/web3.js';
import { decodeConfig, decodePool, decodeTraderScore, type ConfigAccount, type PoolAccount, type TraderScoreAccount } from './accounts';
import { PROGRAM_ID } from './constants';
import { feeTierFromAccounts } from './feetier';
import { swapQuote } from './math';
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
    // reserves that price the curve exclude protocol fees that have accrued in the vaults but are not yet claimed
    return { ...pool, address: a.pool, reserveBase: BigInt(b.value.amount) - pool.protocolOwedBase - pool.creatorFees.owedBase, reserveQuote: BigInt(q.value.amount) - pool.protocolOwedQuote - pool.creatorFees.owedQuote };
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
  async effectiveFee(trader: PublicKey, pool?: PoolAccount | null, notionalQ?: bigint): Promise<{ tier: number; source: string; feeBps: number; rebateBps: number } | null> {
    const [config, score, slot] = await Promise.all([this.fetchConfig(), this.fetchScore(trader), this.connection.getSlot()]);
    if (!config) return null;
    const t = feeTierFromAccounts(trader, config, score, BigInt(slot), pool, notionalQ);
    return { tier: t.tier, source: t.source, feeBps: t.feeBps, rebateBps: t.rebateBps };
  }

  async quote(trader: PublicKey, baseMint: PublicKey, quoteMint: PublicKey, amountIn: bigint, aToB: boolean) {
    const pool = await this.fetchPool(baseMint, quoteMint);
    if (!pool) return null;
    // quote-equivalent notional (base valued at the pool's spot price) for the rebate budget cap
    const notionalQ = aToB && pool.reserveBase > 0n ? (amountIn * pool.reserveQuote) / pool.reserveBase : amountIn;
    const fee = await this.effectiveFee(trader, pool, notionalQ);
    if (!fee) return null;
    const [rin, rout] = aToB ? [pool.reserveBase, pool.reserveQuote] : [pool.reserveQuote, pool.reserveBase];
    return { ...swapQuote(amountIn, rin, rout, fee.feeBps), ...fee };
  }
}
