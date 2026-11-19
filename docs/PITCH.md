# Pitch (5 minutes) and judge Q&A

**Note for the presenter:** every number comes from a synthetic simulation. Say so. Judges respect it. One line to land early: **"Fairway is bot-friendly: good bots pay less, extractive flow pays its fair share."**

## Script

**0:00 The hook (30 s).** "Every AMM charges the same fee to a retail user buying $100 of SOL and to a bot that is arbitraging the pool on information. LPs lose to those bots. It's called LVR, and Solana's 400 ms slots make it constant. Fairway charges bots more and humans less."

**0:30 The insight (45 s).** "Onchain history is public. For each past trade we can measure the *markout*: did the price move in the trader's favor over the next 30 seconds? Bots that trade on information have a consistently positive markout. Retail is near zero. So we score wallets and write the tier onchain."

**1:15 The mechanism (60 s).** Show `/how-it-works`. "Three tiers: retail and standard pay 30 bps, toxic pays 80, and proven-retail wallets get a rebate funded by part of the bot premium. A new wallet is STANDARD, never RETAIL, so rotating wallets doesn't help a bot. The swap derives the score PDA from the signer, so you can't borrow someone else's score. Shrinkage means one lucky trade doesn't move you."

**2:15 QuickNode Streams (45 s).** "Streams is our data layer. A Solana Block stream with a server-side filter turns blocks into swap records for Raydium, Orca and Fairway pools, matching on vault balance deltas. We backfill days of history so scores exist from day one, then keep them live through a webhook. Polling RPC for this would be thousands of calls an hour."

**3:00 Demo (75 s).** `/swap`: the "Same trade, two wallets" panel (Rita vs Arb Bot 7: the fee in dollars for the identical swap), then switch the pair to BONK-test. `/wallet/...`: the "Onchain verified" badge and the markout chart. `/pool`: "Extra fees earned from bots", the rebate to retail, protocol revenue. `/backtest`: the LP-first view with its noise bands, the protocol-share options, and the rotation worst case.

**4:15 Honest results and business model (30 s).** "Bots extract 73% less from LPs, and retail never pays more than a normal 30 bps pool, with a bot-tax rebate on top. Against a flat 30 pool, LPs are within noise before the protocol's share and about $56 a day behind after it; we searched for a setting that beats flat 30 beyond noise and there isn't one, and we say so. The protocol keeps 15% of the toxic premium only, nothing from retail, and the scores can be licensed to other DEXes."

**4:45 Close (15 s).** "Anchor program, Streams pipeline, scoring, keeper, and frontend all work end to end offline. Scores for Fairway flow are already computed onchain against Pyth. Next: devnet, a crank reward, multi-oracle for cross-venue history."

## 19 likely questions

1. **Can't bots just use new wallets?** They get STANDARD (30 bps), the same as a flat-30 pool. Rotation removes only the *surcharge*. In our worst-case simulation arbs keep their full profit and the pool behaves exactly like a flat 30 bps pool (no premium exists, so nothing is rebated and the protocol earns nothing). That is the floor, not a failure.

2. **Doesn't a higher bot fee make the pool price staler?** Yes. p95 deviation from the CEX goes from 32 bps to about 80 bps at the default 80 bps toxic fee (+67 bps at 100 bps, +163 at 200 bps). The default setting is chosen with a +50 bps p95 bound. Retail's execution cost already includes the effect, which is why retail still comes out ahead, but a very stale pool price is a risk for anything that reads it as an oracle.

3. **Who runs the oracle?** For trades on Fairway, nobody: the program computes the score itself. Every swap is queued in the trader's PDA, and after 75 slots (about 30 s) anyone can call `settle_markout`, which reads Pyth and applies the same markout, shrinkage and thresholds onchain. Once a wallet has 1,000 USDC and 5 trades of settled flow, that onchain tier wins and the keeper can't change it. The keeper only bootstraps new wallets from their history on other venues (via QuickNode Streams). Even there, its power is limited to choosing a tier, scores expire (TTL), and the inputs are public.

4. **Why Solana?** Fast slots make LVR frequent, which makes the problem worse. Cheap batched writes (10 scores per transaction), PDAs let us key the fee tier to the signer cheaply, and QuickNode Streams makes the Solana history queryable.

5. **Why Streams vs. polling RPC?** Backfill plus live in one pipeline, server-side filtering (KBs instead of block-sized payloads), ordered delivery with retries, and one filter that works on any AMM through vault deltas.

6. **How is this different from dynamic volatility fees or Uniswap v4 hooks?** Volatility fees charge everyone more in volatile markets, including retail. Hooks are a mechanism where one can implement it, but need an information signal. Fairway's contribution is the *signal*: a wallet-level, markout-based score kept fresh from a data pipeline, with an onchain check that ties it to the signer.

7. **Does the simulation show LPs make more than a flat 30 bps pool?** No, and we don't claim it. The default (retail and standard 30 bps, toxic 80, 10% of the toxic premium rebated to retail, protocol 15% of the premium) cuts arbitrage profit by 73% and keeps retail cost at or below a flat 30 pool (−1.0 ± 0.7 bps). LP PnL vs flat 30 is +$15 ± 33/day before the protocol share (within noise) and −$56 ± 31/day after it, on a $3M pool, from 16 paired seeds. We swept toxic 40–100 bps, rebate 0–50% and five protocol-share options for a setting that beats flat 30 beyond the noise band; none does, because the fees arbitrageurs used to pay shrink along with their profit. A 150–200 bps toxic fee looks better (+$154 to +$213/day before the protocol share) but is still inside its noise band and makes the pool 116–163 bps staler at p95, so it is not the default. If retail volume responds to fees (elasticity 0.5–1, an assumption) the result is still within noise. What you get is a large cut in LP losses to bots, retail never overpaying, and a small, measured cost to LPs. The earlier 5 / 30 / 80 design is kept as a variant, and it costs LPs about $450/day.

8. **What stops a "sleeper" wallet that builds a clean history, then trades informed?** TTL and frequent refresh, TOXIC writes first, and the shrinkage prior. It's not solved. Notional caps for RETAIL are future work. We list it in RISKS.md.

9. **What about aggregators like Jupiter?** The tier follows the signer. If the router signs as the user, it works. A router that signs with its own account collapses many users into one wallet, which we haven't tested.

10. **Isn't labeling wallets a privacy or fairness problem?** Scores use only public data, and the explorer shows the exact inputs. There are regulatory questions about differential pricing that a production deployment would need to review. We flag it in RISKS.md.

11. **How do you measure markout without a CEX price?** Fixture mode uses the simulated CEX path. Live mode uses the pool-implied mid from the stream itself (last trade). A Pyth provider is stubbed behind the same interface for a later upgrade.

12. **Why K = 2,000?** It's a prior of $2k notional at markout 0. It means a wallet needs a few thousand dollars of volume before its score is near its raw average. It is configurable.

13. **What if the oracle goes down?** Bootstrap scores go stale after `score_ttl_slots`, and those wallets pay STANDARD. Onchain verified scores don't depend on the keeper and don't expire. If Pyth is stale or too uncertain, `settle_markout` refuses to settle, trades stay pending (then expire unscored) and tiers just stop changing. The pool keeps working either way.

14. **Is the program secure?** It's unaudited. Math is u128 checked, rounding in the pool's favor, with the k-never-decreases property tested. The wrong-signer, stale-score, slippage and unauthorized-write tests pass. Don't use real funds.

15. **What's real and what's simulated?** Real: the program, the scoring, the parser and filter (tested against getBlock-shaped fixtures), the ingest, keeper and the SDK. Simulated: all market data and the backtest, and the UI says so. Not done: a live Stream, a devnet deployment. Those are the human's final steps (SETUP_REMAINING.md).

16. **How does the protocol make money?** `protocol_fee_bps` takes 15% of the **toxic premium only**: the part of a TOXIC swap's fee above what STANDARD would pay. That is about $72/day on the simulated $3M pool, paid entirely by flagged bots, and nothing from retail or standard fees. (We tested 15% of all fees too: it would cost LPs about $215/day, so it is not the default.) The share is booked per pool, excluded from LP reserves, and claimed by anyone into the treasury PDA. Another 10% of the premium goes back to retail as the bot-tax rebate, hard-capped by the premium collected. The next revenue line is licensing: other DEXes price flow with our scores (`getFeeTier`), through an API, an SLA, or a revenue share. That second part is not built. Honest caveat: premium-only revenue is small and disappears if bots rotate wallets (then LPs just have a plain 30 bps pool).

17. **Are bots banned? Doesn't this hurt market makers?** No. The fee depends on measured markout, not on whether the signer is a program. A market maker or hedging bot with no informed edge earns RETAIL pricing and a "Verified fair flow" badge. Only flow that consistently moves the price its way pays the TOXIC fee.

18. **Who pays for the score account?** Each wallet's first swap on a scored pool creates its `TraderScore` PDA, about 0.0023 SOL of rent. The protocol treasury pays it while it holds more SOL than its own rent-exempt minimum plus that rent, and the account is flagged so closing it refunds the treasury. If the treasury is empty, the trader pays. Sponsoring is an onboarding cost the protocol covers from its fee revenue, and a drained treasury just falls back to trader-pays.

19. **Why a second, memecoin pool?** Because it shows the mechanism where it bites: pumps and dumps give snipers a large markout, so they are scored TOXIC after 5–9 settled trades in the fixtures, while the same sniper stays STANDARD after 3 trades on SOL/USDC. It is a test mint with synthetic data, and the real BONK has a Pyth feed that a test mint does not, so live, that pool would have no oracle until one is configured.
