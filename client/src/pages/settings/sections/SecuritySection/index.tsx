import React, { Suspense } from "react";
import { ErrorBoundary } from "@/features/settings/components/ErrorBoundary";
import { LoadingSection } from "@/features/settings/components/LoadingSection";
import { useMfaStatus } from "@/hooks/useSecurity";
import { SecurityHeader } from "./components/SecurityHeader";
import { MfaWarningBanner } from "./components/MfaWarningBanner";
import { EmailPasswordCard } from "./components/EmailPasswordCard";
import { SessionsCard } from "./components/SessionsCard";
import { LoginHistoryCard } from "./components/LoginHistoryCard";

export default function SecuritySection() {
  const { data: mfaStatus } = useMfaStatus();

  return (
    <ErrorBoundary sectionName="Security">
      <Suspense fallback={<LoadingSection variant="form" />}>
        <div className="space-y-6">
          <SecurityHeader />
          {mfaStatus?.mfaEnabled && mfaStatus?.lowCodesWarning && (
            <MfaWarningBanner
              backupCodesRemaining={mfaStatus.backupCodesRemaining}
            />
          )}
          <EmailPasswordCard />
          <SessionsCard />
          <LoginHistoryCard />
        </div>
      </Suspense>
    </ErrorBoundary>
  );
}
