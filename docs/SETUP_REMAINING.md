# Remaining human steps (about 10%)

Everything below needs an account, a network connection or your own judgment. Order matters. Budget about 2 hours. Deadline: **Fri Nov 20, 12:00 CST**.

## 0. Verify the build
```bash
corepack enable && pnpm i && pnpm test && pnpm build
pnpm demo                      # http://localhost:3000, check each page
```

## 1. Toolchain (only if you need to deploy)
Rust, Solana CLI (Agave) and Anchor 1.2.x via avm. `~/.cargo/bin` must be on PATH.
```bash
solana --version && anchor --version
```

## 2. Program keypair and build
**On the machine that built the project, skip the keygen and `anchor keys sync` lines.** `.keys/` (deployer, score-authority, program keypair) and `target/deploy/fairway-keypair.json` already exist, and they match the program ID `8jo3xry2rp9rQHwPCyh8c9Qwnw2HHa5JvAUiXHo2XPXk` in the README, `Anchor.toml`, `declare_id!` and the SDK. Running `anchor keys sync` with a new keypair would change the ID everywhere. Check with:
```bash
solana-keygen pubkey target/deploy/fairway-keypair.json   # must print 8jo3xry2…XPXk
```
Only on a **fresh clone**, which has no `.keys/` (gitignored), create throwaway keys. **Never use a real wallet.**
```bash
mkdir -p .keys
solana-keygen new --no-bip39-passphrase -o .keys/deployer.json
solana-keygen new --no-bip39-passphrase -o .keys/score-authority.json
anchor keys sync                # updates declare_id!, Anchor.toml; also update DEFAULT_PROGRAM_ID in packages/sdk/src/constants.ts
anchor build
cargo test -p fairway           # LiteSVM tests (needs the built .so)
```

## 3. Deploy to devnet
```bash
solana config set --url devnet
solana airdrop 2 $(solana-keygen pubkey .keys/deployer.json) --url devnet    # repeat; or use https://faucet.solana.com
solana airdrop 2 $(solana-keygen pubkey .keys/score-authority.json) --url devnet
anchor deploy --provider.cluster devnet --provider.wallet .keys/deployer.json
```
Put the program address in `README.md` (Program IDs table, Devnet row).

## 4. Create the devnet pool
```bash
RPC_URL=https://api.devnet.solana.com pnpm seed:devnet
```
It prints the pool PDA and the two vault PDAs and writes `apps/web/.env.local`. Copy the three addresses into the Fairway entry of `streams/pools.config.json`, then:
```bash
pnpm --filter @fairway/streams build:filter
```

### 4b. Pyth SOL/USD account for onchain scoring (verified 2026-11-19)
`settle_markout` reads a Pyth `PriceUpdateV2` account set **per pool** with `set_pool_oracle` (the seed script does this for the SOL pool). A pool without an oracle still trades but builds no onchain evidence, which is the case for BONK-test (a test mint has no Pyth feed). The seed script uses `PYTH_SOL_USD_PRICE_ACCOUNT_DEVNET = 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` (Pyth-sponsored SOL/USD, shard 0, **verified 2026-11-19**) and feed id `ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`, both in `packages/sdk/src/constants.ts`. Nothing to do before the demo. Optional sanity check after deploy:
1. Settle a trade by hand: swap once, wait about 30 s, then send `settleMarkoutIx({ cranker, trader, baseMint, quoteMint, pythPriceAccount })` from `@fairway/sdk`.
2. If Pyth ever moves the sponsored account, re-seed with `PYTH_PRICE_ACCOUNT=<addr> PYTH_FEED_ID=<hex> pnpm seed:devnet` (or send `setPoolOracleIx({ admin, baseMint, quoteMint, priceAccount, feedId })` for the existing pool).

For a local validator, clone the account from devnet so local settles work: `solana-test-validator --clone 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE --url devnet`. A cloned account is a snapshot, so it goes stale after 60 s and `settle_markout` will then fail with `OracleStale`. That is expected locally. The LiteSVM tests use a mock Pyth account instead.

### 4c. Treasury (protocol fee share and rent sponsorship)
- The treasury PDA is `treasuryPda()[0]` (seeds `["treasury"]`), a system account. `pnpm seed:devnet` sends it 0.05 SOL (about 20 sponsored score accounts at roughly 0.0023 SOL each). Top it up with any SOL transfer. With no SOL the trader pays the rent, nothing breaks.
- Protocol fees accrue inside each pool vault. Move them to the treasury with the permissionless `claimProtocolFeesIx({ cranker, baseMint, quoteMint })` (create the treasury's associated token accounts for the two mints first, e.g. `getOrCreateAssociatedTokenAccount(conn, payer, mint, treasuryPda()[0], true)`). Withdraw with `treasuryTransferTokensIx` / `treasuryWithdrawSolIx` (admin only).
- Change the share with `updateConfigIx({ admin, update: { protocolFeeBps: 1500 } })` (max 5000).

## 5. QuickNode account and Stream
1. Create an account at quicknode.com and redeem the hackathon plan (see the hackathon instructions).
2. **Streams → Create Stream.** Follow `streams/STREAM_CONFIG.md` exactly:
   - Stream A: Solana **mainnet**, dataset **Block**, start 3–7 days back (backfill), filter = contents of `streams/filter.js`.
   - Stream B: Solana **devnet**, dataset **Block**, start at the latest block.
   - **Stream L (launches, the headline):** Solana **mainnet**, dataset **Block**, start 1–3 days back, filter = contents of `streams/pumpfun-filter.js`, destination `https://<tunnel-host>/streams/pumpfun` (same token). See STREAM_CONFIG.md §Stream L.
3. The Raydium vaults in `pools.config.json` were checked on mainnet on 2026-11-19 (see "Filling in real pool addresses" in STREAM_CONFIG.md). Fill the Orca entry if you want it.
4. Use the dashboard's **Run test** on a slot that contains a SOL-USDC swap.
5. The Pump.fun (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`) and PumpSwap (`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`) program IDs in `packages/parser/src/pumpfun.ts` and `streams/pumpfun-filter.js` were **verified 2026-11-19**. Nothing to do.
6. In the Stream L editor, **Run test** on a slot with a Pump.fun buy. Expect `{"launchTrades":[...]}` with non-zero `solAmount`. If `solAmount` is 0 or missing, the account layout assumption (SOL as lamports on the bonding curve) needs a look: `parsePumpTransaction` in `packages/parser/src/pumpfun.ts`.

## 5b. Run a live Pump.fun Stream into ingest for 1-2 hours (Fairway Check on real data)
Fairway Check shows a **Live data** badge only when its reports come from a live ingest DB. No live Stream has run yet, so the demo's first shot needs this. Do it at least 3 hours before you record (the Stream must be running when your demo token launches, and snipers only score TOXIC after 3 early buys on different launches).
1. Create **Stream L** exactly as in `streams/STREAM_CONFIG.md` (Solana **mainnet**, dataset **Block**, **start at the latest block** so every token's `create` is captured, filter = `streams/pumpfun-filter.js`, destination `https://<tunnel-host>/streams/pumpfun`, security token = `QN_STREAM_TOKEN`). In the dashboard run **Run test** on a slot with a Pump.fun buy first.
2. Start ingest in live mode and a tunnel (same as step 6). Use a fresh DB so synthetic fixtures are not mixed in:
   ```bash
   DATA_MODE=live INGEST_DB_PATH=./services/ingest/data/live-check.db QN_STREAM_TOKEN=<token> pnpm --filter @fairway/ingest start
   cloudflared tunnel --url http://localhost:8787      # or: ngrok http 8787
   ```
3. Let it run 1-2 hours. Pump.fun volume is high, so watch your QuickNode plan's quota (a bounded run with an end slot is safer than leaving it on) and the size of the SQLite file. Each delivery recomputes sniper scores and bundle flags (the response shows `snipers` and `bundles`). Check progress:
   ```bash
   curl -s localhost:8787/check/tokens?limit=30 | jq '.source, [.tokens[] | {mint, grade, earlyBuyers, sniperSharePct}]'
   curl -s 'localhost:8787/snipers?tier=TOXIC&limit=5' | jq length      # > 0 once repeat snipers exist
   ```
4. Pick the demo token: a **High** grade with `earlyBuyers >= 10` that launched **after** the Stream started (a token whose `create` was missed has a wrongly anchored window: ECONOMICS §9).
5. Open the report from the web app, pointed at the live ingest (the app can stay in mock mode for everything else):
   ```bash
   INGEST_URL=http://localhost:8787 pnpm --filter @fairway/web dev     # then open /check/<mint>
   ```
   The badge on the report must say **Live data**. If it says "Simulated data", `INGEST_URL` is not set. `/check` with an empty DB shows "No launches have been indexed yet".
6. If no token grades High after 2 hours, record a Medium one and say so; do not pass a synthetic token off as live. If no repeat snipers have been scored yet (`/snipers?tier=TOXIC` is empty), every report reads Low: let it run longer, or backfill several hours by starting the Stream at an older slot.

## 6. Expose ingest and set the webhook
```bash
cp .env.example .env            # set QN_STREAM_TOKEN to the Stream's security token, DATA_MODE=live
DATA_MODE=live pnpm --filter @fairway/ingest start
# in another terminal, any tunnel works, e.g.:
cloudflared tunnel --url http://localhost:8787      # or: ngrok http 8787
```
Set the Stream destination to `https://<tunnel-host>/streams/solana`, paste the token, and start the stream. The ingest log should print `stored N swaps`. After the backfill finishes: `curl -X POST localhost:8787/recompute`. For Stream L the sniper scores recompute on every delivery: `curl -s localhost:8787/snipers?tier=TOXIC`.

## 7. Run the keeper
```bash
KEEPER_MODE=dry-run pnpm --filter @fairway/keeper start    # inspect services/keeper/out/ first
KEEPER_MODE=devnet RPC_URL=https://api.devnet.solana.com KEEPER_KEYPAIR=.keys/score-authority.json pnpm --filter @fairway/keeper start
```
The `score_authority` must match the one set by `seed:devnet`. The keeper writes markout tiers **and** launch-sniper TOXIC tiers (`desiredScores` in `services/ingest/src/launches.ts`).

## 8. Frontend
For the recorded demo, mock mode is the safest (`pnpm demo`). To show live mode: `NEXT_PUBLIC_MODE=live` with the `.env.local` from step 4, then connect a Wallet Standard wallet on devnet.

## 9. Record the video
Follow `docs/DEMO_SCRIPT.md` (2–3 minutes). Keep the "Simulated data" badge visible and say it's simulated.

## 10. Devpost
- Tracks: **DeFi**, **Best use of Solana**, **QuickNode Streams bounty**.
- Paste the sections from the README: headline (Fairway Launch), problem, how a launch works, launch economics, what's unique, what's next, tech, program IDs, Stream config (Stream L first).
- Link the video and the repo. Be explicit about what's simulated. The README table already says so.
- Push the repo to GitHub yourself (the agent never pushes): `git remote add origin <url> && git push -u origin master`.

## 11. Saturday
Attend in person. Use `docs/PITCH.md` (5 min launch script, 14 launch Q&As plus the engine/liquid-pair Q&As). Have `pnpm demo` running locally as a fallback.
