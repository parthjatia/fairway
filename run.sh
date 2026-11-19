#!/bin/bash
cd ~/fairway
export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
runs=0
while [ $runs -lt 40 ]; do
  grep -q "STATUS: DONE" PROGRESS.md 2>/dev/null && break
  echo "$(date): starting run $((runs+1))"
  out=$(claude -p --model sonnet --dangerously-skip-permissions "Continue building per CLAUDE.md. Read PROGRESS.md and DECISIONS.md first, then do the next unchecked milestone. Never ask questions. We are in WSL Ubuntu. Never use sudo. Rust and Anchor are in ~/.cargo/bin." 2>&1)
  echo "$out" | tail -5
  if echo "$out" | grep -qiE "hit your .*limit|usage limit|resets [0-9]"; then
    echo "$(date): usage limit hit, waiting 15 min"; sleep 900
  else
    runs=$((runs+1)); sleep 30
  fi
done