# Risks and mitigations

**The program is unaudited and was only tested with LiteSVM and unit tests. Do not use real funds.**

## 1. Score-oracle trust
The `score_authority` (a keeper key) writes the **bootstrap** fields of `TraderScore` accounts. A compromised or malicious keeper could mark bots RETAIL (LPs lose fees) or retail TOXIC (users pay more), **but only for wallets without enough onchain evidence**.
- **Onchain verified scores (M13).** The program scores Fairway trades itself: `swap` queues each trade, and a permissionless `settle_markout` marks it out against Pyth after 75 slots. Once a wallet has ≥ 1,000 USDC (`onchain_min_notional`) of settled notional and ≥ 5 settled trades, the onchain tier is used and keeper writes cannot change that wallet's fee. The keeper also cannot close an account that holds onchain evidence (tested), so it cannot wipe a verified score and replace it.
- **What is still trusted.** (a) The keeper, for new wallets and for history on other venues. (b) Pyth, for the mid price. The program checks the account address (from `Config`), the owner (Pyth receiver), the discriminator, `VerificationLevel::Full`, the feed id, staleness (≤ 60 s) and confidence (≤ 0.5%). It only uses a price posted after the trade's horizon. (c) The admin, who sets the oracle account and the thresholds in `Config`.
- **Bounded power.** The oracle chooses a tier only. The fees come from `Config`, which only the admin can change. It cannot move funds.
- **TTL.** Scores older than `score_ttl_slots` are ignored, so a dead oracle degrades the pool to flat STANDARD pricing, never to a wrong tier.
- **Transparent inputs.** Scores are computed from public swaps with open code. Anyone can recompute and compare with the onchain account. The wallet explorer shows each trade's markout.
- **Future:** multiple oracles with a quorum, a bonded oracle, or ZK proofs of the computation over a committed history (for the cross-venue bootstrap).

### 1b. Onchain scoring limits
- **Settlement liveness.** There is no crank reward in the MVP. Pending trades that nobody settles within `max_settle_slots` (450) expire unscored (`dropped_trades`). A bot that trades only when nobody cranks keeps its current tier, so the worst case is STANDARD, and the keeper's bootstrap score still applies. A small reward from protocol fees is future work.
- **Buffer limit.** Each wallet queues at most 4 unsettled trades. A 5th trade within the window is not scored and pays at least STANDARD (no RETAIL discount). High-frequency bots therefore escape the onchain TOXIC label for those trades but never get a discount, and the keeper still scores them.
- **Settlement timing.** A crank can choose when (within 75–450 slots) to settle, and thus which Pyth price to use. This adds noise up to about 3 minutes of price movement. It does not let anyone write into another wallet's score (the PDA must match the `trader` argument, tested). Stricter windows, or using Pyth's price at exactly t+h via a posted historical update, are future work.
- **Single horizon, single feed.** The onchain score uses one ~30 s horizon and the SOL/USD feed, and assumes the quote token is USD-pegged. The offchain scorer uses three horizons with an "all horizons" rule. A depeg of USDC would bias markouts.
- **Rent.** The first swap creates the trader's score PDA (about 0.003 SOL, refunded on `close_score`). A trader can close their own account. That wipes their onchain record and puts them back at STANDARD, which is the same as rotating wallets.

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
- Offchain markouts use the pool-implied mid in live mode. It is noisy for illiquid pools, and offchain Pyth support (`PythMidPrice`) is only a stub. The onchain score uses Pyth directly.

## 5. Liquidity fragmentation
A new AMM with tiered fees splits liquidity. Retail benefits only if it can reach Fairway through its frontend or an aggregator. LPs need a reason to deposit. The design depends on retail volume being large relative to informed volume.

## 6. Model risk
The backtest is synthetic. In it, Fairway reduces retail cost and LVR, but **LP net PnL is below flat 30 bps** (ECONOMICS §4). Real behaviour (searcher competition, retail elasticity, venue routing) may differ in either direction.

## 7. Privacy and regulatory
Tiers are derived from public data, but they label wallets. Labeling wallets as "toxic" or "retail" could raise fairness, privacy or regulatory questions (e.g. discriminatory pricing). This is a hackathon prototype and not legal advice. A production deployment would need review.

## 8. Smart-contract risk
Unaudited. Known simplifications: `MIN_LIQUIDITY` is tracked as virtual supply, `set_scores_batch` and `swap` create score PDAs manually, and the Pyth `PriceUpdateV2` layout is parsed by hand (no SDK dependency). `close_score` refunds rent to the trader. The wrong-signer, stale-score, slippage, unauthorized-write, wrong-trader settle, stale/invalid oracle and full-buffer cases have tests. Fuzzing and an external audit are future work.

## 9. Operational
The ingest webhook must be reachable. Stream retries and the `(sig, pool)` idempotency cover short outages. The keeper defaults to dry-run and refuses devnet mode without `RPC_URL` and `KEEPER_KEYPAIR`.
