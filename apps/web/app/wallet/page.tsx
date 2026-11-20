import Link from 'next/link';
import { exampleWallets } from '@/lib/server/data';
import { Card, PageHeader, TierBadge } from '@/components/ui';
import { WalletSearch } from '@/components/wallet-search';
import { short, signed } from '@/lib/format';

export const metadata = { title: 'Score explorer — Fairway' };

export default function WalletIndex() {
  const ex = exampleWallets();
  return (
    <>
      <PageHeader eyebrow="Score explorer" title="Look up any wallet's toxicity score">
        Every score is public and recomputable from swap history. Paste an address, or open one of the fixture wallets below.
      </PageHeader>
      <div className="space-y-6">
        <WalletSearch />
        <Card title="Example wallets" subtitle="Personas and a sample of each tier from the deterministic fixture set.">
          <div className="divide-y divide-line">
            {ex.map((w) => (
              <Link key={w.address} href={`/wallet/${w.address}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-surface-2 sm:px-2">
                <TierBadge tier={w.tier} />
                <span className="font-mono text-sm text-ink">{short(w.address, 6)}</span>
                {w.label && <span className="text-sm text-ink-2">{w.label}</span>}
                <span className="ml-auto text-xs text-muted tnum">
                  {w.trades} trades · score {signed(w.scoreBps)} bps
                </span>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
