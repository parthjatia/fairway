/** Names for the test mints seeded on devnet (scripts/seed-local.ts). Fairway writes no Metaplex metadata, so tokens
 * created through the launch wizard fall back to the name the creator typed (kept in that browser) or a short mint. */
export type TokenMeta = { symbol: string; name: string };

export const REGISTRY: Record<string, TokenMeta> = {
  '5MGHqbFpALcjCkZCHikM4ZbDqMiYDSxzJ7TVDu9dbzGL': { symbol: 'SOL', name: 'Solana (devnet test)' },
  BLo5pvqdwJY4yN5f91utohYk39hgnPKxA3KfV7PCX86X: { symbol: 'USDC', name: 'USD Coin (devnet test)' },
  '9zF4cWscYeBKD9jk4GNZLKJvu3vtRq1KmUDThSgHavib': { symbol: 'BONK', name: 'Bonk (devnet test)' },
  EEouDkuyyi3pNC8r25FF63XYbyidGvsKH8WJTatizjhf: { symbol: 'FROG', name: 'Frog (fair launch)' },
};

export const metaOf = (mint: string, local?: Record<string, TokenMeta>): TokenMeta =>
  REGISTRY[mint] ?? local?.[mint] ?? { symbol: mint.slice(0, 4).toUpperCase(), name: `Token ${mint.slice(0, 4)}…${mint.slice(-4)}` };

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
