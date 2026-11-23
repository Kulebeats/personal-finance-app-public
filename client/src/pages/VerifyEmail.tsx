import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useVerifyEmail } from "@/hooks/useSecurity";
import { handleResendVerificationApi } from "@/pages/Login/useAuthHandlers";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, XCircle, Loader2, RefreshCw, AlertCircle } from "lucide-react";

export default function VerifyEmail() {
  const { mutateAsync: verifyEmail } = useVerifyEmail();
  const verificationStarted = useRef(false);
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading"
  );
  const [message, setMessage] = useState("");
  const [isResending, setIsResending] = useState(false);
  const [email, setEmail] = useState("");
  const [resendStatus, setResendStatus] = useState<
    "idle" | "requested" | "error"
  >("idle");

  useLayoutEffect(() => {
    // StrictMode replays effects; a one-use token must only be submitted once.
    if (verificationStarted.current) return;
    verificationStarted.current = true;
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token");
    // Capture in this lifecycle, never during render, then remove the bearer
    // before rendering the result or starting the request. Keep other URL state.
    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }

    if (!token) {
      setStatus("error");
      setMessage("No verification token provided");
      return;
    }

    // Await the mutation itself: per-call mutate callbacks can be dropped when
    // StrictMode re-subscribes the observer while this request is in flight.
    void verifyEmail(token).then(
      () => {
        setStatus("success");
        setMessage("Your email has been verified successfully!");
      },
      (error: Error) => {
        setStatus("error");
        setMessage(error.message || "Failed to verify email");
      },
    );
  }, [verifyEmail]);

  async function requestNewLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isResending || !email.trim()) return;
    setIsResending(true);
    setResendStatus("idle");
    const result = await handleResendVerificationApi(email.trim());
    setResendStatus(result.success ? "requested" : "error");
    setIsResending(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-white to-purple-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            {status === "loading" && (
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-primary animate-spin motion-reduce:animate-none" />
              </div>
            )}
            {status === "success" && (
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
            )}
            {status === "error" && (
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                <XCircle className="w-8 h-8 text-red-600" />
              </div>
            )}
          </div>
          <CardTitle className="text-2xl">
            {status === "loading" && "Verifying Email..."}
            {status === "success" && "Email Verified!"}
            {status === "error" && "Verification Failed"}
          </CardTitle>
          <CardDescription className="text-base" role="status" aria-live="polite">
            {message || "Please wait while we verify your email address."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "success" && (
            <Button className="w-full" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          )}
          {status === "error" && (
            <div className="space-y-4">
              <form onSubmit={requestNewLink} className="space-y-3">
                <Label htmlFor="verification-email">Email address</Label>
                <Input
                  id="verification-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isResending}
                />
                <Button type="submit" className="w-full" disabled={isResending}>
                  {isResending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin motion-reduce:animate-none" />
                      Requesting...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Request a new verification link
                    </>
                  )}
                </Button>
              </form>
              {resendStatus === "requested" && (
                <p role="status" className="text-sm">
                  If this address has an unverified account, a new verification link has been requested.
                  Check your inbox and spam folder.
                </p>
              )}
              {resendStatus === "error" && (
                <p role="alert" className="text-sm text-destructive">
                  We couldn't request a new link. Please try again.
                </p>
              )}
              <Button variant="outline" className="w-full" asChild>
                <Link href="/login">Sign in</Link>
              </Button>

              <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-700 dark:text-amber-300">
                  <p className="font-medium">Verification links expire</p>
                  <p className="text-amber-600 dark:text-amber-400 mt-1">
                    For a registration link, enter your email address above to request a new one.
                  </p>
                  <p className="mt-2">
                    For an email address change, sign in to your account and request a new link in{" "}
                    <Link href="/settings/security" className="underline">
                      Security Settings
                    </Link>.
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
