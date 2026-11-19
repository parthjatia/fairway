/** Regenerates ONLY data/bundles.json (launches + wallet fundings for bundle detection, M16 step 11). Other fixtures are untouched. */
import { FIXTURE_DIR, generateBundles } from '../src/node';

const r = generateBundles(FIXTURE_DIR);
console.log(`bundle fixture: ${r.blocks} blocks, ${r.fundings} fundings → ${FIXTURE_DIR}/bundles.json`);
