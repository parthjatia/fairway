// Launch model shared by the server (demo launches) and the client (mock-mode launches you create).
// A launch view runs the SAME agent-based engine as the backtest (packages/sim/src/launch.ts) on a seeded scenario,
// under Fairway (tier × time) and under time-decay-only, so every number on the page is reproducible. Simulated data.
import { base58Encode, Rng } from '@fairway/fixtures';
import { DEFAULT_LAUNCH_CONFIG, launchFee, makeLaunchScenario, runLaunch, type LaunchAgent, type LaunchRun, type LaunchSimConfig, type TierIdx } from '@fairway/sim/launch';
import { buildTokenCheck, DEFAULT_CHECK_CONFIG, type TokenCheck, type Tier } from '@fairway/scoring';

export type LaunchSpec = {
  id: string;
  name: string;
  symbol: string;
  /** total token supply; `poolPct` of it goes into the pool at launch */
  supply: number;
  poolPct: number;
  /** starting USDC liquidity */
  liquidityUsd: number;
  /** launch window in minutes (400 ms slots) */
  windowMin: number;
  /** scenario seed (who shows up) */
  seed: number;
  /** creator share of the TOXIC (known-sniper) premium, % (default 50; onchain `configure_launch` creator_share_bps) */
  creatorSharePct?: number;
  createdBy: 'demo' | 'you';
  createdAt: number;
};

export const TIER_OF: Record<TierIdx, Tier> = { 0: 'RETAIL', 1: 'STANDARD', 2: 'TOXIC' };

/** Demo launches (seeds picked from the 200-launch study: each has snipers; CAT has a bundle that buys). */
export const DEMO_LAUNCHES: LaunchSpec[] = [
  { id: 'frog', name: 'Fairway Frog', symbol: 'FROG', supply: 1_000_000_000, poolPct: 80, liquidityUsd: 24_000, windowMin: 5, seed: 5, createdBy: 'demo', createdAt: 1_763_560_000 },
  { id: 'sols', name: 'Solstice', symbol: 'SOLS', supply: 1_000_000_000, poolPct: 80, liquidityUsd: 15_000, windowMin: 5, seed: 31, createdBy: 'demo', createdAt: 1_763_550_000 },
  { id: 'pie', name: 'Moonpie', symbol: 'PIE', supply: 500_000_000, poolPct: 90, liquidityUsd: 32_000, windowMin: 3, seed: 3, createdBy: 'demo', createdAt: 1_763_540_000 },
  // a bundle whose funder is a known bundler: 7 bundle wallets buy under plain Fairway, none with bundle detection
  { id: 'cat', name: 'Copycat', symbol: 'CAT', supply: 1_000_000_000, poolPct: 80, liquidityUsd: 20_000, windowMin: 5, seed: 9, createdBy: 'demo', createdAt: 1_763_530_000 },
];

export const SLOT_SEC = 0.4;
export const DEFAULT_CREATOR_SHARE_PCT = DEFAULT_LAUNCH_CONFIG.creatorPremiumShareBps / 100;
/** creator + protocol share of the premium may not exceed 100% (the program enforces the same bound) */
export const MAX_CREATOR_SHARE_PCT = 100 - DEFAULT_LAUNCH_CONFIG.protocolPremiumShareBps / 100;
export const specConfig = (s: LaunchSpec): LaunchSimConfig => ({
  ...DEFAULT_LAUNCH_CONFIG,
  poolTokens: (s.supply * s.poolPct) / 100,
  windowSlots: Math.max(1, Math.round((s.windowMin * 60) / SLOT_SEC)),
  creatorPremiumShareBps: Math.round((s.creatorSharePct ?? DEFAULT_CREATOR_SHARE_PCT) * 100),
});

/** Where the launch's fees went up to `slot` (Fairway run), and what the same launch paid under time-decay-only. */
export function revenueAt(v: LaunchSimView, slot: number) {
  const upTo = (r: LaunchRun) => r.trades.filter((t) => t.slot <= slot);
  const fw = upTo(v.fairway);
  const fees = fw.reduce((a, t) => a + t.feeUsd, 0);
  const premium = fw.reduce((a, t) => a + t.premiumUsd, 0);
  const protocol = (premium * v.cfg.protocolPremiumShareBps) / 10_000;
  const creator = Math.min((premium * v.cfg.creatorPremiumShareBps) / 10_000, premium - protocol);
  const fromSnipers = fw.filter((t) => t.agent === 'sniper' || t.agent === 'bundler').reduce((a, t) => a + t.feeUsd, 0);
  const decayFees = upTo(v.decay).reduce((a, t) => a + t.feeUsd, 0);
  return { fees, premium, protocol, creator, lp: fees - protocol - creator, fromSnipers, decayFees, sharePct: v.cfg.creatorPremiumShareBps / 100 };
}

/** Where a buyer's tier comes from: verified onchain by settle_markout, bootstrapped from history (Streams), or a fresh wallet. */
export type ScoreSource = 'onchain' | 'bootstrap' | 'none';

export type Buyer = {
  wallet: string;
  label: string;
  agent: LaunchAgent;
  tier: Tier;
  source: ScoreSource;
  /** first buy slot */
  slot: number;
  usd: number;
  tokens: number;
  feeUsd: number;
  feeBps: number;
  sold: boolean;
  /** funded by the same source as other early buyers shortly before the launch (Streams funding check) */
  bundle: boolean;
};

export type LaunchSimView = {
  spec: LaunchSpec;
  cfg: LaunchSimConfig;
  listingPrice: number;
  fairway: LaunchRun;
  /** Fairway + bundle detection (bundle wallets funded by a known bundler pay TOXIC) */
  bundle: LaunchRun;
  /** this launch has a bundle, and its funder is a known bundler (so detection charges it TOXIC) */
  hasBundle: boolean;
  bundleFunderKnown: boolean;
  decay: LaunchRun;
  /** stable fake addresses for the sim's wallet ids */
  address: Record<string, string>;
  source: Record<string, ScoreSource>;
};

function addr(spec: LaunchSpec, wallet: string): string {
  let h = 2166136261;
  for (const c of `${spec.id}:${wallet}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return base58Encode(new Rng(h >>> 0).bytes(32));
}

/** Deterministic score source per wallet: known snipers were scored from Pump.fun history (bootstrap); some also traded on
 *  Fairway before (onchain-verified). RETAIL-history buyers: half verified onchain, half bootstrapped. Fresh wallets: none. */
function sourceOf(spec: LaunchSpec, wallet: string, tier: TierIdx): ScoreSource {
  if (tier === 1) return 'none';
  const r = new Rng(Array.from(`${spec.seed}:${wallet}`).reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0).next();
  if (tier === 2) return r < 0.35 ? 'onchain' : 'bootstrap';
  return wallet.startsWith('dca-') || r < 0.5 ? 'onchain' : 'bootstrap';
}

export function simulateLaunch(spec: LaunchSpec): LaunchSimView {
  const cfg = specConfig(spec);
  const sc = { ...makeLaunchScenario(cfg, spec.seed), liquidityUsd: spec.liquidityUsd };
  const fairway = runLaunch(cfg, sc, 'fairway', { recordTrades: true });
  const decay = runLaunch(cfg, sc, 'decay', { recordTrades: true });
  const bundle = runLaunch(cfg, sc, 'fairwayBundle', { recordTrades: true });
  const bundleBots = sc.bots.filter((b) => b.kind === 'bundler');
  const address: Record<string, string> = {};
  const source: Record<string, ScoreSource> = {};
  for (const t of [...fairway.trades, ...decay.trades, ...bundle.trades]) {
    address[t.wallet] ??= addr(spec, t.wallet);
    source[t.wallet] ??= sourceOf(spec, t.wallet, t.tier);
  }
  // snipers who stayed out under Fairway still have a known tier (shown as "kept out")
  for (const b of sc.bots) {
    address[b.id] ??= addr(spec, b.id);
    source[b.id] ??= sourceOf(spec, b.id, b.known ? 2 : 1);
  }
  return { spec, cfg, listingPrice: sc.liquidityUsd / cfg.poolTokens, fairway, bundle, hasBundle: bundleBots.length > 0, bundleFunderKnown: bundleBots.some((b) => b.funderKnown), decay, address, source };
}

const AGENT_LABEL: Record<LaunchAgent, string> = { retail: 'Human', goodbot: 'DCA bot', sniper: 'Sniper', bundler: 'Bundle wallet' };

/** Buyers up to `slot` (one row per wallet, first buy), newest first. */
export function buyersAt(v: LaunchSimView, run: LaunchRun, slot: number): Buyer[] {
  const by = new Map<string, Buyer>();
  for (const t of run.trades) {
    if (t.slot > slot) break;
    const b = by.get(t.wallet);
    if (t.side === 'buy') {
      if (b) {
        b.usd += t.usd;
        b.tokens += t.tokens;
        b.feeUsd += t.feeUsd;
        b.feeBps = (b.feeUsd / b.usd) * 10_000;
      } else
        by.set(t.wallet, {
          wallet: v.address[t.wallet] ?? t.wallet,
          label: AGENT_LABEL[t.agent],
          agent: t.agent,
          tier: TIER_OF[t.tier],
          // a bundle wallet charged TOXIC got its score from the keeper's funding check (bootstrap), not its own history
          source: t.agent === 'bundler' && t.tier === 2 ? 'bootstrap' : (v.source[t.wallet] ?? 'none'),
          slot: t.slot,
          usd: t.usd,
          tokens: t.tokens,
          feeUsd: t.feeUsd,
          feeBps: t.feeBps,
          sold: false,
          bundle: t.agent === 'bundler',
        });
    } else if (b) b.sold = true;
  }
  return [...by.values()].sort((a, b) => b.slot - a.slot);
}

/** Share of tokens bought so far (inside the window) that went to snipers + bundlers. */
export function sniperShareAt(run: LaunchRun, slot: number, windowSlots: number): number {
  let all = 0;
  let bots = 0;
  for (const t of run.trades) {
    if (t.slot > slot) break;
    if (t.side !== 'buy' || t.slot >= windowSlots) continue;
    all += t.tokens;
    if (t.agent === 'sniper' || t.agent === 'bundler') bots += t.tokens;
  }
  return all > 0 ? bots / all : 0;
}

export function priceAt(run: LaunchRun, slot: number, listing: number): number {
  let p = listing;
  for (const x of run.priceBySlot) {
    if (x.slot > slot) break;
    p = x.price;
  }
  return p;
}

export const feeNow = (v: LaunchSimView, tier: TierIdx, slot: number) => launchFee(v.cfg, 'fairway', tier, slot);
export const decayFeeNow = (v: LaunchSimView, slot: number) => launchFee(v.cfg, 'decay', 1, slot);

export function newLaunchId(): string {
  return `my-${Date.now().toString(36)}`;
}

/**
 * The Fairway Check report (same engine as /check) for this simulated launch, using the trades up to `slot`.
 * Sniper = a wallet the run resolves to TOXIC; "new wallet" = no score source (a fresh wallet). The sim trades in USD, so
 * `earlyBuyVolumeSol` of this report holds USD (the launch page does not show it).
 */
export function launchCheck(v: LaunchSimView, run: LaunchRun, slot: number): TokenCheck {
  const tier = new Map<string, TierIdx>();
  const bundle = new Set<string>();
  const history = new Set<string>();
  const trades = [];
  for (const t of run.trades) {
    if (t.slot > slot) break;
    const w = v.address[t.wallet] ?? t.wallet;
    tier.set(w, t.tier);
    if (t.agent === 'bundler' && t.tier === 2) bundle.add(w);
    if ((v.source[t.wallet] ?? 'none') !== 'none') history.add(w);
    trades.push({ wallet: w, slot: t.slot, kind: t.side, tokens: t.tokens, sol: t.usd });
  }
  return buildTokenCheck(
    { mint: v.spec.id, launchSlot: 0, trades, tierOf: (w) => (tier.get(w) === 2 ? 'TOXIC' : 'STANDARD'), bundleOf: (w) => bundle.has(w), hadHistory: (w) => history.has(w) },
    DEFAULT_CHECK_CONFIG,
  );
}
