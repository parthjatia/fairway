/**
 * Stream L entry point (bundled into streams/pumpfun-filter.js): launch trades AND wallet fundings from the same blocks.
 * Pump.fun / PumpSwap trades feed sniper scores; fundings of brand-new wallets feed bundle detection
 * (packages/scoring/src/bundle.ts).
 */
import { parseFundingPayload, MIN_FUNDING_SOL, type FundingRecord } from './funding';
import { parsePumpPayload, PUMP_PROGRAMS, type LaunchTradeRecord, type PumpPrograms } from './pumpfun';

export type LaunchStreamOutput = { launchTrades: LaunchTradeRecord[]; fundings: FundingRecord[] };

/** null when the payload has neither, as a Streams filter must return for "nothing to deliver". */
export function parseLaunchStream(data: any, programs: PumpPrograms = PUMP_PROGRAMS, minFundingSol: number = MIN_FUNDING_SOL): LaunchStreamOutput | null {
  const launchTrades = parsePumpPayload(data, programs);
  const fundings = parseFundingPayload(data, minFundingSol);
  if (!launchTrades.length && !fundings.length) return null;
  return { launchTrades, fundings };
}

export { parsePumpPayload, parseFundingPayload };
