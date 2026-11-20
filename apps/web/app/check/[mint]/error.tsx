'use client';
import Link from 'next/link';
import { Empty } from '@/components/ui';

export default function ErrorState({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-8">
      <Empty title="Something went wrong building this report">Nothing was lost. Try again, or check a different token.</Empty>
      <div className="flex justify-center gap-4 text-sm">
        <button onClick={reset} className="rounded-none border border-line px-4 py-2 font-semibold text-ink hover:bg-surface-2">
          Try again
        </button>
        <Link href="/check" className="rounded-none px-4 py-2 font-semibold text-accent hover:underline">
          Back to Check
        </Link>
      </div>
    </div>
  );
}
