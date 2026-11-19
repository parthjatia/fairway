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
2. If the account is empty, the wrong owner or the wrong size, use STANDARD.
3. If `current_slot − updated_slot > score_ttl_slots`, use STANDARD.
4. Otherwise read `tier`. An invalid tier maps to STANDARD.
5. `fee = config.fee_bps[tier]`. The fee is taken from the input, and `out = in_after_fee × reserve_out / (reserve_in + in_after_fee)`.
6. Slippage check against `min_amount_out`, then emit `SwapExecuted`.

## Data modes

| Mode | Prices | Source of swaps |
|---|---|---|
| `DATA_MODE=fixture` | Simulated CEX path | `packages/fixtures` |
| `DATA_MODE=live` | Pool-implied mid (Pyth stubbed) | Streams webhook |

## Why vault-based matching
The filter watches pool **vault token accounts**. Any swap that moves them is visible, regardless of the AMM's program, instruction layout, or whether a router (Jupiter) invoked it. The cost is that fees on external pools are approximated from config.
