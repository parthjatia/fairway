# PROGRESS.md

## Current state / next step
M0–M2 done. Next: M3 simulator + backtest.

## Milestones
- [x] **M0 Setup:** toolchain detection and installs, monorepo scaffold, lint/format, CI-style `pnpm test` script, PROGRESS.md, DECISIONS.md, .gitignore, .env.example
- [x] **M1 Scoring package:** types, markout, shrinkage, tiers, MidPriceProviders, tests green
- [x] **M2 Fixtures:** deterministic generator (agents, CEX path, swaps, getBlock-shaped blocks incl. edge cases)
- [ ] **M3 Simulator and backtest:** regimes, metrics, sweep grid, recommended params, chart export
- [ ] **M4 Math crate and Anchor program:** accounts, instructions, events, security checks, tests green (or the Section 5.6 fallback)
- [ ] **M5 SDK:** PDAs, instruction builders, account decoders, typed errors, tests
- [ ] **M6 Parser and Streams filter:** shared logic, filter.js, tests against fixtures, STREAM_CONFIG.md
- [ ] **M7 Ingest service:** webhook, SQLite, recompute, read APIs, fixture mode, tests
- [ ] **M8 Keeper:** diffing, batching, dry-run/local/devnet modes, tests
- [ ] **M9 Frontend:** all pages, mock mode, persona switcher, backtest interactivity, polished design
- [x] **M10 Live wiring:** wallet adapter, SDK calls against the local validator, `pnpm demo:local`
- [x] **M11 Docs:** README, ECONOMICS, RISKS, PITCH, DEMO_SCRIPT, SETUP_REMAINING, charts embedded
- [x] **M12 Hardening pass:** full test, build and lint; fresh-clone check; fix everything; final UI review; README accuracy check

## Definition of Done (Section 12)
- [ ] `pnpm i && pnpm test && pnpm build` pass from a fresh clone
- [ ] `pnpm demo` runs the full product offline with simulated data
- [ ] Anchor program compiles and its tests pass (or documented fallback)
- [ ] The wrong-signer score test exists and passes
- [ ] Backtest shows all regimes incl. wallet-rotation worst case, charts in README
- [ ] `streams/filter.js` standalone, tested, documented in STREAM_CONFIG.md
- [ ] Ingest + scoring + keeper work end to end in fixture/dry-run mode
- [ ] Every frontend page works in mock mode, "Simulated data" badge, responsive polished UI
- [ ] README covers all required sections
- [ ] PITCH.md (15 Q&As), DEMO_SCRIPT.md, SETUP_REMAINING.md complete
- [ ] All work committed locally; no secrets in git
- [ ] PROGRESS.md starts with `STATUS: DONE`

## Toolchain (detected/installed 2026-11-19)
- node v24.22.3, pnpm 12.21.0, typescript 6.0.3
- rustc/cargo 1.100.0 (rustup, user-level)
- solana-cli 4.4.1 (Agave, user-level)
- anchor: installing via avm (see DECISIONS.md)
