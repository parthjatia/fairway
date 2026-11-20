import { CheckLanding } from '@/components/check/landing';

export const metadata = { title: 'Check a token' };
export const dynamic = 'force-dynamic';

export default async function CheckIndex({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const demo = (await searchParams).demo === '1';
  return <CheckLanding demo={demo} autoFocus />;
}
