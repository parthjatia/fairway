# Architecture

```mermaid
flowchart LR
  subgraph Solana
    DEXs[Raydium · Orca · Meteora pools] --> BLK[Blocks]
    FW[(Fairway program)] --> BLK
  end
  BLK --> STR[QuickNode Stream<br/>Block dataset + filter.js]
  STR -->|webhook, HMAC| ING[services/ingest<br/>Fastify · SQLite]
  ING --> SCR[packages/scoring<br/>markout · shrinkage · tiers]
  SCR --> DB[(wallet_scores)]
  DB --> KEE[services/keeper<br/>diff · batch · retry]
  KEE -->|set_scores_batch| FW
  FW -->|TraderScore PDA → fee tier| SWAP[swap]
  ING --> WEB[apps/web]
  SIM[packages/sim] --> WEB
```

## Components

| Part | Role |
|---|---|
| `crates/fairway-math` | Pure Rust constant-product and LP math (u128, checked, rounds in the pool's favor). Tested with plain `cargo test`. |
| `programs/fairway` | Anchor program: `initialize_config`, `update_config`, `create_pool`, `add_liquidity`, `remove_liquidity`, `swap`, `set_score`, `set_scores_batch`, `close_score`. Emits `SwapExecuted`. |
| `packages/scoring` | Canonical `Swap` type, markouts, shrinkage score, tier rules, `MidPriceProvider`s (fixture, pool-implied, Pyth stub). |
| `packages/parser` | `getBlock`-shaped block → `Swap[]`. One self-contained file that is inlined into `streams/filter.js`. |
| `services/ingest` | Receives webhooks (filter output or raw blocks), stores swaps (idempotent on `sig + pool`), recomputes scores, and serves read APIs. |
| `services/keeper` | Diffs DB tiers with onchain scores and sends batched writes (TOXIC first). Dry-run by default. |
| `packages/sdk` | PDAs, instruction builders, account decoders, typed errors. Hand-written on web3.js, with the IDL checked in. |
| `packages/sim` | Seeded agent-based simulation, regimes, sweep, sensitivity, replay. |
| `apps/web` | Next.js app, mock mode by default, live mode with the wallet adapter. |

## Swap fee resolution (onchain)

1. `trader_score` must be the PDA `["score", signer]`. A mismatch fails the seeds constraint.
2. If settled onchain notional ≥ `config.markout.onchain_min_notional` and `trade_count` ≥ min(toxic, retail) min trades (5), use `onchain_tier` (source `Onchain`). Steps 3–5 are skipped.
3. If the account is empty, the wrong owner or the wrong size, use STANDARD.
4. If `current_slot − updated_slot > score_ttl_slots`, use STANDARD.
5. Otherwise read the bootstrap `tier`. An invalid tier maps to STANDARD.
6. If the 4-entry pending buffer is full, RETAIL is raised to STANDARD.
7. `fee = config.fee_bps[tier]`. Pricing uses LP reserves: `vault balance − Pool.protocol_owed_*`. The fee is taken from the input, and `out = in_after_fee × reserve_out / (reserve_in + in_after_fee)`.
8. Slippage check against `min_amount_out`. The protocol's share `floor(fee × protocol_fee_bps / 10_000)` is booked to `Pool.protocol_owed_*` / `protocol_earned_*` (LPs keep the rest). Then emit `SwapExecuted`.
9. If the pool has an oracle: create the score PDA if missing (rent paid by the treasury PDA when it holds more than its rent-exempt minimum plus the rent, else by the trader; flagged `sponsored`) and queue `{pool, exec_price (pre-fee, 1e12 fixed point), slot, side, notional}`.

## Onchain markout settlement

`settle_markout(trader)` is permissionless and takes a `pool`. It expires pending trades older than `max_settle_slots`. If any of that pool's trades is at least `markout_slots` old, it validates the Pyth `PriceUpdateV2` account (address and feed id from `Pool.oracle_*`, owner, discriminator, full verification, feed id, staleness, confidence), then, for each trade whose horizon is before the price's `posted_slot`: `markout = side × (mid − exec) × 10⁴ / exec` (clamped ±10,000), `Σn += n`, `Σn·m += n·m`. It then sets `onchain_score_bps = Σn·m / (Σn + K)` and `onchain_tier` from the same thresholds as `packages/scoring` (history = slots since the first trade). The math lives in `crates/fairway-math/src/markout.rs` and is mirrored in `packages/scoring/src/onchain.ts` (shared vectors).

## Data modes

| Mode | Prices | Source of swaps |
|---|---|---|
| `DATA_MODE=fixture` | Simulated CEX path | `packages/fixtures` |
| `DATA_MODE=live` | Pool-implied mid (Pyth stubbed) | Streams webhook |

## Why vault-based matching
The filter watches pool **vault token accounts**. Any swap that moves them is visible, regardless of the AMM's program, instruction layout, or whether a router (Jupiter) invoked it. The cost is that fees on external pools are approximated from config.
