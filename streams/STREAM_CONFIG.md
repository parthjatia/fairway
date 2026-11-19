# QuickNode Streams configuration for Fairway

Fairway uses **QuickNode Streams as its only onchain data source**, with two filters:

- **`streams/pumpfun-filter.js` (Stream L, launches, the primary use since M16)** extracts every Pump.fun / PumpSwap create, buy and sell. The ingest service scores **known snipers** across launches, and the keeper writes them onchain as TOXIC, so they pay the high launch fee on Fairway from their first buy.
- **`streams/filter.js` (Streams A and B, liquid pairs)** turns raw blocks into swap records on configured SOL-USDC pools for markout scoring.

The ingest service stores the records and recomputes scores, and the keeper writes tiers onchain.

```
Solana mainnet ──► Stream L (Block) ──► pumpfun-filter.js ──► webhook POST /streams/pumpfun ──► sniper scores ─┐
Solana mainnet ──► Stream A (Block) ──► filter.js ─────────► webhook POST /streams/solana ──► markout scores ──┼─► keeper ──► TraderScore PDAs
Solana devnet  ──► Stream B (Block) ──► filter.js ─────────► webhook POST /streams/solana ──────────────────────┘
```

## Why Streams (vs. polling RPC)

- **Backfill + live in one pipeline.** The same filter scores wallets from day one using their *history* (backfill a window of past slots), then keeps the scores live. Polling `getSignaturesForAddress` + `getTransaction` per pool costs thousands of RPC calls per hour and is easy to get wrong around gaps and reorgs.
- **Exactly-once, ordered delivery** of every block, with retries handled by QuickNode.
- **Server-side filtering.** Only matched swaps leave QuickNode, so the webhook receives a few KB instead of full blocks (~MBs).
- **Cross-venue history.** A wallet's toxicity is measured on Raydium/Orca/Meteora too, not only on Fairway. That is what makes "fresh wallet = STANDARD, proven retail = RETAIL" meaningful from launch.

## Stream A: mainnet liquid-pair history and scores

| Setting | Value |
|---|---|
| Chain / Network | **Solana / Mainnet** |
| Dataset | **Block** |
| Start | *Backfill:* a slot ~3–7 days back (enough history for the 3-day RETAIL rule). *Live:* "Latest block". |
| End | Empty for live. For a bounded backfill job, set the end slot. |
| Filter | Paste the whole contents of `streams/filter.js` ("Modify the stream payload" → JavaScript). |
| Destination | **Webhook** → `https://<your-host>/streams/solana` |
| Security token | Copy it from the Stream's settings into `QN_STREAM_TOKEN` in the ingest service's `.env`. |
| Compression | Off or gzip (ingest accepts both). |
| Batch size | 1–10 blocks (the filter handles arrays). |
| Reorg handling | Use the default "latest block delay" / reorg handling. Ingest is idempotent on `(sig, pool)`. |

## Stream L: Pump.fun / PumpSwap launches → known-sniper scores (M16)

**Why:** a fair launch on Fairway needs to know, *at slot 0*, which wallets are snipers. A brand-new token has no history, but its snipers do: the same wallets buy in the first seconds of launch after launch and sell into the crowd. Pump.fun is where most Solana launches happen, so its history is the best evidence. Streams gives us that history (backfill) and keeps it current (live) through one filter, and only a few KB of matched trades leave QuickNode per block.

| Setting | Value |
|---|---|
| Chain / Network | **Solana / Mainnet** |
| Dataset | **Block** (transaction details full, with meta: the filter needs `pre/postTokenBalances`, `pre/postBalances`, `logMessages` and `loadedAddresses`). |
| Start | *Backfill:* ~1–3 days back (Pump.fun sees thousands of launches a day, so even a few hours finds the repeat snipers). *Live:* "Latest block". |
| End | Empty for live; the end slot for a bounded backfill. |
| Filter | Paste all of `streams/pumpfun-filter.js`. |
| Destination | **Webhook** → `https://<your-host>/streams/pumpfun`, same security token as Stream A (`QN_STREAM_TOKEN`). |
| Batch size | 1–10 blocks. Compression off or gzip. |
| Reorgs | Default handling; ingest is idempotent on `(sig, mint, kind)`. |

### Program IDs: VERIFY before going live

The filter matches transactions that invoke these programs. **They were written from memory and have not been checked onchain in this repo.** They also appear in `packages/parser/src/pumpfun.ts` (`PUMP_PROGRAMS`), and a test asserts the two copies match.

| Program | ID (VERIFY) | How to check |
|---|---|---|
| Pump.fun bonding curve | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | Open any token on pump.fun → its Solscan link → a recent "Buy" transaction → "Instructions": the invoked program id. Or `solana account 6EF8… --url mainnet-beta` should show `Executable: true`. |
| PumpSwap AMM (graduated tokens) | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | Open a token that "graduated" (pump.fun shows it trading on PumpSwap) → a recent swap on Solscan → invoked program id. |

If either differs, edit the `PROGRAMS` block at the top of `pumpfun-filter.js` in the dashboard (and `PUMP_PROGRAMS` in the repo), then rebuild with `pnpm --filter @fairway/streams build:filter`.

### Filter logic (per transaction)

1. Skip it if `meta.err` is set or neither program id is in the full account-key list (static keys + ALT `loadedAddresses`).
2. Sum token deltas per `(mint, owner)` from `pre/postTokenBalances`, using raw integer amounts. WSOL and USDC are ignored as "the token".
3. **Trader** = fee payer. For each mint whose trader balance changed, the **curve** is the other owner whose balance moved the opposite way (the bonding-curve PDA or the PumpSwap pool). Trader ↑ = buy, ↓ = sell.
4. **SOL leg** = the curve's WSOL token-account delta if it has one (PumpSwap), else the curve account's lamport delta (Pump.fun holds SOL as lamports). Platform fees go to a separate fee recipient, so this is the **pre-fee** amount. `price = SOL / tokens`.
5. A log line `Program log: Instruction: Create` adds a `create` record: the launch slot for that mint.
6. Returns `{ launchTrades: [{ sig, slot, ts, mint, venue, trader, kind, tokenAmount, solAmount, price }] }`, or `null`.

Known approximations: a transaction that buys several Pump tokens at once is split per mint, but its SOL legs are attributed per curve, which is correct. Bundled multi-signer transactions credit the fee payer (bundlers usually pay with the sniping wallet anyway). Platform-fee schedule changes do not matter, because the price is taken on the curve side.

### From launch trades to sniper scores (`packages/scoring/src/sniper.ts`)

For every launch, an **early buy** is a buy within 25 slots (~10 s) of the create. Its **markout** is the move from the buy price to the token's own last trade price 75 slots (~30 s) later, in bps. There is no oracle for memecoins, so the token's own trades are the reference, the same idea as the onchain pool TWAP.

Per wallet, across launches: `score = Σ(SOL × markout) / (Σ SOL + 5 SOL)`. This is the same Bayesian shrinkage as the main scorer. A wallet becomes **TOXIC when it sniped ≥ 3 different launches and score ≥ 500 bps**. One lucky early buy never qualifies. Launch history never grants RETAIL. The keeper merges these TOXIC tiers over the markout tiers (`desiredScores` in `services/ingest/src/launches.ts`).

**Tested on synthetic fixtures only** (`packages/fixtures/data/pumpfun.json`: 8 launches, 4 recurring snipers, 30 retail wallets, one lucky early buyer, plus a failed tx, an ALT-loaded curve, a create without a dev buy, PumpSwap trades and a non-Pump transfer). `streams/pumpfun-filter.test.ts` checks the filter against the parser block by block, and checks that the filter → scorer pipeline flags exactly the 4 snipers. It has **not** been run against real Pump.fun blocks. Run the dashboard's "Run test" on a recent slot with a Pump.fun buy to confirm the account layout first.

### Try it locally

```bash
pnpm --filter @fairway/ingest dev            # fixture mode seeds launch trades too
curl -s localhost:8787/snipers?tier=TOXIC | jq '.[0]'
curl -s -XPOST localhost:8787/streams/pumpfun -H 'content-type: application/json' -d '{"launchTrades":[]}'
```

## Stream B: Fairway pool on devnet

Same settings, with **Network: Devnet**, start "Latest block", and the Fairway pool entry filled in the CONFIG block. You can also run a single stream per network that includes all pools: unmatched pools simply never match.

## The filter (`streams/filter.js`)

- **Generated, not hand-edited:** `pnpm --filter @fairway/streams build:filter` strips the types from `packages/parser/src/core.ts` and inlines that code. The ingest service runs the **same code**, and a test fails if `filter.js` is stale (`streams/filter.test.ts`).
- **Self-contained:** no `require` or `import`, no BigInt, no `eval`, ES2018. It satisfies the Streams runtime rules.
- **Only edit the CONFIG block** at the top (`var POOLS = [...]`). Entries whose vaults start with `<` are placeholders and are ignored.

### Filter logic (per transaction)

1. Skip it if `meta` is missing or `meta.err` is set (failed transactions).
2. Build the full account-key list: `transaction.message.accountKeys` (strings or `{pubkey}` objects), **plus** `meta.loadedAddresses.writable` and then `.readonly` (v0 transactions with address lookup tables).
3. For every configured pool, compute the vault deltas from `meta.preTokenBalances` / `postTokenBalances`, matched by `accountIndex`. It uses the exact raw `amount` and falls back to `uiAmountString`.
4. Base vault ↓ and quote vault ↑ = the trader **bought** base. The reverse = **sell**. Same direction = liquidity add/remove, ignored.
5. `trader` = first account key (the fee payer / signer).
6. **Pre-fee price.** The fee is charged on the input and stays in the vault, so: buy → `quote·(1−fee)/base`, sell → `quote/(base·(1−fee))`. External venues use the pool's configured fee (an approximation, since CLMM fee tiers and dynamic fees vary). For **Fairway pools** the filter decodes the Anchor `SwapExecuted` event (`Program data:` log line, discriminator `sha256("event:SwapExecuted")[0..8]`) and uses the exact `fee_bps` and `tier`.
7. It returns `{ swaps: [{ sig, slot, ts, pool, venue, trader, side, baseAmount, quoteAmount, execPrice, feeBps, tier?, source }] }`, or **`null`** when nothing matched (no webhook call).

`slot` = `block.slot` if present, else `parentSlot + 1`. `ts` = `blockTime`.

### Test it in the dashboard

In the filter editor, pick a recent slot that you know contains a SOL-USDC swap (any Raydium SOL-USDC transaction on Solscan shows its slot) and click **Run test**. You should see `{"swaps":[...]}`. Most slots return `null`, which is expected.

## Filling in real pool addresses

The filter matches **vault token accounts**, not program IDs. This works for any AMM design (CPMM, CLMM, DLMM) and for swaps routed through aggregators (Jupiter), because the pool's vaults move no matter who invoked the swap.

| Pool | How to find the vaults |
|---|---|
| **Raydium AMM v4 SOL-USDC** (`58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2`) | Prefilled in `pools.config.json`: base vault `DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz`, quote vault `HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz`. **Verified 2026-11-19** with `getAccountInfo` on mainnet: `DQyr…` is a wSOL token account (9 decimals) and `HLmq…` is a USDC token account (6 decimals), both owned by the Raydium AMM v4 authority `5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1`. To re-check: open the pool on Solscan → "Token accounts" (or the Raydium API `https://api-v3.raydium.io/pools/key/ids?ids=<pool>` → `vault.A` / `vault.B`). The SOL (wSOL) vault is the base. |
| **Orca Whirlpool SOL-USDC** | Open the pool from orca.so → copy its address → Solscan → account data shows `tokenVaultA` (SOL) and `tokenVaultB` (USDC). Orca fee tiers are 1–30 bps, so set `feeBps` to the pool's tier. |
| **Meteora DLMM SOL-USDC** | app.meteora.ag → pool → address → Solscan → `reserveX` / `reserveY`. Use `venue: "meteora"`. |
| **Fairway (devnet)** | `pnpm seed:devnet` (or `scripts/seed-local.ts --cluster devnet`) prints the pool PDA and both vault PDAs. The SDK derives them too: `poolAddresses(baseMint, quoteMint)`. |

After editing `streams/pools.config.json`, run `pnpm --filter @fairway/streams build:filter` and paste the new `filter.js`. Alternatively, edit the CONFIG block directly in the dashboard.

## Backfilling a few hours of one real SOL-USDC pool

1. Create Stream A with **Start = a slot ~6 hours ago** and **End = the current slot**. Solana makes ~9,000 slots per hour, so 6 hours ≈ 54,000 slots. Find the current slot with `solana slot --url mainnet-beta`.
2. Keep only the Raydium pool in the CONFIG block for a cheap first run.
3. Point the destination at your tunnel (see `docs/SETUP_REMAINING.md`) and start the stream. The ingest log prints `stored N swaps` per delivery.
4. When it finishes, call `POST /recompute`. Scores now cover every wallet that traded the pool in that window. `GET /wallet/<address>` shows one wallet.
5. Optionally export the stored swaps (`GET /export.jsonl`) and run the historical replay: `pnpm --filter @fairway/sim replay -- --input swaps.jsonl --live`.

For **markouts on real data**, the ingest service uses the `PoolImpliedMidPrice` provider: the mid at `t + h` comes from the stream itself (last trade / reserve ratio). `PythMidPrice` is stubbed for a later upgrade.

## Webhook security

QuickNode signs every delivery: `x-qn-signature` = hex(HMAC-SHA256(security token, `nonce + timestamp + body`)), with the `x-qn-nonce` and `x-qn-timestamp` headers. The ingest service verifies this signature when `QN_STREAM_TOKEN` is set. It also accepts a simple `x-fairway-token: <QN_STREAM_TOKEN>` header for local testing (curl) and for setups that add a custom header. Unsigned requests are rejected with 401 when a token is configured.

Note: QuickNode's guide says to verify against the **decompressed** body when gzip is enabled. The ingest service decompresses first, then verifies. If verification fails with gzip on, switch compression off.
