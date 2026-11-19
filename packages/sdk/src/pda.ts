import { PublicKey } from '@solana/web3.js';
import { PROGRAM_ID, SEEDS } from './constants';

const enc = (s: string) => new TextEncoder().encode(s);
const find = (seeds: Uint8Array[], programId: PublicKey) => PublicKey.findProgramAddressSync(seeds, programId);

export const configPda = (programId = PROGRAM_ID) => find([enc(SEEDS.config)], programId);
export const poolPda = (baseMint: PublicKey, quoteMint: PublicKey, programId = PROGRAM_ID) =>
  find([enc(SEEDS.pool), baseMint.toBytes(), quoteMint.toBytes()], programId);
export const vaultPda = (pool: PublicKey, mint: PublicKey, programId = PROGRAM_ID) => find([enc(SEEDS.vault), pool.toBytes(), mint.toBytes()], programId);
export const lpMintPda = (pool: PublicKey, programId = PROGRAM_ID) => find([enc(SEEDS.lpMint), pool.toBytes()], programId);
/** The score PDA is derived from the TRADER (swap signer) — the program enforces this. */
export const scorePda = (trader: PublicKey, programId = PROGRAM_ID) => find([enc(SEEDS.score), trader.toBytes()], programId);

export type PoolAddresses = { pool: PublicKey; baseVault: PublicKey; quoteVault: PublicKey; lpMint: PublicKey };
export function poolAddresses(baseMint: PublicKey, quoteMint: PublicKey, programId = PROGRAM_ID): PoolAddresses {
  const [pool] = poolPda(baseMint, quoteMint, programId);
  return {
    pool,
    baseVault: vaultPda(pool, baseMint, programId)[0],
    quoteVault: vaultPda(pool, quoteMint, programId)[0],
    lpMint: lpMintPda(pool, programId)[0],
  };
}
