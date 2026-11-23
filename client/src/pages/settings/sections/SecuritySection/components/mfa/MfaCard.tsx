import React, { useState } from "react";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { useMfaStatus } from "@/hooks/useSecurity";
import { MfaActionDialog, type MfaAction } from "./MfaActionDialog";
import { daysLeftLabel, formatMfaDeadline } from "@/components/session/mfaDeadline";

/** Security settings panel for email-code two-step verification. */
export function MfaCard() {
  const { data: status, isLoading, isError } = useMfaStatus();
  const [action, setAction] = useState<MfaAction | null>(null);
  const isOn = status?.mfaEnabled === true;
  const policy = status?.policy;
  const deadline = !isOn && policy && policy.state !== "compliant" ? policy : null;

  return (
    <SettingsCard
      title="Two-step verification"
      description="Ask for a code from your email as well as your password when you sign in"
      isLoading={isLoading}
    >
      {isError ? (
        <p role="alert" className="text-sm text-destructive">
          We couldn't load your two-step verification settings. Refresh the page to try again.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
            {isOn ? (
              <ShieldCheck className="h-5 w-5 text-green-600" aria-hidden="true" />
            ) : (
              <ShieldOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            )}
            <div className="flex-1">
              <p className="font-medium">Email code</p>
              {isOn && (
                <p className="text-sm text-muted-foreground">
                  {status.backupCodesRemaining} backup code{status.backupCodesRemaining === 1 ? "" : "s"} left
                </p>
              )}
            </div>
            <Badge variant={isOn ? "default" : "secondary"}>{isOn ? "On" : "Off"}</Badge>
          </div>
          {deadline && (
            <p className="text-sm text-muted-foreground">
              Two-step verification will be required from {formatMfaDeadline(deadline.graceEndsAt)} ({daysLeftLabel(deadline.daysRemaining)}).
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {isOn ? (
              <>
                <Button variant="outline" onClick={() => setAction("regenerate")}>Create new backup codes</Button>
                <Button variant="outline" className="text-destructive" onClick={() => setAction("disable")}>
                  Turn off
                </Button>
              </>
            ) : (
              <Button onClick={() => setAction("enable")}>Turn on two-step verification</Button>
            )}
          </div>
        </div>
      )}
      {/* Unmounted when closed, so no observer keeps a secret-bearing mutation alive. */}
      {action && <MfaActionDialog key={action} action={action} onClose={() => setAction(null)} />}
    </SettingsCard>
  );
}
