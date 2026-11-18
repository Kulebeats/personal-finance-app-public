import React, { Suspense } from 'react';
import { ErrorBoundary } from '@/features/settings/components/ErrorBoundary';
import { LoadingSection } from '@/features/settings/components/LoadingSection';
import { ProfileForm } from './ProfileForm';

/**
 * ProfileSection - Profile settings section wrapper
 * 
 * Wraps ProfileForm with ErrorBoundary and Suspense for:
 * - Graceful error handling with retry option
 * - Loading state with skeleton placeholder
 * - Section isolation (errors don't affect other sections)
 * 
 * Requirements: 1.2, 1.3, 1.4
 */
export default function ProfileSection() {
  return (
    <ErrorBoundary sectionName="Profile">
      <Suspense fallback={<LoadingSection variant="form" rows={8} />}>
        <ProfileForm />
      </Suspense>
    </ErrorBoundary>
  );
}

// Named export for testing
export { ProfileSection };
