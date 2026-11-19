/**
 * Bundle detection (M16 step 11) from QuickNode Streams data: launch trades (Pump.fun / PumpSwap, or a Fairway launch)
 * plus fundings of brand-new wallets (packages/parser/src/funding.ts).
 *
 * A wallet is BUNDLE-FLAGGED for a launch when
 *   - it bought within `earlyWindowSlots` of the launch slot, and
 *   - it was funded (as a brand-new account) by a source wallet within `lookbackSlots` before the launch slot, at the
 *     latest in the slot of its first buy, and
 *   - at least `minWallets` early buyers of that launch were funded by the SAME source this way.
 * A funder that ran bundles in ≥ `knownFunderMinLaunches` different launches is a KNOWN BUNDLER. Every brand-new wallet
 * it funds afterwards is flagged pre-emptively (the keeper can write its score before the wallet buys).
 *
 * Tier rule (`bundleTier`): a flagged wallet never pays less than STANDARD (it can't carry a RETAIL tier, e.g. a bought
 * aged wallet), and pays TOXIC when its funder is a known bundler or a TOXIC sniper. Flagging is evidence about who
 * controls a wallet, not about its markout, so it only ever raises a tier.
 */
import type { Tier } from './types';

export type FundingTransfer = { sig: string; slot: number; funder: string; wallet: string; sol: number };
export type BundleLaunchTrade = { slot: number; mint: string; trader: string; kind: 'create' | 'buy' | 'sell' };

export type BundleConfig = {
  /** funding at most this many slots before the launch slot (1,500 ≈ 10 min) */
  lookbackSlots: number;
  /** early buy = within this many slots of the launch (same as the sniper scorer) */
  earlyWindowSlots: number;
  /** wallets with one funder buying one launch early that make a bundle */
  minWallets: number;
  /** distinct bundled launches that make a funder a known bundler */
  knownFunderMinLaunches: number;
};

export const DEFAULT_BUNDLE_CONFIG: BundleConfig = { lookbackSlots: 1_500, earlyWindowSlots: 25, minWallets: 2, knownFunderMinLaunches: 2 };

export type Bundle = { mint: string; launchSlot: number; funder: string; wallets: string[]; solFunded: number };
export type BundleFlag = { wallet: string; funder: string; reason: 'bundle' | 'known-bundler-funding'; mint: string | null; slot: number };
export type FunderStats = { funder: string; launches: number; wallets: number; knownBundler: boolean };
export type BundleReport = { bundles: Bundle[]; flags: BundleFlag[]; funders: FunderStats[] };

export function detectBundles(trades: readonly BundleLaunchTrade[], fundings: readonly FundingTransfer[], cfg: BundleConfig = DEFAULT_BUNDLE_CONFIG): BundleReport {
  // launch slot per mint: the create, else the first trade seen
  const launchSlot = new Map<string, number>();
  for (const t of trades) if (t.kind === 'create') launchSlot.set(t.mint, Math.min(launchSlot.get(t.mint) ?? Infinity, t.slot));
  const firstSeen = new Map<string, number>();
  for (const t of trades) if (!launchSlot.has(t.mint)) firstSeen.set(t.mint, Math.min(firstSeen.get(t.mint) ?? Infinity, t.slot));
  for (const [m, slot] of firstSeen) launchSlot.set(m, slot);
  // first early buy per (mint, wallet)
  const firstBuy = new Map<string, Map<string, number>>();
  for (const t of trades) {
    if (t.kind !== 'buy') continue;
    const L = launchSlot.get(t.mint)!;
    if (t.slot - L > cfg.earlyWindowSlots || t.slot < L) continue;
    const m = firstBuy.get(t.mint) ?? new Map<string, number>();
    m.set(t.trader, Math.min(m.get(t.trader) ?? Infinity, t.slot));
    firstBuy.set(t.mint, m);
  }
  // fundings of each wallet (a wallet is brand-new once, but be tolerant of several deliveries)
  const fundedBy = new Map<string, FundingTransfer[]>();
  for (const f of fundings) {
    const l = fundedBy.get(f.wallet) ?? [];
    l.push(f);
    fundedBy.set(f.wallet, l);
  }
  const bundles: Bundle[] = [];
  for (const [mint, buyers] of firstBuy) {
    const L = launchSlot.get(mint)!;
    const byFunder = new Map<string, { wallets: string[]; sol: number }>();
    for (const [wallet, buySlot] of buyers) {
      const f = (fundedBy.get(wallet) ?? []).filter((x) => x.slot >= L - cfg.lookbackSlots && x.slot <= buySlot && x.funder !== wallet).sort((a, b) => b.slot - a.slot)[0];
      if (!f) continue;
      const g = byFunder.get(f.funder) ?? { wallets: [], sol: 0 };
      g.wallets.push(wallet);
      g.sol += f.sol;
      byFunder.set(f.funder, g);
    }
    for (const [funder, g] of byFunder) if (g.wallets.length >= cfg.minWallets) bundles.push({ mint, launchSlot: L, funder, wallets: g.wallets.sort(), solFunded: g.sol });
  }
  bundles.sort((a, b) => a.launchSlot - b.launchSlot || a.funder.localeCompare(b.funder));
  const stats = new Map<string, { launches: Set<string>; wallets: Set<string> }>();
  for (const b of bundles) {
    const s = stats.get(b.funder) ?? { launches: new Set<string>(), wallets: new Set<string>() };
    s.launches.add(b.mint);
    b.wallets.forEach((w) => s.wallets.add(w));
    stats.set(b.funder, s);
  }
  const funders: FunderStats[] = [...stats].map(([funder, s]) => ({ funder, launches: s.launches.size, wallets: s.wallets.size, knownBundler: s.launches.size >= cfg.knownFunderMinLaunches }));
  funders.sort((a, b) => b.launches - a.launches || a.funder.localeCompare(b.funder));
  const known = new Set(funders.filter((f) => f.knownBundler).map((f) => f.funder));
  const flags = new Map<string, BundleFlag>();
  for (const b of bundles) for (const w of b.wallets) flags.set(w, { wallet: w, funder: b.funder, reason: 'bundle', mint: b.mint, slot: b.launchSlot });
  // pre-emptive: brand-new wallets funded by a known bundler, even before they buy anything
  for (const f of fundings) if (known.has(f.funder) && !flags.has(f.wallet)) flags.set(f.wallet, { wallet: f.wallet, funder: f.funder, reason: 'known-bundler-funding', mint: null, slot: f.slot });
  return { bundles, flags: [...flags.values()].sort((a, b) => a.slot - b.slot || a.wallet.localeCompare(b.wallet)), funders };
}

const RANK: Record<Tier, number> = { RETAIL: 0, STANDARD: 1, TOXIC: 2 };

/** The tier a flagged wallet pays: at least STANDARD, TOXIC when its funder is a known bundler or a TOXIC sniper. */
export function bundleTier(current: Tier, funderKnownBundler: boolean, funderTier: Tier = 'STANDARD'): Tier {
  const floor: Tier = funderKnownBundler || funderTier === 'TOXIC' ? 'TOXIC' : 'STANDARD';
  return RANK[current] >= RANK[floor] ? current : floor;
}
