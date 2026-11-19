STATUS: DONE


# PROGRESS.md

## Current state / next step
M16 launch pivot complete (2026-11-19): launch fee curve + pool TWAP onchain (46 LiteSVM tests), launch sim (default /backtest), /launch wizard + /launch/[id], Pump.fun Stream L filter + sniper scores, docs reframed around launches. `pnpm test`, `pnpm build`, `pnpm lint` pass; every page returns 200 in mock mode. Human TODOs added: verify Pump.fun/PumpSwap program IDs, create Stream L (docs/SETUP_REMAINING.md §5).
All milestones M0–M15 complete (M15 = LP-first fee model, 2026-11-19) (M13 = trustless onchain markout scoring, 2026-11-19; devnet Pyth account still to verify, SETUP_REMAINING §4b). Fresh-clone install/build/test verified (TS 8 packages + Rust 22 math + 37 LiteSVM tests after M15); every page returns 200 in mock mode. Remaining human steps: docs/SETUP_REMAINING.md. Judge audit (AUDIT.md) low-risk items #1–#7 done 2026-11-19; #8–#10 are human/out of scope.

## Audit fixes (2026-11-19, see AUDIT.md)
- [x] #1 README: added "Built with" (sponsor tools) and "What's next" sections
- [x] #2 Raydium SOL-USDC vaults verified on mainnet; VERIFY markers replaced (README, STREAM_CONFIG, pools.config.json, SETUP_REMAINING, DECISIONS)
- [x] #3 Venue overclaims fixed (landing page, README): only Raydium is configured; Orca/Meteora need vaults added
- [x] #4 DEMO_SCRIPT: added a QuickNode Streams shot (live + offline fallback); fixed the nonexistent "rotation toggle" step
- [x] #5 SETUP_REMAINING: skip keygen/`anchor keys sync` on the build machine (prevents a program-ID change before deploy)
- [x] #6 run.sh (local autonomous build loop) untracked and gitignored; file kept on disk
- [x] #7 .env.example: QN_STREAM_TOKEN comment now describes the HMAC x-qn-signature check (matches auth.ts / STREAM_CONFIG)

## M16 Launch pivot (Fairway Launch: known snipers pay more, humans pay less)
- [x] 1. Onchain launch fee schedule (per-pool launch params, tier × time decay, tests: decay math, window boundary, fresh wallet at block 0, wrong-signer attack)
- [x] 2. Onchain pool TWAP for tokens without an oracle (price accumulator, settle via TWAP, tests, RISKS.md §1d)
- [x] 3. Launch simulation (default /backtest view): packages/sim/src/launch.ts, out/launch.json, LaunchExplorer tab, docs/charts/launch-*.svg
- [x] 4. Launch flow and UI: /launch wizard (mock + live via SDK, verified on a local validator), /launch/[id] (playback, buyers with tier + score source, sniper-share meter, same-buy-two-wallets), landing reframed, nav launches-first (liquid pair secondary), seed:local adds a launch pool
- [x] 5. Streams: Pump.fun sniper scoring: streams/pumpfun-filter.js (generated from packages/parser/src/pumpfun.ts, program ids marked VERIFY), new fixture data/pumpfun.json (8 launches, edge cases; existing fixtures untouched), cross-launch sniper scorer (packages/scoring/src/sniper.ts), ingest POST /streams/pumpfun + GET /snipers, keeper merges sniper TOXIC, STREAM_CONFIG.md Stream L
- [x] 6. Docs: README (Fairway Launch headline, For judges criteria + per-prize checklists, launch economics, Solana, Streams L/A/B, What's next with the 6 required items, "LP-neutral within noise" next to LVR −73%), ECONOMICS §8, RISKS §10, PITCH (launch script + 14 launch Q&As), DEMO_SCRIPT (live launch), SETUP_REMAINING (Stream L, VERIFY ids), ARCHITECTURE, /how-it-works launch card
- [x] 7. Final check: pnpm test (TS 8 suites + cargo incl. 46 LiteSVM), pnpm build, pnpm lint all pass; all pages 200 in mock mode (/, /launch, /launch/{frog,sols,pie}, /backtest, /swap, /wallet, /wallet/[addr], /pool, /how-it-works); README links and anchors checked, overclaims reviewed

## M16 follow-up (steps 8-11)
- [x] 8. Verified program IDs: Pyth SOL/USD devnet 7UVim…, Pump.fun 6EF8…, PumpSwap pAMM…, all used exactly; VERIFY labels removed; tests pin the literals; SETUP_REMAINING notes "verified 2026-11-19"
- [x] 9. Lead metrics: humans pay 53% less than time-decay-only; sniper share of early supply 49% → 27%; "same sniper fee" explained as deterrence (landing hero stats, /backtest launch view stats + lead sentence, README headline bullets, PITCH lead line + hook + new Q2 "what is the point?")
- [x] 10. Creator share of the TOXIC premium (default 50%): onchain (configure_launch creator_share_bps, Pool.creator_owed_*, claim_creator_fees, 3 LiteSVM tests → 49), SDK, sim (creatorPremiumUsd, lpFeesUsd, creatorShare sweep), wizard field, /launch/[id] Creator revenue card, /backtest table, ECONOMICS §8.4b, README
- [x] 11. Bundler detection: parser funding.ts + Stream L emits fundings, scoring bundle.ts (≥2 early buyers funded by one source within 1,500 slots; known bundler after 2 launches → pre-emptive TOXIC), new fixture data/bundles.json, ingest fundings + GET /bundles + keeper merge, sim regime "Fairway + bundles", bundle badge + toggle on /launch/[id], STREAM_CONFIG + README + ECONOMICS §8.5b + RISKS §10b + PITCH Q13. Demo launch /launch/cat (seed 9) shows 7 bundle wallets under Fairway, kept out under bundle detection.

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
- [x] **M14 Polish + business model:** economics verdict and sensitivity (LPs vs flat 30 is NOT unconditional; stated honestly), 15% protocol fee share + treasury PDA, treasury-sponsored score rent (fallback trader pays), per-pool oracle + 1e12 price scale fixes, BONK-test second pool (fixtures, seed, UI picker), same-trade-two-wallets panel, /pool bot-extra-fees headline, Verified fair flow badge, SDK getFeeTier, README For judges + business model, PITCH/DEMO_SCRIPT updated
- [x] **M15 LP-first fee model:** sim `rebate` regime (epoch-funded, budget-capped, floored) + `runLpFirst` (paired seeds, noise bands, protocol-share options) → `packages/sim/out/lpfirst.json`; defaults toxic 80 / retail=standard 30 / rebate 10% of premium / protocol 15% of the premium only; HONEST RESULT: no setting beats flat 30 for LPs beyond noise (default LP +$15±33 before, −$56±31 after protocol share; LVR −73%, retail −1.0±0.7 bps); onchain `update_retail_fee` + per-tier volume and epoch counters + RebateParams + premium-only protocol share; 7 new LiteSVM tests (cap, floor, epoch roll, zero-toxic epoch, skipped epochs, tier isolation, validation); SDK/IDL/web/README/ECONOMICS/PITCH/RISKS updated; elasticity kept as a labelled extra
- [x] **M13 Onchain markout scoring:** TraderScore sums + 4-entry pending buffer; swap queues trades (creates PDA); permissionless `settle_markout` with validated Pyth; same shrinkage/tiers as packages/scoring; blend with keeper bootstrap (onchain wins ≥ 1,000 USDC); LiteSVM tests (signs, shrinkage, tier transitions, stale/invalid oracle, early settle no-op, wrong-trader, full buffer, expiry, close guard); shared TS/Rust vectors; SDK/keeper/web/docs updated

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
