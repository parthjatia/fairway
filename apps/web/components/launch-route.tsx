'use client';
import type { LaunchSpec } from '@/lib/launches';
import { LaunchView } from './launch-view';
import { FwLaunchDetail } from './fw/launch-detail';

/** A base58 mint reads the real pool on devnet. Named demo launches (frog, cat, …) are the simulated ones behind ?demo=1. */
export function LaunchRoute({ id, demo }: { id: string; demo: LaunchSpec | null }) {
  if (!demo && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id)) return <FwLaunchDetail mint={id} />;
  return <LaunchView id={id} demo={demo} />;
}
