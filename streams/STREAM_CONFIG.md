# QuickNode Streams configuration for Fairway

Fairway uses **QuickNode Streams as its only onchain data source**. One filter (`streams/filter.js`) turns raw Solana blocks into compact swap records. The ingest service stores them, recomputes wallet markouts and tiers, and the keeper writes the tiers onchain.

```
Solana (mainnet / devnet) ──► Stream (dataset: Block) ──► filter.js ──► webhook POST /streams/solana
                                                                         (services/ingest, SQLite)
```

## Why Streams (vs. polling RPC)

- **Backfill + live in one pipeline.** The same filter scores wallets from day one using their *history* (backfill a window of past slots), then keeps the scores live. Polling `getSignaturesForAddress` + `getTransaction` per pool costs thousands of RPC calls per hour and is easy to get wrong around gaps and reorgs.
- **Exactly-once, ordered delivery** of every block, with retries handled by QuickNode.
- **Server-side filtering.** Only matched swaps leave QuickNode, so the webhook receives a few KB instead of full blocks (~MBs).
- **Cross-venue history.** A wallet's toxicity is measured on Raydium/Orca/Meteora too, not only on Fairway. That is what makes "fresh wallet = STANDARD, proven retail = RETAIL" meaningful from launch.

## Stream A: mainnet history and scores (primary)

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
| **Raydium AMM v4 SOL-USDC** (`58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2`) | Prefilled in `pools.config.json`: base vault `DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz`, quote vault `HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz`. **Verify before use:** open the pool on Solscan → "Token accounts" (or the Raydium API `https://api-v3.raydium.io/pools/key/ids?ids=<pool>` → `vault.A` / `vault.B`). The SOL (wSOL) vault is the base. |
| **Orca Whirlpool SOL-USDC** | Open the pool from orca.so → copy its address → Solscan → account data shows `tokenVaultA` (SOL) and `tokenVaultB` (USDC). Orca fee tiers are 1–30 bps, so set `feeBps` to the pool's tier. |
| **Meteora DLMM SOL-USDC** | app.meteora.ag → pool → address → Solscan → `reserveX` / `reserveY`. Use `venue: "meteora"`. |
| **Fairway (devnet)** | `pnpm seed:devnet` (or `scripts/seed-local.ts --cluster devnet`) prints the pool PDA and both vault PDAs. The SDK derives them too: `poolAddresses(baseMint, quoteMint)`. |

After editing `streams/pools.config.json`, run `pnpm --filter @fairway/streams build:filter` and paste the new `filter.js`. Alternatively, edit the CONFIG block directly in the dashboard.

## Backfilling a few hours of one real SOL-USDC pool

1. Create Stream A with **Start = a slot ~6 hours ago** and **End = the current slot**. Solana makes ~9,000 slots per hour, so 6 hours ≈ 54,000 slots. Find the current slot with `solana slot --url mainnet-beta`.
2. Keep only the Raydium pool in the CONFIG block for a cheap first run.
3. Point the destination at your tunnel (see `docs/SETUP_REMAINING.md`) and start the stream. The ingest log prints `stored N swaps` per delivery.
4. When it finishes, call `POST /recompute`. Scores now cover every wallet that traded the pool in that window. `GET /wallet/<address>` shows one wallet.
5. Optionally export the stored swaps (`GET /export.jsonl`) and run the historical replay: `pnpm --filter @fairway/sim replay -- --input swaps.jsonl`.

For **markouts on real data**, the ingest service uses the `PoolImpliedMidPrice` provider: the mid at `t + h` comes from the stream itself (last trade / reserve ratio). `PythMidPrice` is stubbed for a later upgrade.

## Webhook security

QuickNode signs every delivery: `x-qn-signature` = hex(HMAC-SHA256(security token, `nonce + timestamp + body`)), with the `x-qn-nonce` and `x-qn-timestamp` headers. The ingest service verifies this signature when `QN_STREAM_TOKEN` is set. It also accepts a simple `x-fairway-token: <QN_STREAM_TOKEN>` header for local testing (curl) and for setups that add a custom header. Unsigned requests are rejected with 401 when a token is configured.

Note: QuickNode's guide says to verify against the **decompressed** body when gzip is enabled. The ingest service decompresses first, then verifies. If verification fails with gzip on, switch compression off.
