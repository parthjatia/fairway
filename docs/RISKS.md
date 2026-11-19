# Risks and mitigations

**The program is unaudited and was only tested with LiteSVM and unit tests. Do not use real funds.**

Launch-specific risks (M16) are in [§1d TWAP manipulation](#1d-pool-twap-as-the-markout-price-launch-tokens-m16) and [§10](#10-launch-specific-risks-m16): fresh-wallet Sybils, bundlers, unverified Pump.fun program IDs, false TOXIC labels, memecoin perception and launch configuration.

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

### 1c. Protocol fee, bot-tax rebate, treasury and rent sponsorship
- **Rebate budget.** `update_retail_fee` is permissionless and sets the RETAIL rebate from the previous epoch's toxic premium; swaps enforce a hard budget (`share × premium`), so the rebate cannot exceed what bots paid, up to one token unit of rounding per swap. Risks: (a) it is a transfer from LPs to retail (about $40/day per 10% share on the simulated pool), which `rebate.share_bps` (admin, 0–100%) controls; (b) the epoch is only rolled when someone calls it, so a stale rebate keeps applying until its budget is used up; (c) a wallet that games its way into RETAIL gets the rebate, so the RETAIL rules matter; (d) the premium is measured with the pool's spot price for base-in swaps, an approximation. The `update_config` authority can change the epoch length, share and floor.
- **Protocol share (15% of the toxic premium by default, max 50%).** It is taken from the premium bots pay, which would otherwise go to LPs, so it lowers LP returns in every comparison (the backtest shows LP PnL before and after it). An admin can raise it to 50% with one `update_config`; the cap and the admin key's custody are the controls. Treat the admin as a multisig in any real deployment.
- **Accounting.** Unclaimed protocol fees sit in the pool vaults but are excluded from the reserves used for pricing and LP shares (`Pool.protocol_owed_*`). A bug in that exclusion would misprice swaps or LP withdrawals; it is covered by `protocol_share_accrues_excluded_from_reserves_and_is_claimable`.
- **Rent sponsorship can be drained.** Anyone can create score accounts by swapping from fresh wallets, and the treasury pays each one's rent (about 0.0023 SOL) while it has SOL. Cost to an attacker: swap fees plus tx fees per wallet. Cost to the protocol: the rent, refunded only if that wallet closes its account. Mitigations: the treasury never goes below its rent-exempt minimum, an empty treasury falls back to trader-pays, and the amount at risk is whatever the operator chooses to fund. A per-pool or per-day sponsorship cap is future work.
- **Closing refunds the sponsor.** `close_score` sends rent to the treasury for sponsored accounts, so a trader cannot pocket sponsored rent.
- **Per-pool oracle.** Each pool has its own Pyth account and feed id (set by the admin). A wrong feed id would score trades against the wrong asset, so `set_pool_oracle` is admin-only and the settle path checks address, owner, feed id, staleness and confidence. A pool with no oracle builds no onchain evidence, unless it is a launch pool (M16), which is scored against its own TWAP (§1d).
- **Price scale.** Prices are 1e12 fixed point. A price below about 1e-12 USD per token, or a quote amount above about 3e11 USDC in one swap, cannot be represented; such a swap still executes but is not queued for scoring (it is counted as dropped).

### 1d. Pool TWAP as the markout price (launch tokens, M16)
A new token has no Pyth feed. Launch pools (`configure_launch`) therefore score trades against the pool's **own** time-weighted price: a price × slots accumulator in the `Pool` account, updated on every swap and liquidity change, with 64 observations at least 8 slots apart (≥ 512 slots of history). `settle_markout` uses the TWAP over the 25 slots (`Config.launch.twap_window_slots`) that end at trade slot + 75.
- **Manipulation risk.** An attacker can move the pool price around t+75 to distort someone's markout: push it **up** to make an honest buyer look informed (TOXIC, higher fees), or push it **down** to make their own sniper buys look uninformed (to escape TOXIC).
- **Mitigations.**
  - *TWAP window.* The price has to be held for the whole 25-slot window (~10 s), not one slot. Several swaps in one slot count only the last price, so a move inside one slot that is reversed in the same slot has no effect (tested in `fairway-math`).
  - *Cost of moving the price.* Holding the price x% away for 10 s means someone else can trade against the attacker at that price. Each push-and-revert also pays the launch fee twice. A fresh attacker wallet pays the STANDARD curve (300 bps at block 0), and a known sniper pays up to 1,000 bps.
  - *Shrinkage and thresholds.* One distorted trade barely moves a score: K = 2,000 USDC of prior notional, a ±100% clamp per trade, and ≥ 5 settled trades before the tier changes. To mislabel a wallet, the attacker would have to repeat the attack across most of that wallet's trades.
  - *Own impact is not information.* On TWAP pools the reference price is the **post-trade** pool price, not the execution price, so a large honest buy that only moves the price itself scores ~0 (tested: `twap_scoring_of_a_price_that_did_not_move_is_zero`).
  - *Bounded damage.* A wrongly TOXIC wallet pays the TOXIC fee. It never loses funds.
- **Approximation.** Between observations the accumulator is interpolated linearly. The result is exact when the price did not change between two observations, and otherwise off by at most the price change inside one ≤ 8-slot gap.
- **Not modelled / future.** Multi-block manipulation by a validator-colluding attacker; using the median of several windows; switching a graduated token to an external oracle once one exists (`set_pool_oracle` already does that: a pool with an oracle uses Pyth, not the TWAP).

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

## 10. Launch-specific risks (M16)

### 10a. Fresh-wallet Sybils at launch
A sniper who has never sniped before, or who uses a new wallet for every launch, has no score. It pays the **STANDARD curve (300 → 30 bps)**, which is exactly the time-decay anti-sniper fee used today. Fairway is therefore never worse than time-decay against unknown snipers, but it is not better either. In the simulation's worst case (every sniper on a fresh wallet), snipers take the same 49% of the window supply as under time-decay. Humans with history still pay 94 bps instead of 200.
- *Why rotation is costly at launch:* the snipers that matter are repeat players who need fast, funded, pre-positioned wallets. Rotating means funding a new wallet for every launch from somewhere, and that funding trail is public (see 10b).
- *Why fresh wallets can't get a discount:* RETAIL needs ≥ 5 scored trades with near-zero markout and ≥ 3 days of history. Building that on many wallets costs time and real trading losses (spread and fees) per wallet.

### 10b. Bundlers
A bundler buys the first slots through several fresh wallets in one bundle (in the sim: ~$6k over 3–8 wallets in half the launches). Each wallet is new, so each pays STANDARD. **Not detected today.** The sniper scorer looks at each wallet's history across launches, not at who funded it. Future work: funding-graph features (wallets funded from one source shortly before a launch inherit that source's tier), a per-launch cap on STANDARD-tier buys in the first N slots, and Jito-bundle awareness. The fee payer is the trader in our parser, so a bundle with one fee payer for many buyers is attributed to that payer.

### 10c. Unverified program IDs and account layout
`streams/pumpfun-filter.js` matches Pump.fun (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`) and PumpSwap (`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`). **Both are marked VERIFY: they were written from memory and have not been checked onchain in this repo.** The filter also assumes the account layout: Pump.fun keeps SOL as lamports in the bonding-curve account, and PumpSwap pools hold WSOL in a token account. It was tested on synthetic blocks only. If a program ID is wrong, the filter matches nothing (fail-closed: no false TOXIC labels). If the layout differs, trades may be mis-sized. Checking steps are in `streams/STREAM_CONFIG.md` §Pump.fun. Run the dashboard's "Run test" on a known Pump.fun slot before trusting the scores.

### 10d. False TOXIC labels on humans
A human who happens to buy early in three or more launches that then pump could be labelled TOXIC. Mitigations: the ≥ 3 distinct launches rule, a 500 bps shrunk-score threshold with K = 5 SOL of prior notional (small early buys barely move it), the keeper's TTL (a label expires unless refreshed), and onchain-verified scores taking over once a wallet has settled flow on Fairway. The damage is bounded: a higher fee during the launch window, never lost funds.

### 10e. Memecoin perception and launch abuse
Launches are mostly memecoins, and some are scams (rug pulls, honeypots). Fairway changes **who pays the launch fee**. It does not vet tokens, and a fair distribution does not make a token a good investment. The UI and docs should say so. The 0.05 SOL launch fee adds a small cost to spam launches. A creator can also be the sniper (buying through fresh wallets): that is the 10a/10b case, and the creator's own wallet pays its tier like anyone else.

### 10f. Launch configuration
`configure_launch` can only run before the first swap, and only by the pool creator or the admin. The window is capped (216,000 slots ≈ 1 day), and curves are validated (`valid_launch_curve`: start ≥ end per tier, every fee ≤ 1,000 bps, and RETAIL ≤ STANDARD ≤ TOXIC at both ends). A creator could still choose a hostile curve within those bounds (for example 1,000 bps for every tier). The fee schedule is public in the pool account and shown in the UI before anyone buys, and the launch view shows the current fee per tier.
