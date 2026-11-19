#!/usr/bin/env bash
# Local validator + deploy + seed + live-mode web. Needs Solana CLI + Anchor (~/.cargo/bin).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
for t in solana solana-test-validator anchor; do
  command -v "$t" >/dev/null || { echo "Missing '$t'. See docs/SETUP_REMAINING.md (toolchain). Mock demo still works: pnpm demo"; exit 1; }
done
[ -d node_modules ] || pnpm install
[ -f .keys/deployer.json ] || { mkdir -p .keys; solana-keygen new --no-bip39-passphrase -s -o .keys/deployer.json >/dev/null; }
[ -f target/deploy/fairway.so ] || anchor build
pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

LEDGER=/tmp/fairway-ledger
rm -rf "$LEDGER"
solana-test-validator --reset --quiet --ledger "$LEDGER" \
  --bpf-program "$(solana-keygen pubkey target/deploy/fairway-keypair.json)" target/deploy/fairway.so > /tmp/fairway-validator.log 2>&1 &
pids+=($!)
for _ in $(seq 1 60); do solana -u http://127.0.0.1:8899 cluster-version >/dev/null 2>&1 && break; sleep 1; done
solana -u http://127.0.0.1:8899 cluster-version >/dev/null || { echo "validator did not start, see /tmp/fairway-validator.log"; exit 1; }

pnpm seed:local

export DATA_MODE=fixture INGEST_DB_PATH=/tmp/fairway-local.db
rm -f "$INGEST_DB_PATH"*
pnpm --filter @fairway/ingest start > /tmp/fairway-ingest.log 2>&1 &
pids+=($!)
sleep 3
KEEPER_MODE=local RPC_URL=http://127.0.0.1:8899 KEEPER_KEYPAIR=.keys/score-authority.json pnpm --filter @fairway/keeper start || echo "keeper run failed (non-fatal)"

echo; echo "  Live mode: http://localhost:3000/swap  (connect a wallet on localhost:8899)"
NEXT_PUBLIC_MODE=live pnpm --filter @fairway/web exec next dev -p 3000
