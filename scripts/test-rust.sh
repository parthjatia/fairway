#!/usr/bin/env bash
# Rust tests: math crate (plain cargo) + Anchor program (LiteSVM, needs target/deploy/fairway.so).
# Degrades gracefully: skips with a warning when cargo / the Solana toolchain is missing,
# so `pnpm test` stays green on machines without Rust.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
if ! command -v cargo >/dev/null 2>&1; then
  echo "WARN: cargo not found; skipping Rust tests (install Rust via rustup to run them)."
  exit 0
fi
echo "-- fairway-math (cargo test)"
cargo test -p fairway-math --quiet
if [ ! -f target/deploy/fairway.so ]; then
  if command -v anchor >/dev/null 2>&1 && command -v cargo-build-sbf >/dev/null 2>&1; then
    echo "-- building program (anchor build)"
    anchor build >/dev/null
  else
    echo "WARN: target/deploy/fairway.so missing and anchor/cargo-build-sbf not installed; skipping program tests."
    echo "      Install the Solana + Anchor toolchain and run: anchor build && cargo test -p fairway"
    exit 0
  fi
fi
echo "-- fairway program (LiteSVM)"
cargo test -p fairway --quiet
