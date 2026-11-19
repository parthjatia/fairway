import { LaunchRoute } from '@/components/launch-route';
import { DEMO_LAUNCHES } from '@/lib/launches';

export const metadata = { title: 'Launch — Fairway' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LaunchRoute id={id} demo={DEMO_LAUNCHES.find((l) => l.id === id) ?? null} />;
}
