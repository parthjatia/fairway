/**
 * Historical replay CLI: re-prices recorded swaps (JSONL from ingest `GET /export.jsonl`) under each fee schedule.
 * Static counterfactual only (behaviour is not modelled; see the agent-based sim).
 * Usage: pnpm --filter @fairway/sim replay -- --input swaps.jsonl [--toxic 80] [--retail 20] [--live]
 */
import { readFileSync } from 'node:fs';
import { makeConfig, scoreWallets, PoolImpliedMidPrice, type Swap } from '@fairway/scoring';
import { replay } from '../src';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1]! : d);
const input = arg('--input', '');
if (!input) {
  console.error('usage: replay --input swaps.jsonl [--toxic 80] [--retail 20] [--live]');
  process.exit(1);
}
const swaps = readFileSync(input, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Swap);
const mids = new PoolImpliedMidPrice(swaps);
const scores = scoreWallets(swaps, mids, makeConfig());
const toxic = Number(arg('--toxic', '80'));
const retail = Number(arg('--retail', '5'));
const out = replay(
  swaps,
  scores,
  [
    { name: 'Flat 30 bps', fees: 30 },
    { name: `Fairway ${retail}/30/${toxic}`, fees: { RETAIL: retail, STANDARD: 30, TOXIC: toxic } },
  ],
  !args.includes('--live'), // treated as synthetic unless you pass --live for real Streams data
);
console.log(JSON.stringify(out, null, 2));
