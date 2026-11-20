import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAUNCHPADS, parseLaunchPayload, parseLaunchStream, parseLaunchpadTransaction, parsePumpPayload } from '../src';

// real Solana mainnet transactions (getBlock via QuickNode RPC, maxSupportedTransactionVersion 1, 2026-11-20)
const fx = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'data', 'launchpads.json'), 'utf8')) as { blocks: any[] };
const [LL, DBC] = LAUNCHPADS;

describe('LaunchLab + Meteora DBC on real mainnet transactions', () => {
  const recs = parseLaunchPayload(fx.blocks);
  const by = (venue: string, kind?: string) => recs.filter((r) => r.venue === venue && (!kind || r.kind === kind));
  it('ids are the verified program ids and the vault authorities are their PDAs', () => {
    expect(LL!.program).toBe('LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');
    expect(DBC!.program).toBe('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');
    expect(LL!.authority).toBe('WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh');
    expect(DBC!.authority).toBe('FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM');
  });
  it('extracts buys and sells for both venues with sane SOL prices', () => {
    for (const v of ['launchlab', 'meteora-dbc']) {
      expect(by(v, 'buy').length).toBeGreaterThan(0);
      expect(by(v, 'sell').length).toBeGreaterThan(0);
      for (const r of by(v)) {
        expect(r.tokenAmount >= 0 && r.solAmount >= 0).toBe(true);
        if (r.kind !== 'create') expect(r.price).toBeCloseTo(r.solAmount / r.tokenAmount, 12);
      }
    }
  });
  it('detects the Meteora DBC create (InitializeVirtualPoolWith…) of a SOL-quoted launch', () => {
    const c = by('meteora-dbc', 'create');
    expect(c.length).toBeGreaterThan(0);
    for (const r of c) expect(r.tokenAmount).toBe(0);
  });
  it('detects the LaunchLab create (InitializeWithToken2022)', () => {
    const c = by('launchlab', 'create');
    expect(c.length).toBe(1);
    expect(c[0]!.mint).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
  it('is pure and de-duplicated', () => {
    expect(parseLaunchPayload({ data: [fx.blocks, fx.blocks] })).toEqual(recs);
  });
  it('drops transactions that only touch the program as a routing hop or are USDC-quoted', () => {
    const all = fx.blocks.flatMap((b) => b.transactions.map((tx: any) => ({ tx, slot: b.slot })));
    const dropped = all.filter(({ tx, slot }) => !parseLaunchpadTransaction(tx, slot, 0, LL!).length && !parseLaunchpadTransaction(tx, slot, 0, DBC!).length);
    expect(dropped.length).toBeGreaterThan(0);
  });
  it('the Pump.fun-only parser ignores these venues, and the stream entry point includes them', () => {
    expect(parsePumpPayload(fx.blocks).filter((r) => r.venue === 'launchlab' || r.venue === 'meteora-dbc')).toEqual([]);
    expect(parseLaunchStream(fx.blocks)!.launchTrades).toEqual(recs);
  });
});
