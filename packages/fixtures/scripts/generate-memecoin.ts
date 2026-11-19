/** Regenerates ONLY data/memecoin.json (the BONK-test pool). The SOL-USDC fixtures are left untouched. */
import { FIXTURE_DIR, generateMemecoin } from '../src/node';

const r = generateMemecoin(FIXTURE_DIR, { fairwayProgramId: process.env.FAIRWAY_PROGRAM_ID });
console.log(`memecoin pool: ${r.swaps} swaps → ${FIXTURE_DIR}/memecoin.json`);
