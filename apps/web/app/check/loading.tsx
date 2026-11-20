import { Skeleton } from '@/components/ui';

export default function Loading() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center py-8 sm:py-16" aria-busy aria-label="Loading">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-3 h-10 w-full max-w-md" />
      <Skeleton className="mt-4 h-12 w-full" />
      <Skeleton className="mt-8 h-14 w-full rounded-xl" />
      <div className="mt-8 grid w-full gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[92px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
