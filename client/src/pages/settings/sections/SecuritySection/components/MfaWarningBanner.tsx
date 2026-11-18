import React from "react";
import { AlertCircle } from "lucide-react";

type MfaWarningBannerProps = {
  backupCodesRemaining: number;
};

export function MfaWarningBanner({
  backupCodesRemaining,
}: MfaWarningBannerProps) {
  return (
    <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
      <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="font-medium text-amber-800 dark:text-amber-200">
          Low MFA Backup Codes
        </p>
        <p className="text-sm text-amber-700 dark:text-amber-300">
          You have only {backupCodesRemaining} backup code
          {backupCodesRemaining !== 1 ? "s" : ""} remaining. Consider generating
          new backup codes to ensure you can always access your account.
        </p>
      </div>
    </div>
  );
}
