import { Suspense } from 'react';
import { ErrorBoundary } from '@/features/settings/components/ErrorBoundary';
import { LoadingSection } from '@/features/settings/components/LoadingSection';
import { DisplayForm } from './DisplayForm';

export default function DisplaySection() {
  return (
    <ErrorBoundary sectionName="Display">
      <Suspense fallback={<LoadingSection variant="form" />}>
        <DisplayForm />
      </Suspense>
    </ErrorBoundary>
  );
}
