# Demo video script (2:30)

Setup: `pnpm demo`, open http://localhost:3000, dark mode, browser at 1440×900. The "Simulated data" badge should be visible in the corner. Say that it's simulated in the first 20 seconds.

| Time | Screen | Action | Say |
|---|---|---|---|
| 0:00 | `/` landing | Scroll slowly past the headline numbers | "Fairway is a Solana AMM where bots pay more and humans pay less. All data in this demo is simulated, as the badge says." |
| 0:15 | `/` problem bullets | Hover each bullet | "Bots trade on stale prices and LPs lose it. Everyone pays the same fee." |
| 0:30 | `/how-it-works` | Point at each stage of the diagram: Streams → filter → ingest → scoring → keeper → program → swap | "A QuickNode Stream filters blocks into swaps, including history on other DEXs. We score each wallet's markout and write a tier onchain." |
| 0:55 | `/swap` as **Retail Rita** | Enter 10 SOL → USDC. Point at the "5 bps" fee and the "why" panel | "Rita's 30-second markouts average near zero, so she pays 5 bps." |
| 1:10 | `/swap` switch to **New wallet** | Same amount | "A new wallet pays 30. It can never pay less, so rotating wallets doesn't help a bot." |
| 1:20 | `/swap` switch to **Arb Bot 7**, confirm swap | Click Confirm, show the updated reserves | "The bot's markout is consistently positive, so it pays 80." |
| 1:35 | `/wallet/<Arb Bot 7>` | Show the markout distribution and the tier timeline | "Every score is reproducible from public trades." |
| 1:50 | `/pool` | Show fees by tier and LP PnL | "LP fees split by tier, with the LVR proxy." |
| 2:00 | `/backtest` | Drag the toxic slider 30 → 80; drag retail to 20; toggle the rotation regime | "Retail cost drops. Staleness rises with the toxic fee. If arbs rotate wallets they pay 30, and the pool behaves like flat 30." |
| 2:20 | `/backtest` recommended highlight | Point at the recommended cell | "We're upfront: versus flat 30, LPs give up some PnL. The gain is for retail, and for LPs versus a low flat fee." |
| 2:30 | Repo / README program ID table | Cut to README | "Anchor program, Streams filter, scoring, keeper, SDK. Code is open." |
