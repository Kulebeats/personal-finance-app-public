import { useState } from "react";
import { Link } from "wouter";
import { ShieldAlert, X } from "lucide-react";
import type { SessionMfaGrace } from "@shared/session-status";
import { Button } from "@/components/ui/button";
import { daysLeftLabel, formatMfaDeadline } from "./mfaDeadline";

interface MfaGraceBannerProps {
  grace: SessionMfaGrace;
}

/** AH-11: the in-app reminder while a member without MFA is inside the grace. */
export function MfaGraceBanner({ grace }: MfaGraceBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <section
      aria-label="Two-step verification"
      className="flex items-start gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex-1 space-y-1">
        <p>Two-step verification will be required from {formatMfaDeadline(grace.graceEndsAt)}.</p>
        <p>
          <span className="font-medium">{daysLeftLabel(grace.daysRemaining)}</span>{" "}
          {/* Below 768 px every control is a 44 px touch target (e2e/completion-r18-layout.spec.ts). */}
          <Link href="/settings/security" className="inline-flex items-center underline max-md:min-h-11">Set it up now</Link>
        </p>
      </div>
      <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Dismiss reminder" onClick={() => setDismissed(true)}>
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </section>
  );
}
