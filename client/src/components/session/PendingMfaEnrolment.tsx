import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useSession } from "@/contexts/SessionContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MfaActionDialog } from "@/pages/settings/sections/SecuritySection/components/mfa/MfaActionDialog";
import { formatMfaDeadline } from "./mfaDeadline";
import { signOut } from "./sessionSignOut";

interface PendingMfaEnrolmentProps {
  graceEndedAt: string;
}

/**
 * AH-11: the MFA grace has ended and this member has not enrolled. The app stays
 * closed until enrolment is confirmed; closing the dialog re-reads the session,
 * which opens the app once MFA is on (the backup codes are shown first).
 */
export function PendingMfaEnrolment({ graceEndedAt }: PendingMfaEnrolmentProps) {
  const { refresh, actionError } = useSession();
  const [enrolling, setEnrolling] = useState(false);

  const close = () => {
    setEnrolling(false);
    void refresh();
  };

  return (
    <main className="relative min-h-screen flex items-center justify-center bg-linear-to-br from-blue-50 via-white to-purple-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-primary" aria-hidden="true" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold leading-none tracking-tight">Set up two-step verification</h1>
            <CardDescription>
              Every member now needs a code from their email as well as their password. Set it up to open your
              finances. It was required from {formatMfaDeadline(graceEndedAt)}.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {actionError && <p role="status" className="text-sm text-muted-foreground text-center">{actionError}</p>}
          <Button className="w-full" onClick={() => setEnrolling(true)}>
            Set up two-step verification
          </Button>
          <Button variant="ghost" className="w-full" onClick={signOut}>
            Sign out
          </Button>
        </CardContent>
      </Card>
      {enrolling && <MfaActionDialog action="enable" onClose={close} />}
    </main>
  );
}
