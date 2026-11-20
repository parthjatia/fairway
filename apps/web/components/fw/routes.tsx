'use client';
// Client switches between the real (devnet) experience and the hidden ?demo=1 simulated one.
import { useDemo } from '@/lib/client/fairway';
import { SwapPanel } from '../swap-panel';
import { SwapCard } from './swap-card';

export function SwapRoute() {
  const demo = useDemo();
  return demo ? <SwapPanel /> : <SwapCard />;
}
