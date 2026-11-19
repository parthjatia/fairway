# Pitch (5 minutes) and judge Q&A

**Note for the presenter:** every number comes from a synthetic simulation. Say so. Judges respect it. One line to land early: **"Fairway is bot-friendly: good bots pay less, extractive flow pays its fair share."**

## Script

**0:00 The hook (30 s).** "Every AMM charges the same fee to a retail user buying $100 of SOL and to a bot that is arbitraging the pool on information. LPs lose to those bots. It's called LVR, and Solana's 400 ms slots make it constant. Fairway charges bots more and humans less."

**0:30 The insight (45 s).** "Onchain history is public. For each past trade we can measure the *markout*: did the price move in the trader's favor over the next 30 seconds? Bots that trade on information have a consistently positive markout. Retail is near zero. So we score wallets and write the tier onchain."

**1:15 The mechanism (60 s).** Show `/how-it-works`. "Three tiers: 5, 30, 80 bps. A new wallet is STANDARD, never RETAIL, so rotating wallets doesn't help a bot. The swap derives the score PDA from the signer, so you can't borrow someone else's score. Shrinkage means one lucky trade doesn't move you."

**2:15 QuickNode Streams (45 s).** "Streams is our data layer. A Solana Block stream with a server-side filter turns blocks into swap records for Raydium, Orca and Fairway pools, matching on vault balance deltas. We backfill days of history so scores exist from day one, then keep them live through a webhook. Polling RPC for this would be thousands of calls an hour."

**3:00 Demo (75 s).** `/swap`: the "Same trade, two wallets" panel (Rita vs Arb Bot 7: the fee in dollars for the identical swap), then switch the pair to BONK-test. `/wallet/...`: the "Onchain verified" badge and the markout chart. `/pool`: "Extra fees earned from bots", protocol revenue. `/backtest`: move the sliders, show the rotation worst case.

**4:15 Honest results and business model (30 s).** "Retail pays 18 bps less and arbitrage profit drops 73 to 90%. Against flat 30, LPs do not automatically win: at our sweep's best setting they are roughly even before the protocol's 15% share and about $155 a day behind after it, and that needs a high toxic fee. We show that in the open. The protocol earns 15% of fees, and the scores can be licensed to other DEXes."

**4:45 Close (15 s).** "Anchor program, Streams pipeline, scoring, keeper, and frontend all work end to end offline. Scores for Fairway flow are already computed onchain against Pyth. Next: devnet, a crank reward, multi-oracle for cross-venue history."

## 19 likely questions

1. **Can't bots just use new wallets?** They get STANDARD (30 bps), the same as a flat-30 pool. Rotation removes only the *surcharge*. In our worst-case simulation arbs keep their full profit and the pool behaves like flat 30, while retail still gets the discount. We say plainly that LPs fund that discount in this case.

2. **Doesn't a higher bot fee make the pool price staler?** Yes. p95 deviation from the CEX goes from 32 bps to about 80 bps at an 80 bps toxic fee, and to about 196 bps at 200 bps. The sweep bounds it (200 bps by default). Retail's execution cost already includes the effect, which is why retail still comes out ahead, but a very stale pool price is a risk for anything that reads it as an oracle.

3. **Who runs the oracle?** For trades on Fairway, nobody: the program computes the score itself. Every swap is queued in the trader's PDA, and after 75 slots (about 30 s) anyone can call `settle_markout`, which reads Pyth and applies the same markout, shrinkage and thresholds onchain. Once a wallet has 1,000 USDC and 5 trades of settled flow, that onchain tier wins and the keeper can't change it. The keeper only bootstraps new wallets from their history on other venues (via QuickNode Streams). Even there, its power is limited to choosing a tier, scores expire (TTL), and the inputs are public.

4. **Why Solana?** Fast slots make LVR frequent, which makes the problem worse. Cheap batched writes (10 scores per transaction), PDAs let us key the fee tier to the signer cheaply, and QuickNode Streams makes the Solana history queryable.

5. **Why Streams vs. polling RPC?** Backfill plus live in one pipeline, server-side filtering (KBs instead of block-sized payloads), ordered delivery with retries, and one filter that works on any AMM through vault deltas.

6. **How is this different from dynamic volatility fees or Uniswap v4 hooks?** Volatility fees charge everyone more in volatile markets, including retail. Hooks are a mechanism where one can implement it, but need an information signal. Fairway's contribution is the *signal*: a wallet-level, markout-based score kept fresh from a data pipeline, with an onchain check that ties it to the signer.

7. **Does the simulation show LPs make more than a flat 30 bps pool?** Not unconditionally. At 5/30/80, LP PnL vs flat 30 is about −$453/day. At the sweep's pick, 20/30/200, it is about +$74/day before the protocol's share (±$214, not distinguishable from zero) and −$155/day after it, with retail saving 7 bps and p95 staleness at 196 bps. With retail volume that rises with lower fees (elasticity 1) it turns positive. That is an assumption, labeled as such. Against a flat 5 bps pool, LPs do much better (about +$500/day). So the claim is lower retail cost and 70–90% less LVR, paid for by LPs and the protocol's share unless volume responds.

8. **What stops a "sleeper" wallet that builds a clean history, then trades informed?** TTL and frequent refresh, TOXIC writes first, and the shrinkage prior. It's not solved. Notional caps for RETAIL are future work. We list it in RISKS.md.

9. **What about aggregators like Jupiter?** The tier follows the signer. If the router signs as the user, it works. A router that signs with its own account collapses many users into one wallet, which we haven't tested.

10. **Isn't labeling wallets a privacy or fairness problem?** Scores use only public data, and the explorer shows the exact inputs. There are regulatory questions about differential pricing that a production deployment would need to review. We flag it in RISKS.md.

11. **How do you measure markout without a CEX price?** Fixture mode uses the simulated CEX path. Live mode uses the pool-implied mid from the stream itself (last trade). A Pyth provider is stubbed behind the same interface for a later upgrade.

12. **Why K = 2,000?** It's a prior of $2k notional at markout 0. It means a wallet needs a few thousand dollars of volume before its score is near its raw average. It is configurable.

13. **What if the oracle goes down?** Bootstrap scores go stale after `score_ttl_slots`, and those wallets pay STANDARD. Onchain verified scores don't depend on the keeper and don't expire. If Pyth is stale or too uncertain, `settle_markout` refuses to settle, trades stay pending (then expire unscored) and tiers just stop changing. The pool keeps working either way.

14. **Is the program secure?** It's unaudited. Math is u128 checked, rounding in the pool's favor, with the k-never-decreases property tested. The wrong-signer, stale-score, slippage and unauthorized-write tests pass. Don't use real funds.

15. **What's real and what's simulated?** Real: the program, the scoring, the parser and filter (tested against getBlock-shaped fixtures), the ingest, keeper and the SDK. Simulated: all market data and the backtest, and the UI says so. Not done: a live Stream, a devnet deployment. Those are the human's final steps (SETUP_REMAINING.md).

16. **How does the protocol make money?** `protocol_fee_bps` takes 15% of every swap fee (cap 50%). It is booked per pool, excluded from LP reserves, and claimed by anyone into the treasury PDA. The next revenue line is licensing: other DEXes price flow with our scores (`getFeeTier`), through an API, an SLA, or a revenue share. That second part is not built.

17. **Are bots banned? Doesn't this hurt market makers?** No. The fee depends on measured markout, not on whether the signer is a program. A market maker or hedging bot with no informed edge earns RETAIL pricing and a "Verified fair flow" badge. Only flow that consistently moves the price its way pays the TOXIC fee.

18. **Who pays for the score account?** Each wallet's first swap on a scored pool creates its `TraderScore` PDA, about 0.0023 SOL of rent. The protocol treasury pays it while it holds more SOL than its own rent-exempt minimum plus that rent, and the account is flagged so closing it refunds the treasury. If the treasury is empty, the trader pays. Sponsoring is an onboarding cost the protocol covers from its fee revenue, and a drained treasury just falls back to trader-pays.

19. **Why a second, memecoin pool?** Because it shows the mechanism where it bites: pumps and dumps give snipers a large markout, so they are scored TOXIC after 5–9 settled trades in the fixtures, while the same sniper stays STANDARD after 3 trades on SOL/USDC. It is a test mint with synthetic data, and the real BONK has a Pyth feed that a test mint does not, so live, that pool would have no oracle until one is configured.
