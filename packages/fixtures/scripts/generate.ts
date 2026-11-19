import { FIXTURE_DIR, generateFixtures, generateMemecoin } from '../src/node';

const t0 = Date.now();
const res = generateFixtures(FIXTURE_DIR, { fairwayProgramId: process.env.FAIRWAY_PROGRAM_ID });
const meme = generateMemecoin(FIXTURE_DIR, { fairwayProgramId: process.env.FAIRWAY_PROGRAM_ID });
console.log(`memecoin pool: ${meme.swaps} swaps → ${FIXTURE_DIR}/memecoin.json`);
console.log(`fixtures: ${res.swaps} swaps, ${res.blocks} blocks → ${FIXTURE_DIR} (${Date.now() - t0} ms)`);
