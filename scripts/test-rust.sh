#!/usr/bin/env bash
# Rust tests. Skips gracefully (exit 0 with a warning) if cargo is not installed,
# so `pnpm test` still works on machines without the Rust toolchain.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
if ! command -v cargo >/dev/null 2>&1; then
  echo "WARN: cargo not found; skipping Rust tests (install Rust via rustup to run them)."
  exit 0
fi
if [ ! -f Cargo.toml ]; then echo "No Cargo workspace yet; skipping."; exit 0; fi
cargo test -p fairway-math --quiet
if [ -n "${FAIRWAY_PROGRAM_TESTS:-}" ] || cargo metadata --no-deps --format-version 1 2>/dev/null | grep -q '"name":"fairway"'; then
  cargo test -p fairway --quiet
fi
