# DECISIONS.md

One line per decision: date — decision — why.

- 2026-11-19 — Node v24.22.3 LTS installed to ~/.local/opt/node (tarball, no sudo) — v24 is LTS with the broadest native-module prebuild coverage (better-sqlite3); v26 is newer but riskier for prebuilds.
- 2026-11-19 — pnpm 12.21.0 via corepack; build-script allowlist uses `allowBuilds` in pnpm-workspace.yaml — pnpm ≥11 ignores `onlyBuiltDependencies`.
- 2026-11-19 — Pinned TypeScript ~6.0 — TS 7 (native) is outside typescript-eslint's supported peer range (<6.1).
- 2026-11-19 — Workspace TS libs are consumed from source (`exports` → `src/index.ts`), no per-lib build step; `build` = typecheck for libs, `next build` for the web app — fewer moving parts, faster iteration.
- 2026-11-19 — `pnpm test` skips Rust tests with a warning when cargo is missing — keeps fresh-clone `pnpm test` green on machines without Rust.
- 2026-11-19 — Tier min-trade checks count trades that have a markout at the primary horizon (not raw trade count) — a trade with no future mid carries no evidence.
