import { Skeleton } from '@/components/ui';

/** Same blocks as the report, so nothing shifts when the data arrives. */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading report">
      <div>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-3 h-10 w-72" />
        <Skeleton className="mt-4 h-9 w-full max-w-xl" />
      </div>
      <Skeleton className="h-[132px] w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[116px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[152px] w-full rounded-xl" />
      <Skeleton className="h-[420px] w-full rounded-xl" />
    </div>
  );
}
