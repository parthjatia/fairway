# DECISIONS.md

One line per decision: date — decision — why.

- 2026-11-19 — Node v24.22.3 LTS installed to ~/.local/opt/node (tarball, no sudo) — v24 is LTS with the broadest native-module prebuild coverage (better-sqlite3); v26 is newer but riskier for prebuilds.
- 2026-11-19 — pnpm 12.21.0 via corepack; build-script allowlist uses `allowBuilds` in pnpm-workspace.yaml — pnpm ≥11 ignores `onlyBuiltDependencies`.
- 2026-11-19 — Pinned TypeScript ~6.0 — TS 7 (native) is outside typescript-eslint's supported peer range (<6.1).
- 2026-11-19 — Workspace TS libs are consumed from source (`exports` → `src/index.ts`), no per-lib build step; `build` = typecheck for libs, `next build` for the web app — fewer moving parts, faster iteration.
- 2026-11-19 — `pnpm test` skips Rust tests with a warning when cargo is missing — keeps fresh-clone `pnpm test` green on machines without Rust.
- 2026-11-19 — Tier min-trade checks count trades that have a markout at the primary horizon (not raw trade count) — a trade with no future mid carries no evidence.
- 2026-11-19 — Fixtures: 4 real days at 5 s CEX steps (not compressed time) so the 3-day RETAIL rule is exercised honestly; three SOL-USDC pools (Raydium/Orca/Fairway, synthetic addresses) with depths 60k/40k/10k SOL.
- 2026-11-19 — Swap amounts are GROSS (what moves through the vaults); execPrice is pre-fee (net input / output). Parser recovers pre-fee price using the pool's known fee (or the Fairway event's fee_bps).
- 2026-11-19 — Personas are picked after scoring (Rita = first RETAIL-classified retail wallet; New wallet = never-seen address) so they are guaranteed consistent with the scorer.
- 2026-11-19 — Generated fixture JSON (~5 MB) is committed so the demo works instantly offline; `pnpm fixtures` regenerates deterministically.
- 2026-11-19 — Scoring tier rule 'all-horizons' (default): TOXIC if ANY horizon (5/30/60 s) shrunk score ≥ 10 bps; RETAIL only if ALL ≤ 3 bps — the sim showed snipers with ~60 s foresight look clean at the 30 s primary horizon. `scoreBps` displayed is still the 30 s primary.
- 2026-11-19 — Sim calibration: $3M CPMM (10k SOL), 60% vol GBM + 24 jumps/day (σ 50 bps), retail 0.75/min lognormal median $150, 3 arbs, 3 snipers (60 s foresight, $3k). Documented in ECONOMICS.md; sensitivities (elasticity, informed-flow intensity, STANDARD fee) are output, not hidden.
- 2026-11-19 — Fees in the sim are kept outside reserves (LP revenue tracked separately) for clean accounting; onchain fees stay in the vaults (standard). Both are fine for the comparison.
- 2026-11-19 — All regimes share pre-generated randomness per seed (common random numbers); 8 seeds × 24 h; paired standard errors reported.
- 2026-11-19 — Warm-up = 72 h flat-30 run on an independent path, scored with @fairway/scoring (retailMinHistoryDays = 2 inside the sim since warm-up is 3 days).
- 2026-11-19 — Honest headline framing: a flat fee sets BOTH the retail price and the LVR no-arb band. We report Fairway vs flat 30 (same band: retail saves ~18 bps, LPs give up ~that as a transfer) AND vs flat 5 (same retail price: LPs keep ~$500/day more). Worst case (rotation) lands on the flat-fee curve — documented, not hidden.
- 2026-11-19 — Staleness bound for "recommended" = max(60 bps, 3 × baseline p95); sweep picks max LP PnL s.t. retail cost ≤ baseline and p95 ≤ bound (spec rule).
- 2026-11-19 — Charts are hand-written SVG (no chart lib), palette validated with the dataviz validator; PNG copies via optional `sharp`.
- 2026-11-19 — Anchor 1.2.2 (avm latest) + Agave 4.4.1 installed fine; no fallback needed. Program tests use LiteSVM 0.15 (Anchor's template default) in Rust; Cargo.lock seeded from the Anchor template to pin a LiteSVM-compatible dependency graph.
- 2026-11-19 — Program id 8jo3xry2rp9rQHwPCyh8c9Qwnw2HHa5JvAUiXHo2XPXk from a throwaway keypair in .keys/ (gitignored, copied to target/deploy). Fresh clones without it: run `anchor keys sync` (documented in SETUP_REMAINING).
- 2026-11-19 — Wrong-signer protection: `trader_score` is an UncheckedAccount with `seeds = ["score", trader.key()]`, so passing another wallet's PDA fails with ConstraintSeeds (2006) rather than silently downgrading; a missing/stale/malformed account resolves to default tier (clamped ≥ STANDARD).
- 2026-11-19 — MIN_LIQUIDITY (1000 LP units) is tracked as virtual supply (`pool.lp_supply`) rather than minted to a burn account — same economics, one fewer account.
- 2026-11-19 — Fees stay in the vaults (k grows); per-tier cumulative fees/swaps are tracked on the Pool for transparency. close_score rent always returns to the score authority (who paid).
- 2026-11-19 — Score writes: `set_score` uses init_if_needed; `set_scores_batch` creates PDAs manually (transfer+allocate+assign) from remaining_accounts, max 10/tx.
- 2026-11-19 — SDK is hand-written on @solana/web3.js 1.99 (wallet-adapter peer) with a minimal Borsh codec; IDL committed at packages/sdk/idl/fairway.json and tests assert byte-level parity.
- 2026-11-19 — Parser core is one self-contained TS file (no imports/BigInt, ES2018) that esbuild inlines into streams/filter.js; a test asserts filter.js is byte-identical to a fresh build and gives identical output to the parser. Matching is by pool VAULT accounts (works for any AMM and aggregator-routed swaps).
- 2026-11-19 — Raydium SOL-USDC vault addresses prefilled from memory and marked "VERIFY" in pools.config.json/STREAM_CONFIG.md; Orca/Fairway entries are placeholders (ignored by the filter until filled).
- 2026-11-19 — Webhook auth: QuickNode HMAC (x-qn-signature over nonce+timestamp+body) when QN_STREAM_TOKEN is set, plus an `x-fairway-token` shared-secret header for curl/local use.
- 2026-11-19 — Ingest: Fastify 5 + better-sqlite3 (WAL). Postgres-compatible SQL (DOUBLE PRECISION/BIGINT types, ON CONFLICT upserts). Raw body kept (gzip-decompressed) for HMAC verification. Affected wallets are recomputed after each delivery.
- 2026-11-19 — Markout mids: fixture mode = the simulated CEX path; live mode = pool-implied mid from the stored swaps (Pyth provider stubbed). History length measured to the latest data timestamp (not wall clock) so fixture data stays meaningful.
