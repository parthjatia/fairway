import { describe, expect, it } from 'vitest';
import { DEFAULT_LAUNCH_CONFIG as C, decayedFee, launchFee, makeLaunchScenario, runLaunch, runLaunchStudy } from '../src';

describe('launch fee schedules', () => {
  it('match the onchain curve (fairway_math::launch vectors)', () => {
    expect([0, 1, 2].map((t) => launchFee(C, 'fairway', t as 0 | 1 | 2, 0))).toEqual([30, 300, 1000]);
    expect(launchFee(C, 'fairway', 2, 375)).toBe(540);
    expect(launchFee(C, 'fairway', 1, 375)).toBe(165);
    expect(launchFee(C, 'fairway', 0, 375)).toBe(18);
    expect(launchFee(C, 'fairway', 2, 749)).toBe(82);
    expect(launchFee(C, 'fairway', 2, 750)).toBe(80); // after the window: normal tier fee
    expect(launchFee(C, 'fairway', 0, 750)).toBe(30);
    expect(launchFee(C, 'decay', 0, 0)).toBe(300);
    expect(launchFee(C, 'decay', 2, 0)).toBe(300); // one fee for everyone
    expect(launchFee(C, 'flat', 2, 0)).toBe(30);
    expect(decayedFee(300, 30, 749, 750)).toBe(31);
  });
  it('a fresh wallet pays the same as time-decay-only under Fairway (STANDARD curve = the decay curve)', () => {
    for (let s = 0; s < 900; s += 7) expect(launchFee(C, 'fairway', 1, s)).toBe(s < 750 ? launchFee(C, 'decay', 1, s) : 30);
  });
});

describe('launch simulation', () => {
  it('is deterministic', () => {
    const a = runLaunch(C, makeLaunchScenario(C, 3), 'fairway').metrics;
    const b = runLaunch(C, makeLaunchScenario(C, 3), 'fairway').metrics;
    expect(a).toEqual(b);
  });
  it('flat fee: every sniper buys at block 0 and holds a large share of the window supply', () => {
    const m = runLaunch(C, makeLaunchScenario(C, 1), 'flat').metrics;
    expect(m.sniperParticipation).toBe(1);
    expect(m.humanHighFeeShare).toBe(0);
  });
  const st = runLaunchStudy(C, Array.from({ length: 60 }, (_, i) => i + 1));
  const reg = (id: string) => st.regimes.find((r) => r.id === id)!.metrics;
  const key = (id: string) => st.keyChart.find((r) => r.id === id)!;
  it('key result: humans pay far less than under time-decay-only, snipers pay as much or more', () => {
    expect(key('fairway').humanFeeBps).toBeLessThan(key('decay').humanFeeBps * 0.6);
    // pooled over all sniper trades: about the same (known snipers are mostly kept out, so fewer high-fee trades happen)
    expect(key('fairway').sniperFeeBps).toBeGreaterThanOrEqual(key('decay').sniperFeeBps * 0.95);
    // the snipers Fairway knows pay clearly more per dollar traded
    expect(key('fairway').knownSniperFeeBps).toBeGreaterThan(key('decay').knownSniperFeeBps * 1.2);
    expect(st.paired.launchesWhereHumansPayLess).toBe(1);
  });
  it('Fairway cuts the sniper share of window supply vs time-decay and flat', () => {
    expect(reg('fairway').sniperShareOfWindowSupply.mean).toBeLessThan(reg('decay').sniperShareOfWindowSupply.mean * 0.75);
    expect(reg('decay').sniperShareOfWindowSupply.mean).toBeLessThan(reg('flat').sniperShareOfWindowSupply.mean);
    expect(reg('fairway').retailEntryPremiumPct.mean).toBeLessThan(reg('decay').retailEntryPremiumPct.mean);
  });
  it('worst case (all snipers on fresh wallets): snipers pay what time-decay charges, humans still pay less', () => {
    expect(key('fairwayRotation').sniperFeeBps).toBeCloseTo(key('decay').sniperFeeBps, 0);
    expect(key('fairwayRotation').humanFeeBps).toBeCloseTo(key('fairway').humanFeeBps, 6);
    expect(reg('fairwayRotation').sniperShareOfWindowSupply.mean).toBeGreaterThan(reg('fairway').sniperShareOfWindowSupply.mean);
  });
  it('honest trade-off: creator fee revenue is below time-decay-only (humans pay less), above flat', () => {
    expect(reg('fairway').creatorFeesUsd.mean).toBeLessThan(reg('decay').creatorFeesUsd.mean);
    expect(reg('fairway').creatorFeesUsd.mean).toBeGreaterThan(reg('flat').creatorFeesUsd.mean);
  });
  it('creator share: 50% of the TOXIC premium by default, paid only by TOXIC trades, never more than premium − protocol', () => {
    const f = reg('fairway');
    expect(st.creatorShare.defaultBps).toBe(5_000);
    expect(f.creatorPremiumUsd.mean).toBeCloseTo(f.premiumUsd.mean * 0.5, 6);
    expect(f.lpFeesUsd.mean + f.creatorPremiumUsd.mean).toBeCloseTo(f.creatorFeesUsd.mean, 6);
    for (const id of ['flat', 'decay', 'decayHigh', 'fairwayRotation']) expect(reg(id).creatorPremiumUsd.mean).toBe(0);
    const rows = st.creatorShare.rows;
    expect(rows.map((r) => r.creatorDirectUsd)).toEqual([...rows.map((r) => r.creatorDirectUsd)].sort((a, b) => a - b));
    for (const r of rows) {
      expect(r.creatorDirectUsd + (r.protocolUsd - C.launchFeeUsd)).toBeLessThanOrEqual(st.creatorShare.premiumUsd + 1e-9);
      expect(r.creatorIfSoleLpUsd).toBeCloseTo(rows[0]!.creatorIfSoleLpUsd, 9); // the share moves money, it does not create it
    }
    const trades = st.example.fairway.trades;
    expect(trades.filter((t) => t.premiumUsd > 0).every((t) => t.tier === 2)).toBe(true);
  });
  it('exports an example launch with trades under Fairway and time-decay', () => {
    expect(st.example.fairway.trades.length).toBeGreaterThan(20);
    expect(st.example.fairway.trades.some((t) => t.agent === 'sniper' || t.agent === 'bundler')).toBe(true);
    expect(st.example.decay.trades.length).toBeGreaterThan(20);
  });
});
