# CLAUDE.md — Fairway: autonomous build instructions

> **For the human (Claude: you can skip this box).**
> Run this in an empty, dedicated folder (ideally a VM or dev container, because approvals are disabled):
> ```bash
> mkdir fairway && cd fairway && git init   # put this CLAUDE.md here
> claude --dangerously-skip-permissions "Read CLAUDE.md and execute it until the Definition of Done is met. Never ask me anything."
> ```
> To keep it going across session ends or usage-limit pauses, use this loop (it stops when PROGRESS.md says DONE, or after 40 runs):
> ```bash
> for i in $(seq 1 40); do
>   grep -q "STATUS: DONE" PROGRESS.md 2>/dev/null && break
>   claude -p --dangerously-skip-permissions "Continue building per CLAUDE.md. Read PROGRESS.md and DECISIONS.md first, then do the next unchecked milestone. Never ask questions."
>   sleep 30
> done
> ```
> When it finishes, open `docs/SETUP_REMAINING.md`. It lists everything only you can do (accounts, deploys, video).

---

## 0. Your operating rules (read first, follow always)

You are building a hackathon project **autonomously, for many hours, with no human available.**

1. **Never ask questions and never wait for approval.** If something is ambiguous, pick the most reasonable option, log it in `DECISIONS.md` (one line: date, decision, why), and continue.
2. **Never stop early.** Keep working milestone by milestone until every box in Section 12 (Definition of Done) is checked. When a session starts, read `PROGRESS.md` and `DECISIONS.md` first and resume from the first unchecked item.
3. **Maintain `PROGRESS.md`**: the milestone checklist from Section 11 with `[ ]` / `[x]`, plus a short "Current state / next step" note at the top. Update it after every milestone. When everything is done, write `STATUS: DONE` on its own line at the top.
4. **Never block on external things.** These need human accounts or network access and must be **mocked behind an interface**, never waited on: QuickNode account/Streams, devnet/mainnet RPC, funded wallets, Pyth, Devpost. Ship a working **fixture (fake data) mode** for everything and a clearly marked **live mode** that is wired up but needs env vars.
5. **Time-box problems.** If one problem takes more than ~40 minutes (a toolchain install, a flaky test, a dependency conflict), simplify, mock or work around it, log it in `DECISIONS.md`, and move on. Breadth that works beats one perfect part.
6. **Always keep it runnable.** After each milestone: build, lint and test the affected packages, fix failures, then `git add -A && git commit -m "<milestone>: <summary>"`. Local commits only. **Never push** and never add remotes.
7. **Safety:** only touch files inside this project folder. Never use real private keys or real funds. Generate throwaway keypairs into `.keys/` (gitignored). Never commit secrets. `.env.example` files only.
8. **Honesty in the product:** whenever the UI shows simulated data, show a small "Simulated data" badge. The README must say plainly what is synthetic vs. live.
9. **Toolchain:** detect installed versions first (`node -v`, `pnpm -v`, `rustc -V`, `solana --version`, `anchor --version`). If something is missing, install the current stable version (Node LTS, pnpm via corepack, Rust via rustup, Agave/Solana CLI, Anchor via avm). If the Solana/Anchor install fails after reasonable attempts, follow the fallback in Section 5.6 and keep going.

---

## 1. What we are building

**Fairway: a Solana DEX where bots pay more and humans pay less.**

- **Problem:** AMM liquidity providers (LPs) lose money to arbitrage bots. When the price moves on a centralized exchange, bots trade against the stale pool price first. This is called LVR (loss-versus-rebalancing). Every trader pays the same fee, so retail users effectively subsidize the bots draining LPs.
- **Insight:** onchain trading history is public. For every past trade by a wallet, we can measure its **markout**: did the price move in the trader's favor shortly after they traded? Consistently positive markout means informed or toxic flow (arbitrage, bots). Near-zero markout means uninformed retail flow.
- **Mechanism:** a constant-product AMM whose swap fee depends on the trader's **toxicity tier**, read from an onchain `TraderScore` account written by a score oracle:
  - `RETAIL` (proven uninformed history): low fee, default **5 bps**
  - `STANDARD` (unknown or new wallet): default **30 bps** (a fresh wallet can never pay less than this, so bots gain nothing by rotating wallets)
  - `TOXIC` (proven informed flow): high fee, default **80 bps**
- **Data layer = QuickNode Streams:** a Stream (Solana, block dataset, server-side JS filter) extracts swaps on chosen DEX pools. The data is used to (a) backfill history to score wallets from day one, including their trading on Raydium/Orca/Meteora, (b) keep scores live, and (c) drive the backtest.
- **Proof = backtest:** an agent-based simulation shows LP PnL, retail execution cost and pool price staleness under a flat fee vs. Fairway fees, including a worst case where arbitrageurs rotate wallets to always pay STANDARD.

**Prize targets (shape every decision around these):**
- **DeFi track (main):** a new AMM fee primitive; the README must explain the economic design, risk assumptions and program addresses.
- **Best use of Solana:** Anchor program, SPL tokens, PDAs, Solana-native data. The README must list program IDs and explain how we use Solana.
- **QuickNode Streams bounty:** Streams as the core data source; at least one Stream with a filter and a destination (webhook). The README must explain the Stream config (network, dataset, filter logic, destination) and why.

**Deadline context:** submission is Fri Nov 20, 12:00 CST. The human needs the remaining ~10% (accounts, deploys, video) done by then, so prioritize a complete, polished demo over extra features.

---

## 2. Repository layout (monorepo, pnpm workspaces)

```
/
├─ CLAUDE.md  PROGRESS.md  DECISIONS.md  README.md  .gitignore  .env.example
├─ package.json  pnpm-workspace.yaml  tsconfig.base.json
├─ Anchor.toml  Cargo.toml (workspace)
├─ programs/fairway/            # Anchor program
├─ crates/fairway-math/         # pure Rust math (testable with plain cargo)
├─ packages/
│  ├─ sdk/                      # TS client for the program (instructions, PDAs, types)
│  ├─ scoring/                  # markout engine, shrinkage, tiers (pure TS, heavily tested)
│  ├─ sim/                      # agent-based simulator + backtest + parameter sweep
│  ├─ parser/                   # Solana block/tx → swap records (shared by filter & services)
│  └─ fixtures/                 # deterministic synthetic data generator + generated data
├─ services/
│  ├─ ingest/                   # Streams webhook receiver → SQLite
│  └─ keeper/                   # scores DB → batched set_score txs (dry-run by default)
├─ streams/
│  ├─ filter.js                 # QuickNode Streams filter: function main(stream) {...}
│  ├─ filter.test.ts            # runs filter against fixture blocks
│  └─ STREAM_CONFIG.md          # exact settings to click in the QuickNode dashboard
├─ apps/web/                    # Next.js frontend (mock mode by default)
├─ scripts/                     # demo.sh, seed-local.ts, run-backtest.ts, export-charts.ts
└─ docs/                        # ARCHITECTURE.md, ECONOMICS.md, RISKS.md, PITCH.md,
                                # DEMO_SCRIPT.md, SETUP_REMAINING.md
```

Use TypeScript (strict) for all JS/TS. Use vitest for TS tests. Use SQLite (`better-sqlite3`) for storage. Keep the SQL Postgres-compatible and note that in the README. Keep dependencies minimal and mainstream.

---

## 3. Domain spec: markout scoring (`packages/scoring`)

**Swap record (canonical type, shared everywhere):**
```ts
type Swap = {
  sig: string; slot: number; ts: number;        // unix seconds
  pool: string; venue: 'fairway'|'raydium'|'orca'|'meteora'|'fixture';
  trader: string;                                // fee payer / signer
  side: 'buy'|'sell';                            // buy = trader receives BASE (e.g. SOL)
  baseAmount: number; quoteAmount: number;       // UI units, positive
  execPrice: number;                             // quote per base, PRE-fee
  feeBps?: number; tier?: Tier;
};
```

**Markout** for a trade at time t, horizon h (defaults: 5s, 30s, 60s; primary = 30s):
- `s = +1` for buy, `−1` for sell. `m = mid(t + h)` from a `MidPriceProvider`.
- `markout_bps = s * (m − execPrice) / execPrice * 10_000`
- Use the pre-fee execution price, because we measure information, not cost.

**Wallet toxicity score (with Bayesian shrinkage toward 0):**
- `score = Σ(notional_i * markout_i) / (Σ notional_i + K)`, with `K = 2_000` (prior notional in quote units; configurable).
- Also store: trade count, total notional, first-seen timestamp, per-horizon scores.

**Tier rules (all thresholds in a single config object):**
- `TOXIC` if `score ≥ 10 bps` and `trades ≥ 5`
- `RETAIL` if `score ≤ 3 bps` and `trades ≥ 5` and `historyDays ≥ 3` (fixtures may compress time; make this configurable)
- otherwise `STANDARD`. Unknown wallets are always `STANDARD`.

**MidPriceProvider interface** with implementations:
- `FixtureMidPrice` (from the simulated CEX path)
- `PoolImpliedMidPrice` (last trade or reserve ratio from the stream itself)
- `PythMidPrice` (a stub with the correct interface and a TODO; it must not break the build)

Write thorough unit tests: sign conventions for buy and sell, shrinkage behavior, tier boundaries, empty history, a wallet with a single huge trade, and determinism.

---

## 4. Simulation and backtest (`packages/sim`): the core proof

This must make the idea convincing, so build it carefully.

**Agent-based simulation (deterministic with a seed):**
- **CEX price:** geometric Brownian motion, configurable volatility (default 60% annualized), 400 ms steps (Solana slots), 24h horizon by default.
- **Pool:** constant product, starting at e.g. 10,000 SOL / 1,500,000 USDC at the starting price.
- **Retail agents:** Poisson arrivals (configurable rate), lognormal size (median ~$150), random direction, price-insensitive. Optional fee elasticity parameter (default off).
- **Arbitrageurs:** each step, if the gap between pool and CEX exceeds the fee they would pay plus a gas threshold, trade the pool toward `CEX * (1 ± fee)` (optimal arb size for constant product), with profit measured at the CEX mid.
- **Momentum/sniper bots (small share):** trade in the direction of the next few steps' move. These are informed and should score TOXIC.
- **Fee regimes to compare:**
  1. Flat 30 bps (baseline)
  2. Fairway tiers (scores learned from a warm-up period, then applied)
  3. Fairway worst case: arbitrageurs rotate wallets, so they always pay STANDARD
  4. Optional: flat 5 bps and flat 80 bps for context

**Metrics per regime:** LP fee revenue (split by tier), arbitrage profit (LVR proxy), LP net PnL (fees − LVR proxy, and vs. HODL), retail average execution cost (fee + price impact vs. CEX mid) in bps, mean and p95 absolute pool-vs-CEX deviation in bps (staleness), and volume by agent type.

**Parameter sweep:** toxic fee ∈ {30, 50, 80, 100, 150} bps × retail fee ∈ {5, 10, 20} bps. Output a JSON grid for the frontend's interactive backtest page. Also output a "recommended" parameter set (maximizes LP net PnL subject to retail cost ≤ baseline and p95 staleness ≤ a configurable bound), and explain the trade-off in `docs/ECONOMICS.md`.

**Historical replay mode:** given recorded swaps (fixtures or real backfill JSONL), re-price each trade under each fee schedule. This is a static counterfactual: document that behavior changes are not modeled in replay, which is why the agent-based sim exists.

**Outputs:** `packages/sim/out/*.json` consumed by the frontend, plus `scripts/export-charts.ts` producing SVG/PNG charts for the README and pitch.

---

## 5. Onchain program (`programs/fairway`, Anchor)

### 5.1 Accounts
- `Config` (PDA `["config"]`): `admin`, `score_authority`, `fee_bps: [u16; 3]` (RETAIL, STANDARD, TOXIC), `default_tier`, `score_ttl_slots`, `bump`.
- `Pool` (PDA `["pool", base_mint, quote_mint]`): mints, vault token accounts (PDAs owned by the pool), `lp_mint`, cumulative fees per tier, `bump`s.
- `TraderScore` (PDA `["score", trader]`): `trader`, `tier: u8`, `score_bps: i32`, `trades: u32`, `updated_slot: u64`, `bump`.

### 5.2 Instructions
- `initialize_config`, `update_config` (admin only)
- `create_pool`, `add_liquidity` (first deposit locks `MIN_LIQUIDITY = 1000` LP units), `remove_liquidity`
- `swap(amount_in, min_amount_out, a_to_b)`: the fee tier comes from the `TraderScore` PDA **derived from the swap signer**. If it is missing, stale (`current_slot − updated_slot > ttl`) or invalid, use STANDARD. **Critical security property: a bot must not be able to pass someone else's RETAIL score.** Enforce the seeds, and write a test for it.
- `set_score(tier, score_bps, trades)` (score_authority only), plus `set_scores_batch` via `remaining_accounts` (up to ~10 per tx)
- `close_score` (authority or trader)
- Emit an Anchor event `SwapExecuted { trader, pool, a_to_b, amount_in, amount_out, fee_bps, tier }`, so Streams/indexers can parse Fairway swaps easily.

### 5.3 Math (`crates/fairway-math`, pure Rust, used by the program)
- Constant product with the fee taken on input: `out = (in_after_fee * reserve_out) / (reserve_in + in_after_fee)`, using u128 checked math, rounding in the pool's favor.
- LP mint/burn math with proportional shares. No floats onchain.
- Exhaustive unit tests and property-style tests (invariant k never decreases, no overflow at extremes).

### 5.4 Tests
Use LiteSVM or anchor-bankrun for fast tests if available; otherwise use `anchor test` with a local validator. Cover: the full happy path; fee per tier; the wrong-signer score attack (must use STANDARD or fail); stale score → STANDARD; slippage failure; unauthorized `set_score`; first-deposit edge cases; remove_liquidity proportionality.

### 5.5 Program IDs
Run `anchor keys sync`. Put local and devnet IDs in `README.md` (devnet marked "TBD: fill after deploy" until the human deploys).

### 5.6 Fallback if the Solana/Anchor toolchain cannot be installed
Still write the full Anchor program code. Make `crates/fairway-math` and all logic testable with plain `cargo test`. Make the frontend and SDK work in mock mode. Log it in `DECISIONS.md` and in `docs/SETUP_REMAINING.md` ("run `anchor build && anchor test` locally"). Do not stop the project over this.

---

## 6. Parser and Streams filter (`packages/parser`, `streams/`)

**Goal:** turn raw Solana blocks (the shape of the `getBlock` RPC response with full transactions and meta) into `Swap` records for a configured set of pools.

**Algorithm for each non-failed transaction:**
1. Build the full account key list: `transaction.message.accountKeys` (these may be strings or objects with `pubkey`; handle both) **plus** `meta.loadedAddresses.writable` then `meta.loadedAddresses.readonly` (address lookup tables).
2. For each configured pool, look up its base and quote vault accounts. Compute vault deltas from `meta.preTokenBalances` / `meta.postTokenBalances` (matched by `accountIndex`, using `uiTokenAmount.uiAmountString` or amount/decimals).
3. If the base vault decreased and the quote vault increased, the trader **bought** base. The reverse means **sell**. Ignore cases where both moved the same direction (liquidity changes).
4. `trader` = first account key (the fee payer). `execPrice = |quoteDelta| / |baseDelta|`. Note: for pools charging the fee in input, pre-fee price ≈ adjusted by the pool's known fee; document the approximation.
5. For Fairway's own pool, prefer the decoded `SwapExecuted` event from the log messages when available.

**`streams/filter.js`:** a self-contained QuickNode Streams filter (`function main(stream) { ... }`, data in `stream.data`, an array of blocks), with the pool config inlined at the top. It returns `{ swaps: [...] }` (compact records only) or `null` when there are no matches. No imports, because Streams filters must be standalone JS. Keep its logic identical to `packages/parser` (share the code via a build step that inlines it, or duplicate it with a test asserting identical output).

**Fixtures:** generate realistic `getBlock`-shaped JSON blocks (including loadedAddresses cases, failed txs, liquidity adds and non-matching txs) in `packages/fixtures`, and test both the parser and `filter.js` against them.

**`streams/STREAM_CONFIG.md`:** exact dashboard steps. Chain: Solana, network: mainnet (scores and backfill) and devnet (Fairway pool), dataset: Block, start block or backfill window, filter: paste `filter.js`, destination: webhook `https://<your-host>/streams/solana` with a security token, plus how to backfill a few hours of one real SOL-USDC pool. Placeholders for real pool vault addresses, with instructions on how to find them (e.g., from Raydium/Orca pool pages or explorers).

---

## 7. Services

### 7.1 `services/ingest` (Fastify)
- `POST /streams/solana`: accepts filter output (or raw blocks, then runs the parser), verifies an optional shared-secret header (`QN_STREAM_TOKEN`), and upserts swaps into SQLite (idempotent on `sig + pool`).
- `POST /recompute`: recomputes markouts and tiers for affected wallets using `packages/scoring`.
- `GET /wallet/:address`, `GET /pool/:id/stats`, `GET /health`.
- `DATA_MODE=fixture` seeds the DB from fixtures at boot, so everything works offline.

### 7.2 `services/keeper`
- Diffs DB tiers against onchain `TraderScore` accounts (or a local mirror in dry-run) and sends `set_scores_batch` transactions.
- `KEEPER_MODE=dry-run` (default) logs the exact intended instructions to `services/keeper/out/`. `local` targets the local validator. `devnet` needs `RPC_URL` and `KEEPER_KEYPAIR`.
- Rate limiting, retries, and a summary log line per batch.

---

## 8. Frontend (`apps/web`, Next.js App Router + Tailwind)

**Mock mode by default** (`NEXT_PUBLIC_MODE=mock`): served from fixture data and sim outputs through API routes. No wallet or RPC needed. Include a **demo persona switcher**: "Retail Rita" (RETAIL), "New wallet" (STANDARD), "Arb Bot 7" (TOXIC). Live mode uses the Solana wallet adapter plus the SDK against local or devnet.

**Pages:**
- `/`: landing. One-line pitch, the problem in three bullets, headline backtest numbers (LP net PnL vs. flat fee, retail cost saved), and CTAs.
- `/swap`: swap form (SOL↔USDC). Shows **your tier and why** (markout history mini-chart, trade count), your fee vs. the standard 30 bps, the quote, and a confirm step. In mock mode, simulate execution and update reserves.
- `/wallet/[address]`: score explorer. Trades table, markout distribution, tier timeline, "how this score is computed."
- `/pool`: LP dashboard. Reserves, volume and fees by tier, LVR proxy, LP PnL vs. HODL.
- `/backtest`: interactive. Sliders for toxic and retail fee (snapping to the sweep grid) update charts for LP PnL, retail cost and staleness across all regimes, including the wallet-rotation worst case. Highlight the recommended parameters.
- `/how-it-works`: architecture diagram (Streams → filter → ingest → scoring → keeper → program → swap), the anti-gaming argument, and the risk trade-offs.

**Design:** clean, modern, credible fintech, not a generic template. Pick a distinctive but restrained palette, good typography, dark mode, responsive, and charts that are easy to read (Recharts or similar). Use a small persistent "Simulated data" badge in mock mode. Clear empty, loading and error states.

---

## 9. Documentation (judges read these)

- **`README.md`:** what it is; the problem; how it works; what makes it unique; what's next (these mirror the Devpost questions); architecture (mermaid); tech and sponsor tools; **economic design**; **risk assumptions**; **how we use Solana**; **program IDs table**; **QuickNode Stream configuration (network, dataset, filter logic, destination, and why)**; quick start (`pnpm i && pnpm demo`); test commands; what is simulated vs. live; repo map.
- **`docs/ECONOMICS.md`:** fee tiers, shrinkage, the anti-gaming argument (fresh wallets ≥ STANDARD; faking retail history requires losing markout, which is expensive), the staleness trade-off and how the parameters were chosen from the sweep, with charts.
- **`docs/RISKS.md`:** score-oracle trust (mitigations: TTL, transparency of inputs, future ZK proofs of history), Sybil and wallet rotation, aggregator routing (the signer is the end user), data-quality and parser edge cases, liquidity fragmentation, regulatory note, smart-contract risk (unaudited).
- **`docs/PITCH.md`:** a 5-minute pitch script plus **15 likely judge questions with crisp answers** (e.g., "Can't bots just use new wallets?", "Doesn't a higher bot fee make the pool price staler?", "Who runs the oracle?", "Why Solana?", "Why Streams vs. polling RPC?", "How is this different from dynamic volatility fees or Uniswap v4 hooks?").
- **`docs/DEMO_SCRIPT.md`:** a 2–3 minute video script, shot by shot, with what to click.
- **`docs/SETUP_REMAINING.md`:** the human's checklist for the final ~10%, as exact commands and clicks: create a QuickNode account and redeem the hackathon plan; create the Stream from `STREAM_CONFIG.md`; expose ingest (e.g., a tunnel) and set the webhook; fill real pool vault addresses; `anchor build && anchor deploy --provider.cluster devnet`; fund keypairs from the faucet; set env vars; run the keeper in devnet mode; record the video; fill Devpost (DeFi track, Best use of Solana, QuickNode bounty); and attend in person on Saturday.

---

## 10. One-command demo

`pnpm demo` must, with zero external accounts: generate fixtures (if missing), run the sim and sweep (if outputs are missing), start ingest in fixture mode and start the web app in mock mode, then print the URL. Also add `pnpm test` (all packages), `pnpm build`, `pnpm lint`, and `pnpm demo:local` (local validator + deploy + seed + live mode), with graceful errors if the toolchain is missing.

---

## 11. Milestones (copy into PROGRESS.md and work top to bottom)

- [ ] **M0 Setup:** toolchain detection and installs, monorepo scaffold, lint/format, CI-style `pnpm test` script, PROGRESS.md, DECISIONS.md, .gitignore, .env.example
- [ ] **M1 Scoring package:** types, markout, shrinkage, tiers, MidPriceProviders, tests green
- [ ] **M2 Fixtures:** deterministic generator (agents, CEX path, swaps, getBlock-shaped blocks incl. edge cases)
- [ ] **M3 Simulator and backtest:** regimes, metrics, sweep grid, recommended params, chart export
- [ ] **M4 Math crate and Anchor program:** accounts, instructions, events, security checks, tests green (or the Section 5.6 fallback)
- [ ] **M5 SDK:** PDAs, instruction builders, account decoders, typed errors, tests
- [ ] **M6 Parser and Streams filter:** shared logic, filter.js, tests against fixtures, STREAM_CONFIG.md
- [ ] **M7 Ingest service:** webhook, SQLite, recompute, read APIs, fixture mode, tests
- [ ] **M8 Keeper:** diffing, batching, dry-run/local/devnet modes, tests
- [ ] **M9 Frontend:** all pages, mock mode, persona switcher, backtest interactivity, polished design
- [ ] **M10 Live wiring:** wallet adapter, SDK calls against the local validator, `pnpm demo:local`
- [ ] **M11 Docs:** README, ECONOMICS, RISKS, PITCH, DEMO_SCRIPT, SETUP_REMAINING, charts embedded
- [ ] **M12 Hardening pass:** full test, build and lint; fresh-clone check (`git clone . /tmp/fw && cd /tmp/fw && pnpm i && pnpm test && pnpm build`); fix everything; final review of the UI for bugs and polish; README accuracy check

After M12, do a final self-review against Section 12, fix any gaps, then write `STATUS: DONE`.

---

## 12. Definition of Done

- [ ] `pnpm i && pnpm test && pnpm build` pass from a fresh clone
- [ ] `pnpm demo` runs the full product offline with simulated data
- [ ] Anchor program compiles and its tests pass (or the documented fallback, with all math tested via cargo)
- [ ] The wrong-signer score test exists and passes
- [ ] The backtest shows all regimes, including the wallet-rotation worst case, with charts in the README
- [ ] `streams/filter.js` is standalone, tested, and documented in STREAM_CONFIG.md
- [ ] Ingest + scoring + keeper work end to end in fixture/dry-run mode
- [ ] Every frontend page works in mock mode, with a "Simulated data" badge and a responsive, polished UI
- [ ] README covers: problem, solution, uniqueness, next steps, architecture, economic design, risks, how Solana is used, program IDs table, Stream config
- [ ] PITCH.md (with 15 Q&As), DEMO_SCRIPT.md and SETUP_REMAINING.md are complete and specific
- [ ] All work committed locally; no secrets in git
- [ ] PROGRESS.md starts with `STATUS: DONE`
