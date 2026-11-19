#!/usr/bin/env bash
# Runs every test suite: TS packages (vitest) + Rust (cargo test on the math crate / program logic).
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== TypeScript tests =="
pnpm run test:ts
echo "== Rust tests =="
bash scripts/test-rust.sh
echo "All tests passed."
