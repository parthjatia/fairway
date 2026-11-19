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

## 5. QuickNode account and Stream
1. Create an account at quicknode.com and redeem the hackathon plan (see the hackathon instructions).
2. **Streams → Create Stream.** Follow `streams/STREAM_CONFIG.md` exactly:
   - Stream A: Solana **mainnet**, dataset **Block**, start 3–7 days back (backfill), filter = contents of `streams/filter.js`.
   - Stream B: Solana **devnet**, dataset **Block**, start at the latest block.
3. The Raydium vaults in `pools.config.json` were checked on mainnet on 2026-11-19 (see "Filling in real pool addresses" in STREAM_CONFIG.md). Fill the Orca entry if you want it.
4. Use the dashboard's **Run test** on a slot that contains a SOL-USDC swap.

## 6. Expose ingest and set the webhook
```bash
cp .env.example .env            # set QN_STREAM_TOKEN to the Stream's security token, DATA_MODE=live
DATA_MODE=live pnpm --filter @fairway/ingest start
# in another terminal, any tunnel works, e.g.:
cloudflared tunnel --url http://localhost:8787      # or: ngrok http 8787
```
Set the Stream destination to `https://<tunnel-host>/streams/solana`, paste the token, and start the stream. The ingest log should print `stored N swaps`. After the backfill finishes: `curl -X POST localhost:8787/recompute`.

## 7. Run the keeper
```bash
KEEPER_MODE=dry-run pnpm --filter @fairway/keeper start    # inspect services/keeper/out/ first
KEEPER_MODE=devnet RPC_URL=https://api.devnet.solana.com KEEPER_KEYPAIR=.keys/score-authority.json pnpm --filter @fairway/keeper start
```
The `score_authority` must match the one set by `seed:devnet`.

## 8. Frontend
For the recorded demo, mock mode is the safest (`pnpm demo`). To show live mode: `NEXT_PUBLIC_MODE=live` with the `.env.local` from step 4, then connect a Wallet Standard wallet on devnet.

## 9. Record the video
Follow `docs/DEMO_SCRIPT.md` (2–3 minutes). Keep the "Simulated data" badge visible and say it's simulated.

## 10. Devpost
- Tracks: **DeFi**, **Best use of Solana**, **QuickNode Streams bounty**.
- Paste the sections from the README: problem, how it works, what's unique, what's next, tech, program IDs, Stream config.
- Link the video and the repo. Be explicit about what's simulated. The README table already says so.
- Push the repo to GitHub yourself (the agent never pushes): `git remote add origin <url> && git push -u origin master`.

## 11. Saturday
Attend in person. Use `docs/PITCH.md` (5 min script and 15 Q&As). Have `pnpm demo` running locally as a fallback.
