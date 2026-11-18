import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useVerifyEmail, useResendVerification } from "@/hooks/useSecurity";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2, RefreshCw, AlertCircle } from "lucide-react";

export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const verifyEmail = useVerifyEmail();
  const resendVerification = useResendVerification();
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading"
  );
  const [message, setMessage] = useState("");
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    // Get token from URL
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setStatus("error");
      setMessage("No verification token provided");
      return;
    }

    // Verify the token
    verifyEmail.mutate(token, {
      onSuccess: () => {
        setStatus("success");
        setMessage("Your email has been verified successfully!");
      },
      onError: (error: Error) => {
        setStatus("error");
        setMessage(error.message || "Failed to verify email");
      },
    });
  }, []);

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
          <CardDescription className="text-base">
            {message || "Please wait while we verify your email address."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "success" && (
            <Button
              className="w-full"
              onClick={() => setLocation("/settings/security")}
            >
              Go to Security Settings
            </Button>
          )}
          {status === "error" && (
            <div className="space-y-4">
              {/* UX-005: Retry button to resend verification email */}
              <Button
                className="w-full"
                onClick={() => {
                  setIsResending(true);
                  resendVerification.mutate(undefined, {
                    onSuccess: () => {
                      setIsResending(false);
                      setMessage("A new verification email has been sent. Please check your inbox.");
                    },
                    onError: (error: Error) => {
                      setIsResending(false);
                      setMessage(error.message || "Failed to resend verification email");
                    },
                  });
                }}
                disabled={isResending}
              >
                {isResending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin motion-reduce:animate-none" />
                    Sending...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Resend Verification Email
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setLocation("/settings/security")}
              >
                Back to Settings
              </Button>

              {/* UX-006: Token expiration info */}
              <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-700 dark:text-amber-300">
                  <p className="font-medium">Verification links expire after 24 hours</p>
                  <p className="text-amber-600 dark:text-amber-400 mt-1">
                    If your link has expired, click the button above to request a new one.
                    Check your spam folder if you don't see the email.
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
