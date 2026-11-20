import type { Tier } from '@fairway/scoring';
import { SwapRoute } from '@/components/fw/routes';
import { TierBadge } from '@/components/ui';
import { TIER_FEE } from '@/lib/fees';

export const metadata = { title: 'Swap' };

const TRADE = 200;
const ROWS: [Tier, string][] = [
  ['RETAIL', 'Clean history'],
  ['STANDARD', 'Fresh wallet'],
  ['TOXIC', 'Known sniper or arb bot'],
];
const th = 'border-b border-ink py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-2';

export default function SwapPage() {
  return (
    <div className="-mt-8 grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] sm:-mt-12">
      <div className="fw-in py-12 sm:pr-10">
        <div className="label">01 · Swap · devnet</div>
        <h1 className="mt-3.5 text-[40px] leading-[1.05] sm:text-[48px]">Fair flow pays less.</h1>
        <div className="mt-7 max-w-[480px]">
          <SwapRoute />
        </div>
        <p className="mt-4 max-w-[480px] text-xs leading-relaxed text-ink-2">
          Your fee comes from an onchain score derived from your own wallet: clean history pays less, snipers and arbitrage bots pay more, and a new wallet pays the standard fee. Set Phantom to devnet.
        </p>
      </div>
      <div className="border-line pb-10 sm:border-l sm:pl-10 sm:pt-12">
        <h2 className="display text-[28px] leading-tight">Fee schedule</h2>
        <p className="mt-1.5 text-sm text-ink-2">The same trade, priced by wallet history.</p>
        <table className="mt-4 w-full border-collapse text-left">
          <caption className="sr-only">Swap fee by tier</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>Tier</th>
              <th scope="col" className={th}>Who</th>
              <th scope="col" className={`${th} text-right`}>Fee</th>
              <th scope="col" className={`${th} text-right`}>On ${TRADE}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([tier, who]) => (
              <tr key={tier}>
                <td className="border-b border-line py-3.5">
                  <TierBadge tier={tier} />
                </td>
                <td className="border-b border-line py-3.5 text-sm text-ink-2">{who}</td>
                <td className="border-b border-line py-3.5 text-right font-mono text-[13px]">{(TIER_FEE[tier] / 100).toFixed(2)}%</td>
                <td className="display border-b border-line py-3.5 text-right text-xl">${((TRADE * TIER_FEE[tier]) / 10_000).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3.5 text-[13px] text-ink-2">Toxic fees above Standard go to liquidity providers, with a share rebated to Retail wallets.</p>
      </div>
    </div>
  );
}
