import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface MfaCodeFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Sends (or re-sends) the emailed code. */
  onSend: () => void;
  isSending: boolean;
  hasSent: boolean;
  disabled?: boolean;
}

/** Six-digit emailed-code input with its own send / resend control. */
export function MfaCodeField({ id, value, onChange, onSend, isSending, hasSent, disabled }: MfaCodeFieldProps) {
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>6-digit code from your email</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
          aria-describedby={hintId}
          disabled={disabled}
          placeholder="123456"
        />
        <Button type="button" variant="outline" onClick={onSend} disabled={isSending || disabled}>
          {isSending ? "Sending..." : hasSent ? "Resend code" : "Send code"}
        </Button>
      </div>
      <p id={hintId} className="text-sm text-muted-foreground">
        {hasSent
          ? "We sent a code to your verified email. It works once and expires in 10 minutes."
          : "We'll email a one-time code to your verified address."}
      </p>
    </div>
  );
}
