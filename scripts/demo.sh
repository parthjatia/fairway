#!/usr/bin/env bash
# One-command offline demo: fixtures -> sim -> ingest (fixture mode) -> web (mock mode).
set -euo pipefail
cd "$(dirname "$0")/.."
command -v pnpm >/dev/null || { echo "pnpm not found. Run: corepack enable"; exit 1; }
[ -d node_modules ] || pnpm install
[ -f packages/fixtures/data/swaps.json ] || pnpm fixtures
[ -f packages/sim/out/backtest.json ] && [ -f packages/sim/out/sweep.json ] || pnpm sim
[ -f packages/sim/out/launch.json ] || pnpm --filter @fairway/sim launch

export DATA_MODE=fixture NEXT_PUBLIC_MODE=mock INGEST_PORT="${INGEST_PORT:-8787}" PORT="${PORT:-3000}"
export INGEST_DB_PATH="${INGEST_DB_PATH:-/tmp/fairway-demo.db}"
rm -f "$INGEST_DB_PATH" "$INGEST_DB_PATH"-wal "$INGEST_DB_PATH"-shm
pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

pnpm --filter @fairway/ingest start > /tmp/fairway-ingest.log 2>&1 &
pids+=($!)
export INGEST_URL="http://127.0.0.1:$INGEST_PORT"
for _ in $(seq 1 40); do curl -sf "$INGEST_URL/health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -sf "$INGEST_URL/health" >/dev/null || { echo "ingest failed to start, see /tmp/fairway-ingest.log"; exit 1; }
echo "ingest (fixture mode): $INGEST_URL"

pnpm --filter @fairway/web exec next dev -p "$PORT" &
pids+=($!)
echo
echo "  Fairway demo (simulated data): http://localhost:$PORT"
echo "  Ctrl-C to stop."
wait "${pids[-1]}"
