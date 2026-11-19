/** Regenerates ONLY data/pumpfun.json (Pump.fun launch blocks, M16). The other fixtures are left untouched. */
import { FIXTURE_DIR, generatePumpfun } from '../src/node';

const r = generatePumpfun(FIXTURE_DIR);
console.log(`pump.fun fixture: ${r.blocks} blocks, ${r.trades} launch trades → ${FIXTURE_DIR}/pumpfun.json`);
