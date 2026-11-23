import { userErrorMessage } from "@/lib/errorCopy";
import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { useSession } from "@/contexts/SessionContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { HouseholdCalendarZone } from "./HouseholdCalendarZone";
import { StepUpProvider } from "@/components/security/StepUpProvider";
import { apiCall } from "@/lib/api";
import { handleMfaVerifyApi, handleResendMfaApi } from "@/pages/Login/useAuthHandlers";
import { MfaVerifyForm } from "@/pages/Login/components/MfaVerifyForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { MailCheck } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PersonalSessionShell } from "./PersonalSessionShell";
import { PendingMfaEnrolment } from "./PendingMfaEnrolment";
import { MfaGraceBanner } from "./MfaGraceBanner";
import { signOut } from "./sessionSignOut";

function PendingMfa() {
  const { actionError } = useSession();
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <main className="mx-auto max-w-md p-6">
      <h1>Complete sign in</h1>
      {(actionError || error) && <p role="alert">{actionError || error}</p>}
      <MfaVerifyForm
        mfaCode={code}
        setMfaCode={setCode}
        isBackupCode={backup}
        setIsBackupCode={setBackup}
        maskedEmail="your email"
        isLoading={busy}
        resendCooldown={0}
        onSubmit={async event => {
          event.preventDefault();
          setBusy(true);
          const result = await handleMfaVerifyApi(code);
          setBusy(false);
          if (!result.success) setError(result.message || "Verification failed");
        }}
        onResend={() => { void handleResendMfaApi(); }}
        onBack={signOut}
      />
    </main>
  );
}

export function PendingVerification() {
  const { refresh, actionError } = useSession();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const resend = async () => {
    setBusy(true);
    try {
      const result = await apiCall<{ data?: { delivery?: string } }>(
        "/settings/security/email/resend", { method: "POST" },
      );
      switch (result.data?.delivery) {
        case "accepted":
          setMessage("Verification email accepted for delivery. Check your inbox.");
          break;
        case "not_required":
          setMessage("Your email is already verified. Refresh your verification status.");
          break;
        case "unavailable":
          setMessage("Email delivery is currently unavailable. Please try again later.");
          break;
        default:
          setMessage("Verification requested; email delivery is not confirmed.");
      }
    } catch (error) {
      setMessage(userErrorMessage(error, "Unable to resend verification"));
    } finally {
      setBusy(false);
    }
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
              <MailCheck className="w-8 h-8 text-primary" aria-hidden="true" />
            </div>
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold leading-none tracking-tight">Verify your email</h1>
            <CardDescription>
              Verify your email address before opening your finances.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {(message || actionError) && (
            <p role="status" className="text-sm text-muted-foreground text-center">
              {message || actionError}
            </p>
          )}
          <Button className="w-full" onClick={() => { void refresh(); }}>
            Refresh verification status
          </Button>
          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => { void resend(); }}
          >
            Resend verification email
          </Button>
          <Button variant="outline" className="w-full" asChild>
            <a href="/forgot-password">Account recovery</a>
          </Button>
          <Button variant="ghost" className="w-full" onClick={signOut}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

export function SessionBoundary({ children }: { children: ReactNode }) {
  const { status, loading, error, actionError, refresh, lifetime } = useSession();
  if (loading) {
    return <main role="status" aria-live="polite" className="p-6">Checking your session…</main>;
  }
  if (error) {
    return (
      <main className="p-6 space-y-4">
        <h1>Unable to check your session</h1>
        <p role="alert">{error.message}</p>
        <button onClick={() => { void refresh(); }}>Retry</button>{" "}
        <a href="/login">Sign in</a>{" "}<a href="/forgot-password">Account recovery</a>
      </main>
    );
  }
  if (!status || status.state === "anonymous") return <Redirect to="/login" replace />;
  if (status.state === "mfa_pending") return <PendingMfa key={lifetime?.operation.id} />;
  if (status.state === "verification_pending") return <PendingVerification key={lifetime?.operation.id} />;
  if (!lifetime) return null;
  // AH-11: past the MFA grace only enrolment (step-up prompt included) is reachable.
  if (status.state === "mfa_enrolment_required") {
    return (
      <QueryClientProvider key={lifetime.operation.id} client={lifetime.client}>
        <PendingMfaEnrolment graceEndedAt={status.graceEndedAt} />
        <StepUpProvider />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider key={lifetime.operation.id} client={lifetime.client}>
      <SettingsProvider>
        {actionError && <p role="alert" className="p-4">{actionError}</p>}
        {status.mfa && <MfaGraceBanner grace={status.mfa} />}
        {status.state === "verified_without_household"
          ? <PersonalSessionShell />
          : <HouseholdCalendarZone>{children}</HouseholdCalendarZone>}
        <StepUpProvider />
      </SettingsProvider>
    </QueryClientProvider>
  );
}
