import { PageHeader } from '@/components/ui';
import { Explore } from '@/components/fw/explore';
import { pumpTokens } from '@/lib/server/check';

export const metadata = { title: 'Explore' };
export const dynamic = 'force-dynamic';

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [pump, { tab }] = await Promise.all([pumpTokens(50), searchParams]);
  return (
    <>
      <PageHeader eyebrow="03 · Explore" title="Every token, graded for snipers." ruled={false}>
        Tokens trading on Fairway, and real Pump.fun launches from Solana mainnet. Each one has a Fairway Check report: who bought in the first minute, and how much of the early supply snipers took.
      </PageHeader>
      <Explore pump={pump} initialTab={tab === 'pump' ? 'pump' : 'fairway'} />
    </>
  );
}
