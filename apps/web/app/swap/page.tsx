import { PageHeader } from '@/components/ui';
import { SwapPanel } from '@/components/swap-panel';

export const metadata = { title: 'Swap — Fairway' };

export default function SwapPage() {
  return (
    <>
      <PageHeader eyebrow="Swap" title="Your fee depends on how you trade">
        Pick a demo persona at the top right. The pool reads your tier from an onchain score account derived from your own wallet, so the fee you see is the fee you pay. In mock mode the
        swap runs on a simulated pool with the program&apos;s exact integer math.
      </PageHeader>
      <SwapPanel />
    </>
  );
}
