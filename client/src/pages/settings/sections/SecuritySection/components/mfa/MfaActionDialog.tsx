import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  mfaErrorMessage, useConfirmMfaEnrolment, useDisableMfa, useForgetMfaSecrets, useRegenerateBackupCodes,
  useSendMfaCode, useStartMfaEnrolment,
} from "@/hooks/useMfaManagement";
import { MfaCodeField } from "./MfaCodeField";
import { MfaBackupCodesPanel } from "./MfaBackupCodesPanel";

export type MfaAction = "enable" | "regenerate" | "disable";

interface MfaActionDialogProps {
  action: MfaAction | null;
  onClose: () => void;
}

const COPY: Record<MfaAction, { title: string; description: string; submit: string }> = {
  enable: {
    title: "Turn on two-step verification",
    description: "When you sign in, we'll also ask for a code sent to your email. Send a code now to confirm you can receive it.",
    submit: "Turn on",
  },
  regenerate: {
    title: "Create new backup codes",
    description: "Your current backup codes will stop working. Enter a code from your email to continue.",
    submit: "Create new codes",
  },
  disable: {
    title: "Turn off two-step verification",
    description: "Signing in will only need your password. Confirm with your password and a code from your email.",
    submit: "Turn off",
  },
};

/** One dialog for enrolment, backup-code regeneration and disabling. */
export function MfaActionDialog({ action, onClose }: MfaActionDialogProps) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [hasSent, setHasSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const startEnrolment = useStartMfaEnrolment();
  const sendCode = useSendMfaCode();
  const confirmEnrolment = useConfirmMfaEnrolment();
  const regenerate = useRegenerateBackupCodes();
  const disable = useDisableMfa();
  const forgetSecrets = useForgetMfaSecrets();
  // Any unmount (navigation included) drops secrets, even from a pending request.
  useEffect(() => forgetSecrets, [forgetSecrets]);

  const sender = action === "enable" ? startEnrolment : sendCode;
  const isSubmitting = confirmEnrolment.isPending || regenerate.isPending || disable.isPending;
  const mustAcknowledgeCodes = backupCodes !== null;
  // Closing mid-request could turn MFA on (or replace the old backup codes)
  // without ever showing the new codes, so these two requests can't be
  // cancelled. The lock is bounded: they give up after CODE_ISSUING_TIMEOUT_MS.
  const isIssuingCodes = confirmEnrolment.isPending || regenerate.isPending;

  const reset = () => {
    setCode(""); setPassword(""); setHasSent(false); setError(null); setBackupCodes(null);
    // Drop OTP, password and backup codes from the React Query mutation cache,
    // including a request still in flight (TanStack keeps pending mutations).
    confirmEnrolment.reset(); regenerate.reset(); disable.reset();
    forgetSecrets();
  };
  /** Codes are copied into component state, then the mutation is cleared at once. */
  const showCodes = (reset: () => void) => (codes: string[]) => { setBackupCodes(codes); reset(); forgetSecrets(); };
  const close = () => { reset(); onClose(); };

  const send = () => {
    setError(null);
    const callbacks = {
      onSuccess: () => setHasSent(true),
      onError: (failure: unknown) => setError(mfaErrorMessage(failure)),
    };
    if (action === "enable") startEnrolment.mutate(undefined, callbacks);
    else if (action) sendCode.mutate(action, callbacks);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const onError = (failure: unknown) => setError(mfaErrorMessage(failure));
    if (action === "enable") confirmEnrolment.mutate(code, { onSuccess: showCodes(confirmEnrolment.reset), onError });
    if (action === "regenerate") regenerate.mutate(code, { onSuccess: showCodes(regenerate.reset), onError });
    if (action === "disable") disable.mutate({ password, code }, { onSuccess: close, onError });
  };

  if (!action) return null;
  const copy = COPY[action];
  const canSubmit = code.length === 6 && (action !== "disable" || password.length > 0) && !isSubmitting;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Backup codes are shown once; don't let an Escape or outside click lose them.
        if (!open && !mustAcknowledgeCodes && !isIssuingCodes) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mustAcknowledgeCodes ? "Save your backup codes" : copy.title}</DialogTitle>
          {!mustAcknowledgeCodes && <DialogDescription>{copy.description}</DialogDescription>}
        </DialogHeader>
        {mustAcknowledgeCodes ? (
          <MfaBackupCodesPanel codes={backupCodes} onDone={close} />
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            {action === "disable" && (
              <div className="space-y-2">
                <Label htmlFor="mfa-disable-password">Current password</Label>
                <Input
                  id="mfa-disable-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            )}
            <MfaCodeField
              id={`mfa-${action}-code`}
              value={code}
              onChange={setCode}
              onSend={send}
              isSending={sender.isPending}
              hasSent={hasSent}
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">{error}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={isIssuingCodes}>Cancel</Button>
              <Button type="submit" variant={action === "disable" ? "destructive" : "default"} disabled={!canSubmit}>
                {isSubmitting ? "Checking..." : copy.submit}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
