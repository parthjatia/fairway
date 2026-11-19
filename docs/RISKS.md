# Risks and mitigations

**The program is unaudited and was only tested with LiteSVM and unit tests. Do not use real funds.**

## 1. Score-oracle trust
The `score_authority` (a keeper key) writes `TraderScore` accounts. A compromised or malicious oracle could mark bots RETAIL (LPs lose fees) or retail TOXIC (users pay more).
- **Bounded power.** The oracle chooses a tier only. The fees come from `Config`, which only the admin can change. It cannot move funds.
- **TTL.** Scores older than `score_ttl_slots` are ignored, so a dead oracle degrades the pool to flat STANDARD pricing, never to a wrong tier.
- **Transparent inputs.** Scores are computed from public swaps with open code. Anyone can recompute and compare with the onchain account. The wallet explorer shows each trade's markout.
- **Future:** multiple oracles with a quorum, a bonded oracle, or ZK proofs of the computation over a committed history.

## 2. Sybil and wallet rotation
Bots can create fresh wallets. These pay STANDARD (30 bps), not RETAIL, so rotation never lowers a bot's fee below the flat baseline. The cost is that rotating bots escape the TOXIC surcharge, and the sim shows LPs then fund the retail discount (see ECONOMICS §4).
- **Sleeper attack.** A wallet builds a clean RETAIL record, then trades informed flow. Defenses: short TTLs, frequent refresh, downgrade-first keeper ordering (TOXIC writes go first), and, as future work, per-wallet notional limits for RETAIL fees.
- **Not modelled:** bots that spread across hundreds of aged wallets over weeks.

## 3. Aggregator routing
The signer is the end user, and the tier follows the signer. Aggregator programs that sign with a shared PDA/authority would collapse many users into one wallet. We have not tested Jupiter integration. Routers that sign as the user work as intended.

## 4. Data quality and parser edge cases
- External-venue execution prices are approximated using a configured pool fee (CLMM and dynamic-fee pools vary).
- Multi-hop or multi-pool transactions: each configured pool is evaluated separately by vault deltas. Atomic arbs across two venues appear as two swaps, which is intended.
- Matching is by vault balance deltas, so liquidity actions are ignored by direction, but unusual transactions (e.g. a swap and a deposit in the same transaction) can be misclassified.
- The Raydium vault addresses in `pools.config.json` were entered from memory and **must be verified**.
- Markouts use the pool-implied mid in live mode. It is noisy for illiquid pools, and Pyth support is only a stub.

## 5. Liquidity fragmentation
A new AMM with tiered fees splits liquidity. Retail benefits only if it can reach Fairway through its frontend or an aggregator. LPs need a reason to deposit. The design depends on retail volume being large relative to informed volume.

## 6. Model risk
The backtest is synthetic. In it, Fairway reduces retail cost and LVR, but **LP net PnL is below flat 30 bps** (ECONOMICS §4). Real behaviour (searcher competition, retail elasticity, venue routing) may differ in either direction.

## 7. Privacy and regulatory
Tiers are derived from public data, but they label wallets. Labeling wallets as "toxic" or "retail" could raise fairness, privacy or regulatory questions (e.g. discriminatory pricing). This is a hackathon prototype and not legal advice. A production deployment would need review.

## 8. Smart-contract risk
Unaudited. Known simplifications: `MIN_LIQUIDITY` is tracked as virtual supply, `close_score` rent returns to the score authority, and `set_scores_batch` creates PDAs manually. The wrong-signer, stale-score, slippage and unauthorized-write cases have tests. Fuzzing and an external audit are future work.

## 9. Operational
The ingest webhook must be reachable. Stream retries and the `(sig, pool)` idempotency cover short outages. The keeper defaults to dry-run and refuses devnet mode without `RPC_URL` and `KEEPER_KEYPAIR`.
