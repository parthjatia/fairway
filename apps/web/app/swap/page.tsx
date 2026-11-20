import { SwapRoute } from '@/components/fw/routes';

export const metadata = { title: 'Swap' };

export default function SwapPage() {
  return (
    <div className="mx-auto max-w-[480px] py-2 sm:py-6">
      <SwapRoute />
      <p className="mt-4 text-xs leading-relaxed text-muted">
        Your fee comes from an onchain score derived from your own wallet: clean history pays less, snipers and arbitrage bots pay more, and a new wallet pays the standard fee. Set Phantom to devnet.
      </p>
    </div>
  );
}
