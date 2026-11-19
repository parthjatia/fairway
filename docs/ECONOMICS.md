# Fairway economics

All numbers below come from the **synthetic** agent-based simulation in `packages/sim` (24 h, 60% vol, $3M TVL, 8 seeds). Regenerate with `pnpm sim`. They show the mechanism's trade-offs, not a forecast for mainnet.

## 1. Fee tiers

| Tier | Default fee | Who |
|---|---:|---|
| RETAIL | 5 bps | Wallets with ≥ 5 trades, ≥ 3 days of history and score ≤ 3 bps |
| STANDARD | 30 bps | Everyone else, **including every fresh wallet** |
| TOXIC | 80 bps | Wallets with ≥ 5 trades and score ≥ 10 bps |

The fee is charged on the input token and stays in the vault, so `k` never decreases. The score oracle chooses the *tier*. It cannot set a fee. The admin sets the three fees in `Config`.

**Protocol share.** `Config.protocol_fee_bps` (default 1,500 = 15%, max 5,000) of each swap fee is booked to the protocol (`Pool.protocol_owed_*`, rounded down so LPs keep the dust). It stays in the vault but is excluded from the reserves that price the curve and from LP shares, until `claim_protocol_fees` moves it to the treasury PDA's token accounts. LPs therefore keep 85% of fees by default. Every LP number below is shown before and after this share, because it comes out of the same pool the LP-vs-flat-30 comparison is about. A fee-free flat-30 reference pool is shown with LPs keeping 100%, which is the conservative comparison.

## 2. Score and shrinkage

`markout_bps = side × (mid(t+h) − execPrice) / execPrice × 10,000`, using the pre-fee price. `score = Σ(notional·markout) / (Σ notional + K)`, `K = 2,000`.

Shrinkage matters for two reasons:

- **A single large lucky trade** has little weight against a prior of K notional. A wallet with one $50k trade is capped by `trades ≥ 5`, and its score is still averaged against the prior.
- **Small histories** are pulled toward 0, which means "not toxic". Because RETAIL also needs ≥ 5 trades and ≥ 3 days, a short history cannot earn a discount through the prior alone.

In the warm-up of the simulation (4,238 swaps over 72 h), the classifier gave: all 3 arbitrageurs and all 3 snipers → TOXIC; of 300 retail wallets, 145 → RETAIL, 154 → STANDARD, 1 → TOXIC (a false positive). 75% of retail wallets were classified, and the unclassified ones paid STANDARD, which is the safe failure mode.

## 3. Anti-gaming argument

- **Fresh wallets are never cheaper than STANDARD.** A bot that rotates wallets to dodge the TOXIC fee gets 30 bps, never 5. This is the key asymmetry: the default is the middle tier, not the cheap one.
- **Faking RETAIL is expensive.** To reach RETAIL a wallet must trade ≥ 5 times over ≥ 3 days with a volume-weighted markout ≤ 3 bps. A bot doing that has to trade like an uninformed user, or lose money on purpose (negative markout) to build the record, and then hope to earn the discount back on its informed trades. The shrinkage prior means a few informed trades after a long clean history shift the score only gradually, so the oracle should refresh scores often and TTLs should be short. This is a real attack surface: a "sleeper" wallet that builds RETAIL status and then trades informed flow once or twice before being re-scored. The TTL, refresh cadence and per-wallet notional caps are the defenses and are not fully solved (see RISKS.md).
- **Onchain verified scores.** For Fairway's own flow the program computes the score itself against Pyth (same formula, K and thresholds, one 30 s horizon). Once a wallet has 1,000 USDC and 5 trades of settled flow, keeper scores no longer apply. A bot can't buy a RETAIL label from a compromised keeper, and it can't hide trades: a full pending buffer means no RETAIL discount.
- **Wrong-signer attack.** A bot cannot pass someone else's RETAIL account: the `trader_score` account must match `["score", signer]`. Tested in `programs/fairway/tests/fairway.rs::wrong_signer_cannot_use_someone_elses_retail_score`.

## 4. What the simulation says

Per day, mean of 8 seeds, 24 h, 60% vol, $3M pool. **LP PnL vs HODL** is the complete LP result (reserves plus fees at the final CEX price, minus holding the initial reserves). It already contains every loss to arbitrageurs and snipers, so it is the LVR check: "fees − arb profit" alone ignores sniper losses and rebalancing. The protocol keeps `protocol_fee_bps` (15%) of swap fees, so LPs keep the rest; the flat-30 reference pool is shown with LPs keeping 100%.

| Regime | LP fees | Arb profit | LP PnL vs HODL | LP PnL after protocol share | Retail cost | Mean / p95 staleness (bps) |
|---|---:|---:|---:|---:|---:|---:|
| Flat 30 (reference) | $1,528 | $132 | $644 | $644 | 34.8 bps | 17.1 / 31.6 |
| Fairway 5/30/80 (demo fees) | $1,070 | $36 | $191 | $30 | 16.7 bps | 44.3 / 79.9 |
| Fairway 20/30/200 (sweep pick) | $1,529 | $13 | $718 | $489 | 27.6 bps | n/a / 196 |
| Fairway 5/30/80, arbs rotate | $1,035 | $132 | $148 | −$7 | 16.3 bps | 17.1 / 31.6 |
| Flat 5 | $579 | $642 | −$311 | −$398 | 9.6 bps | 4.0 / 8.5 |
| Flat 80 | $2,903 | $35 | $2,033 | $1,597 | 85.2 bps | 44.2 / 79.8 |

Retail cost is the fee plus price impact versus the CEX mid, in bps (it includes the effect of a staler pool).

### Reading the table honestly

Question checked on 2026-11-19: *do LPs earn more than in a flat 30 bps pool while retail pays less?* **Not unconditionally.**

1. **Retail pays less, bots pay more.** At 5/30/80 retail saves 18 bps. Arbitrage profit falls 73% (90% at 20/30/200). Bots pay about $475/day more than the STANDARD fee on the same volume (the "extra fees from bots" number on `/pool`).
2. **The retail discount is paid by LPs.** In the sim, retail volume is about 5× the informed volume, so revenue lost on retail (30 → 5 bps) exceeds the extra from TOXIC (30 → 80 bps), and informed flow trades less when its fee is higher. At 5/30/80, LP PnL vs flat 30 is −$453/day (±66). Rule of thumb on this pool: ~$20/day per bp of retail saving.
3. **A high toxic fee closes the gap at a price.** At 20/30/200, LP PnL vs flat 30 is +$74/day before the protocol share (±214, not statistically different from 0) and −$155/day after it. Retail saves 7.1 bps. The price is staleness: p95 deviation 196 bps vs 32 bps, because arbs wait for a larger gap before trading.
4. **Versus a low flat fee, Fairway is much better for LPs.** A flat 5 bps pool (similar retail cost) loses money after LVR. 5/30/80 gives LPs about $500/day more than flat 5.
5. **Rotation worst case.** If arbs rotate wallets they pay STANDARD: same profit, same staleness as flat 30, and retail still gets its discount. LPs bear that (−$496/day vs flat 30 at 5/30/80, −$196 at 20/30/200). Raising STANDARD to 40–50 bps narrows it (below) but makes fresh wallets pay more than the baseline.

### Elasticity (an assumption, labeled)

Retail arrival rate × (1 + e·(30 − fee)/30) / (1 + e): at `e = 1`, a wallet paying 15 bps instead of 30 trades ~33% more. Real elasticity depends on aggregator routing and is unmeasured here. LP PnL vs flat 30 per day, **before / after** the 15% protocol share (`sensitivity.json`, `sensitivity-recommended.json`; 4 seeds):

| Retail elasticity | 5/30/80 | 20/30/200 |
|---|---:|---:|
| 0 | −$527 / −$673 | +$127 / −$104 |
| 0.25 | −$386 / −$547 | +$184 / −$54 |
| 0.5 | −$417 / −$567 | +$132 / −$92 |
| 1 | −$293 / −$466 | +$339 / +$79 |

Elasticity-labeled sweeps are in `sweep-elastic.json` (e = 0.5 and 1; every toxic × retail cell with LP-vs-flat-30 before and after the protocol share, retail saving and staleness). With e = 1 the sweep pick moves to 10/30/200. LPs beat flat 30 after the protocol share only in the high-toxic-fee, e ≥ 1 corner.

Other sensitivities (5/30/80 → 20/30/200 LP vs flat 30, before protocol share): informed flow ×0.25: −$416 → +$233; ×2: −$585 → +$66; ×4: −$855 → −$202. More informed flow hurts: it is filtered out by the high fee rather than monetized. STANDARD fee in the rotation case (5/30/80): 30 → −$513, 40 → −$469, 50 → −$409 (4 seeds).

## 5. Choosing the parameters

The sweep covers toxic fee ∈ {30, 50, 80, 100, 150, 200} bps × retail fee ∈ {5, 10, 15, 20, 25} bps (30 cells, 8 seeds each, STANDARD fixed at 30). The pick maximizes **LP PnL after the protocol's fee share** subject to:

- retail cost saved ≥ **5 bps** vs flat 30 (smaller savings are within noise), and
- p95 staleness ≤ **200 bps** (configurable). Staleness reaches users through retail cost, which is already measured, but a very stale pool price is also a risk for anything that reads it as an oracle.

Result: **toxic 200 bps, retail 20 bps** (24 of 30 cells pass). Nothing in the grid gives LPs more than flat 30 after the protocol share with a robust retail saving at elasticity 0, so the pick is the least costly one that still delivers a meaningful retail saving. The frontier is a transfer: every bp saved for retail costs LPs about $20/day unless toxic fees or volume make up for it.

![Sweep](charts/sweep.png)
![Frontier](charts/frontier.png)
![LP PnL](charts/lp-pnl.png)

The `/backtest` page lets you move both sliders and see every regime, including rotation.

## 6. Historical replay

`pnpm --filter @fairway/sim replay -- --input swaps.jsonl` re-prices recorded swaps under each fee schedule. It is a **static counterfactual**: the trades are held fixed and only re-priced, so it cannot show how bots or retail would change behaviour. That is why the agent-based simulation exists. Use the replay for real backfill data (`GET /export.jsonl` on ingest) to get a first estimate of how much of the real flow would land in each tier.

## 7. Limits of the model

- One pool, one synthetic CEX price (GBM plus jumps), constant retail demand.
- Retail is price-insensitive by default. Real retail can route to other venues, and aggregators would pick Fairway only when it is the best price.
- Arbitrageurs and snipers are simple. Real searchers use priority fees and Jito bundles.
- Markout horizons are fixed (30 s primary). Real toxic flow may have longer or shorter horizons.
