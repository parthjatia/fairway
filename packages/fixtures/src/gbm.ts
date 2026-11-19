import { Rng } from './rng';

export const SECONDS_PER_YEAR = 365 * 86_400;

/**
 * Geometric Brownian motion price path (zero drift in log terms by default).
 * Returns `steps + 1` prices, p[0] = s0.
 */
export function gbmPath(opts: { seed: number; s0: number; steps: number; stepSec: number; annualVol: number; drift?: number }): Float64Array {
  const rng = new Rng(opts.seed);
  const dt = opts.stepSec / SECONDS_PER_YEAR;
  const sig = opts.annualVol * Math.sqrt(dt);
  const mu = ((opts.drift ?? 0) - 0.5 * opts.annualVol * opts.annualVol) * dt;
  const out = new Float64Array(opts.steps + 1);
  out[0] = opts.s0;
  for (let i = 1; i <= opts.steps; i++) out[i] = out[i - 1]! * Math.exp(mu + sig * rng.normal());
  return out;
}
