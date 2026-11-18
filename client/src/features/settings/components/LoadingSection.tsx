import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { LoadingSectionProps } from '../types/settings';

/**
 * LoadingSection - A skeleton loader for settings sections
 * 
 * Provides loading placeholders that match section layouts to prevent
 * content layout shift. Supports three variants:
 * - card: A card with header and content skeleton
 * - form: Multiple form field skeletons
 * - list: A list of item skeletons
 * 
 * @example
 * <Suspense fallback={<LoadingSection variant="form" rows={4} />}>
 *   <ProfileForm />
 * </Suspense>
 */
export function LoadingSection({ variant = 'card', rows = 3 }: LoadingSectionProps) {
  switch (variant) {
    case 'card':
      return <CardSkeleton />;
    case 'form':
      return <FormSkeleton rows={rows} />;
    case 'list':
      return <ListSkeleton rows={rows} />;
    default:
      return <CardSkeleton />;
  }
}

function CardSkeleton() {
  return (
    <Card className="w-full">
      <CardHeader className="space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-48" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-3/4" />
      </CardContent>
    </Card>
  );
}

function FormSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-6" role="status" aria-label="Loading form">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="space-y-2">
          {/* Label skeleton */}
          <Skeleton className="h-4 w-24" />
          {/* Input skeleton */}
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      {/* Button skeleton */}
      <Skeleton className="h-10 w-24" />
      <span className="sr-only">Loading...</span>
    </div>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading list">
      {Array.from({ length: rows }).map((_, index) => (
        <div 
          key={index} 
          className="flex items-center space-x-4 p-4 border rounded-lg"
        >
          {/* Avatar/Icon skeleton */}
          <Skeleton className="h-10 w-10 rounded-full" />
          {/* Content skeleton */}
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          {/* Action skeleton */}
          <Skeleton className="h-8 w-8" />
        </div>
      ))}
      <span className="sr-only">Loading...</span>
    </div>
  );
}

// Export for testing
export type { LoadingSectionProps };
