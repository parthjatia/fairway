'use client';
import { MODE } from '@/lib/client/state';
import type { LaunchSpec } from '@/lib/launches';
import { LaunchView } from './launch-view';
import { LiveLaunchView } from './live/live-launch';

/** Mock mode (and demo launches): simulated launch view. Live mode: a base58 mint id reads the real pool. */
export function LaunchRoute({ id, demo }: { id: string; demo: LaunchSpec | null }) {
  if (MODE === 'live' && !demo && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id)) return <LiveLaunchView mint={id} />;
  return <LaunchView id={id} demo={demo} />;
}
