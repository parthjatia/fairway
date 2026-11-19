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
