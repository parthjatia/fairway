/** Regenerates ONLY data/checks.json (Fairway Check launches, M18). Other fixtures are untouched. */
import { FIXTURE_DIR, generateChecks } from '../src/node';

const r = generateChecks(FIXTURE_DIR);
console.log(`check fixture: ${r.tokens} tokens, ${r.trades} trades → ${FIXTURE_DIR}/checks.json`);
