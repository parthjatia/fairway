# AUDIT.md — judge-eye review (2026-11-19, deadline Fri Nov 20 12:00 CST)

## Baseline (before any fix)

| Check | Result |
|---|---|
| `pnpm test` | **Pass.** 94 TS tests in 9 packages (scoring 28, fixtures 10, parser 11, sdk 11, sim 12, ingest 11, streams 5, keeper 6; web has none), plus Rust 12 math tests and 9 LiteSVM program tests (incl. `wrong_signer_cannot_use_someone_elses_retail_score`). |
| `pnpm build` | **Pass.** All libs typecheck, and `next build` prerenders 10 routes. |
| `pnpm lint` | **Pass.** ESLint and the typecheck are clean. |
| `pnpm demo` (smoke) | **Pass.** Ingest boots in fixture mode (7,974 swaps; 106 RETAIL / 48 STANDARD / 7 TOXIC wallets). `/`, `/swap`, `/pool`, `/backtest`, `/how-it-works`, `/wallet` and all three persona wallet pages return 200. The "Simulated data" badge renders, and `POST /streams/solana` accepts filter output. |

Overall: technically strong, honest, and well documented. The gaps are about **evidence for judges** (nothing live yet, missing Devpost sections) and a few **claims that run ahead of the code**.

## Top 10 improvements, ranked by judge impact ÷ effort

| # | Issue | Why a judge cares | Effort | Risk | Do now? |
|---|---|---|---|---|---|
| 1 | **README has no "What's next" and no "Built with / sponsor tools" section.** SETUP_REMAINING tells the human to paste both into Devpost, but neither exists. | These are required Devpost questions and part of the spec's README list. Judges notice when a section is missing. | 0.3 h | None (docs) | ✅ |
| 2 | **Raydium vaults marked "VERIFY / from memory"** in README, STREAM_CONFIG, pools.config.json and DECISIONS. | The QuickNode bounty judge sees an unverified config, which reads as "never ran". I verified both via `getAccountInfo` on mainnet (slot 471323404). `DQyr…vPpz` is a wSOL token account (9 dec) and `HLmq…vBBz` is a USDC account (6 dec), both owned by the Raydium AMM v4 authority `5Q544fKr…`. | 0.2 h | None (labels only; filter.js output unchanged) | ✅ |
| 3 | **Claims ahead of the code:** the landing page and how-it-works say the Stream extracts swaps on "Raydium, **Orca** and Fairway", and the README says it scores history on "Raydium/Orca/**Meteora**". Only Raydium is configured. Orca and Fairway are placeholders, and Meteora is absent. | Judges reward honesty, and this project's brand *is* honesty. One overclaim undermines the "what's simulated" table. | 0.2 h | Low (copy only) | ✅ |
| 4 | **DEMO_SCRIPT has no QuickNode Streams shot,** and it says "toggle the rotation regime", but no toggle exists (the rotation result is always shown). | Demo quality: the bounty judge needs to *see* Streams in the video. A script step that doesn't match the UI wastes a take. | 0.3 h | None (docs) | ✅ |
| 5 | **Program-ID footgun in SETUP_REMAINING:** step 2 says to run `solana-keygen` and `anchor keys sync` unconditionally. On this machine `.keys/` and the program keypair already exist, so re-syncing would change the program ID and desync README, Anchor.toml and the SDK hours before the deadline. | Solana award: the program ID in the README must match the deployed program. | 0.15 h | None (docs) | ✅ |
| 6 | **`run.sh` committed at repo root.** It is the autonomous build loop (`claude --dangerously-skip-permissions`, `cd ~/fairway`) and is not a project script. | Clutter in the first screen of the repo, plus a script with a hard-coded home path that looks like a mistake. | 0.05 h | Low (untrack and gitignore; the local file is kept) | ✅ |
| 7 | **`.env.example` says QuickNode sends the secret in `x-qn-api-key`,** but the real path is the HMAC `x-qn-signature` (STREAM_CONFIG and auth.ts). | A bounty judge checking webhook security sees conflicting docs. | 0.05 h | None | ✅ |
| 8 | **Nothing is live yet: no devnet program ID, no running Stream.** The README Devnet row says "TBD". | **Biggest single impact** for the Solana award and the QuickNode bounty, but it needs accounts and funds (human only). Follow SETUP_REMAINING §3–6. Then paste the devnet ID, a Stream screenshot and one real `stored N swaps` log line into the README. | 1.5–2 h (human) | Medium (deploy issues) | ❌ human |
| 9 | **No UI screenshots in the README.** It only has backtest charts. | Judges skim the README before (or instead of) running the app. Two or three screenshots (swap with tier panel, backtest) make the product tangible. | 0.5 h (grab them while recording the video) | None | ❌ human (needs a browser) |
| 10 | **Web app has zero tests** (`passWithNoTests`), and the LP headline is negative vs flat 30 bps. | Technical-execution judges look at coverage. Impact judges will ask "so do LPs win?" (PITCH Q7 already answers this well). Fixing either is new work or a recalibration of the economics. | 2 h+ / large | Medium–high | ❌ out of scope |

Also noted, not ranked: Retail Rita's score is 2.9 bps against a 3 bps RETAIL threshold. That is deterministic, so it's fine, but don't regenerate fixtures with a new seed before recording. `CLAUDE.md` (autonomous build instructions) is committed. Whether to disclose AI-assisted building is the team's call under hackathon rules, so I left it as is.

## Submission requirements check

| Requirement | Status |
|---|---|
| README: problem | ✅ "The problem" |
| README: how it works / solution | ✅ "How it works" + mermaid architecture |
| README: what makes it unique | ✅ |
| README: what's next | ❌ missing → fixed in #1 |
| README: tech + sponsor tools | ❌ missing → fixed in #1 |
| README: economic design | ✅ (+ docs/ECONOMICS.md) |
| README: risk assumptions | ✅ (+ docs/RISKS.md) |
| README: how Solana is used | ✅ |
| Program IDs table | ⚠️ Localnet ID present. **Devnet "TBD" (human deploy, #8).** |
| QuickNode Stream: network | ✅ mainnet + devnet |
| QuickNode Stream: dataset | ✅ Block |
| QuickNode Stream: filter logic | ✅ README table + STREAM_CONFIG step by step |
| QuickNode Stream: destination | ✅ webhook `/streams/solana`, HMAC |
| QuickNode Stream: why | ✅ README "Why" column + STREAM_CONFIG "Why Streams" |
| Stream actually created and running | ❌ human (#8) |
| Setup instructions | ✅ Quick start + docs/SETUP_REMAINING.md (footgun fixed in #5) |
| Simulated vs live disclosure | ✅ table + UI badge (overclaims fixed in #3) |
| Demo video script | ✅ (Streams shot added in #4) |
| Pitch + 15 Q&As | ✅ docs/PITCH.md |
| Repo public on GitHub | ❌ human (`git push`; the agent never pushes) |

## What was implemented (items under 1 h with low risk)

See PROGRESS.md "Audit fixes" for the commit per item.
