import Link from 'next/link';
import type { Metadata } from 'next';
import { CheckSearch } from '@/components/check/client';
import { TokenReport, WalletReport } from '@/components/check/report';
import { Empty } from '@/components/ui';
import { short } from '@/lib/format';
import { tokenCheck, walletCheck } from '@/lib/server/check';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ mint: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { mint } = await params;
  const r = await tokenCheck(mint);
  const b = r.body as { found?: boolean; grade?: string; verdict?: string; name?: string };
  if (r.status === 200 && b.found) {
    return { title: `${b.grade} risk · ${b.name ?? short(mint, 4)}`, description: b.verdict, openGraph: { title: `Fairway Check: ${b.grade} risk`, description: b.verdict } };
  }
  return { title: `Check ${short(mint, 4)}` };
}

function Problem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <Empty title={title}>{children}</Empty>
      <CheckSearch size="md" />
      <p className="text-center text-sm text-ink-2">
        <Link href="/check" className="text-accent hover:underline">
          Back to examples
        </Link>
      </p>
    </div>
  );
}

export default async function CheckReport({ params }: Params) {
  const { mint } = await params;
  const t = await tokenCheck(mint);
  if (t.status === 400) return <Problem title="That is not a Solana address">Token mints and wallets are 32–44 characters of letters and numbers. Check what you pasted and try again.</Problem>;
  if (t.status >= 500) return <Problem title="We could not reach the data service">It may be restarting. Try again in a moment.</Problem>;
  const tb = t.body as Awaited<ReturnType<typeof tokenCheck>>['body'] & { found?: boolean; source: 'live' | 'simulated' };
  if (tb.found) return <TokenReport r={tb as never} name={(tb as { name?: string }).name} source={tb.source} />;
  const w = await walletCheck(mint);
  const wb = w.body as { found?: boolean; source: 'live' | 'simulated' };
  if (w.status === 200 && wb.found) return <WalletReport r={wb as never} source={wb.source} />;
  return (
    <Problem title="No launch data for this address yet">
      We have not seen this token or wallet in the Pump.fun / PumpSwap data we index. It may be too new, or not launched there. A wallet with no history would pay the STANDARD fee on Fairway.
    </Problem>
  );
}
