import { describe, expect, it } from 'vitest';
import { explorerTx, metaOf, REGISTRY } from './registry';
import { ago } from './client/fairway';

describe('token registry', () => {
  it('names the seeded devnet mints', () => {
    expect(metaOf('BLo5pvqdwJY4yN5f91utohYk39hgnPKxA3KfV7PCX86X').symbol).toBe('USDC');
    expect(Object.keys(REGISTRY)).toHaveLength(4);
  });
  it('prefers a locally saved name, then falls back to the mint', () => {
    const m = 'So11111111111111111111111111111111111111112';
    expect(metaOf(m, { [m]: { symbol: 'FAIR', name: 'My Fair Token' } }).symbol).toBe('FAIR');
    expect(metaOf(m).symbol).toBe('SO11');
  });
  it('links transactions on devnet explorer', () => {
    expect(explorerTx('abc')).toBe('https://explorer.solana.com/tx/abc?cluster=devnet');
  });
});

describe('ago', () => {
  it('formats elapsed time', () => {
    expect(ago(null)).toBe('—');
    expect(ago(100, 130)).toBe('30s ago');
    expect(ago(0 + 1, 1 + 7200)).toBe('2h ago');
    expect(ago(1, 1 + 3 * 86400)).toBe('3d ago');
  });
});
