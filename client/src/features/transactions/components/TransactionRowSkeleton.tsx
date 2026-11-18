/**
 * Transaction Row Skeleton Component
 *
 * Skeleton placeholder matching TransactionRow layout for loading states.
 */

interface TransactionRowSkeletonProps {
  count?: number;
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30 animate-pulse">
      {/* Icon skeleton */}
      <div className="w-10 h-10 rounded-full bg-muted" />

      {/* Details skeleton */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-4 w-32 bg-muted rounded" />
        <div className="h-3 w-24 bg-muted rounded" />
      </div>

      {/* Date skeleton */}
      <div className="h-3 w-20 bg-muted rounded" />

      {/* Amount skeleton */}
      <div className="h-4 w-16 bg-muted rounded" />

      {/* Status skeleton */}
      <div className="w-8 flex justify-center">
        <div className="h-4 w-4 rounded-full bg-muted" />
      </div>
    </div>
  );
}

export function TransactionRowSkeleton({
  count = 5,
}: Readonly<TransactionRowSkeletonProps>) {
  return (
    <output aria-label="Loading transactions">
      <span className="sr-only">Loading transactions...</span>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={`skeleton-${i}`} />
      ))}
    </output>
  );
}
