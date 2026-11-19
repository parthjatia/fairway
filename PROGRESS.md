STATUS: DONE

# PROGRESS.md

## Current state / next step
All milestones M0–M12 complete. Fresh-clone install/build/test verified (TS 8 packages + Rust 12 math + 9 LiteSVM tests); every page returns 200 in mock mode. Remaining human steps: docs/SETUP_REMAINING.md.

## Audit fixes (2026-11-19, see AUDIT.md)
- [x] #1 README: added "Built with" (sponsor tools) and "What's next" sections

## Milestones
- [x] **M0 Setup:** toolchain detection and installs, monorepo scaffold, lint/format, CI-style `pnpm test` script, PROGRESS.md, DECISIONS.md, .gitignore, .env.example
- [x] **M1 Scoring package:** types, markout, shrinkage, tiers, MidPriceProviders, tests green
- [x] **M2 Fixtures:** deterministic generator (agents, CEX path, swaps, getBlock-shaped blocks incl. edge cases)
- [x] **M3 Simulator and backtest:** regimes, metrics, sweep grid, recommended params, chart export
- [x] **M4 Math crate and Anchor program:** accounts, instructions, events, security checks, tests green (or the Section 5.6 fallback)
- [x] **M5 SDK:** PDAs, instruction builders, account decoders, typed errors, tests
- [x] **M6 Parser and Streams filter:** shared logic, filter.js, tests against fixtures, STREAM_CONFIG.md
- [x] **M7 Ingest service:** webhook, SQLite, recompute, read APIs, fixture mode, tests
- [x] **M8 Keeper:** diffing, batching, dry-run/local/devnet modes, tests
- [x] **M9 Frontend:** all pages, mock mode, persona switcher, backtest interactivity, polished design
- [x] **M10 Live wiring:** wallet adapter, SDK calls against the local validator, `pnpm demo:local`
- [x] **M11 Docs:** README, ECONOMICS, RISKS, PITCH, DEMO_SCRIPT, SETUP_REMAINING, charts embedded
- [x] **M12 Hardening pass:** full test, build and lint; fresh-clone check; fix everything; final UI review; README accuracy check

## Definition of Done (Section 12)
- [x] `pnpm i && pnpm test && pnpm build` pass from a fresh clone
- [x] `pnpm demo` runs the full product offline with simulated data
- [x] Anchor program compiles and its tests pass (or documented fallback)
- [x] The wrong-signer score test exists and passes
- [x] Backtest shows all regimes incl. wallet-rotation worst case, charts in README
- [x] `streams/filter.js` standalone, tested, documented in STREAM_CONFIG.md
- [x] Ingest + scoring + keeper work end to end in fixture/dry-run mode
- [x] Every frontend page works in mock mode, "Simulated data" badge, responsive polished UI
- [x] README covers all required sections
- [x] PITCH.md (15 Q&As), DEMO_SCRIPT.md, SETUP_REMAINING.md complete
- [x] All work committed locally; no secrets in git

## Toolchain (detected/installed 2026-11-19)
- node v24.22.3, pnpm 12.21.0, typescript 6.0.3
- rustc/cargo 1.100.0 (rustup, user-level)
- solana-cli 4.4.1 (Agave, user-level)
- anchor-cli 1.2.2 (avm), platform-tools v1.57; LiteSVM tests
