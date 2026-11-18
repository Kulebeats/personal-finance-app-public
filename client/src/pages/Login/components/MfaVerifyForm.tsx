/**
 * MFA Verification Form Component
 *
 * Handles MFA code entry during login flow.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { FormField } from "@/features/settings/components";

interface MfaVerifyFormProps {
  mfaCode: string;
  setMfaCode: (code: string) => void;
  isBackupCode: boolean;
  setIsBackupCode: (isBackup: boolean) => void;
  maskedEmail: string;
  isLoading: boolean;
  resendCooldown: number;
  onSubmit: (e: React.FormEvent) => void;
  onResend: () => void;
  onBack: () => void;
}

export function MfaVerifyForm({
  mfaCode,
  setMfaCode,
  isBackupCode,
  setIsBackupCode,
  maskedEmail,
  isLoading,
  resendCooldown,
  onSubmit,
  onResend,
  onBack,
}: MfaVerifyFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="text-center mb-6">
        <p className="text-sm text-foreground mb-1 font-medium">
          Two-Factor Authentication
        </p>
        <p className="text-sm text-muted-foreground">
          {isBackupCode
            ? "Enter one of your 8-character backup codes."
            : `Enter the 6-digit code sent to ${maskedEmail}`}
        </p>
      </div>

      <FormField
        label={isBackupCode ? "Backup Code" : "Verification Code"}
        htmlFor="mfaCode"
        required
      >
        <Input
          id="mfaCode"
          type="text"
          inputMode="numeric"
          pattern={isBackupCode ? undefined : "[0-9]*"}
          maxLength={isBackupCode ? 8 : 6}
          placeholder={isBackupCode ? "12345678" : "123456"}
          value={mfaCode}
          onChange={(e) => setMfaCode(e.target.value)}
          autoComplete="one-time-code"
          className="text-center text-lg tracking-widest"
          required
        />
      </FormField>

      <Button
        type="submit"
        className="w-full bg-rose-400 hover:bg-rose-500"
        disabled={isLoading || mfaCode.length < (isBackupCode ? 8 : 6)}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin motion-reduce:animate-none" />
            Verifying...
          </>
        ) : (
          "Verify Code"
        )}
      </Button>

      <div className="flex flex-col items-center gap-2 mt-4">
        {!isBackupCode && (
          <button
            type="button"
            onClick={onResend}
            disabled={resendCooldown > 0}
            className="text-sm text-primary hover:underline disabled:opacity-50 disabled:no-underline"
          >
            {resendCooldown > 0
              ? `Resend code in ${resendCooldown}s`
              : "Resend code"}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setIsBackupCode(!isBackupCode);
            setMfaCode("");
          }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {isBackupCode
            ? "Use verification code instead"
            : "Use a backup code"}
        </button>
      </div>

      <div className="text-center text-sm">
        <button
          type="button"
          onClick={onBack}
          className="text-primary hover:underline font-medium"
        >
          Back to Login
        </button>
      </div>
    </form>
  );
}
