import { Suspense } from 'react';
import { ErrorBoundary } from '@/features/settings/components/ErrorBoundary';
import { LoadingSection } from '@/features/settings/components/LoadingSection';
import { NotificationsForm } from './NotificationsForm';
import { PushNotificationSetup } from './PushNotificationSetup';

export default function NotificationsSection() {
  return (
    <ErrorBoundary sectionName="Notifications">
      <Suspense fallback={<LoadingSection variant="form" />}>
        <div className="space-y-6">
          <PushNotificationSetup />
          <NotificationsForm />
        </div>
      </Suspense>
    </ErrorBoundary>
  );
}
