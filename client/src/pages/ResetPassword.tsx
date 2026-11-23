/**
 * Reset Password Page (R1)
 *
 * Public page: complete a password reset using the token from the emailed
 * link (?token=...). Uses the same password-strength UX as registration.
 * Invalid/expired tokens surface the server's single generic error with a
 * link to request a new one (no oracle about which check failed).
 */

import { PASSWORD_MAX_LENGTH } from "@shared/password-policy";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle, ShieldAlert, LockKeyhole } from "lucide-react";
import { FormField } from "@/features/settings/components";
import {
  PasswordStrengthMeter,
  usePasswordValidation,
} from "@/components/auth";
import { handleResetPasswordApi } from "./Login/useAuthHandlers";

type Status = "form" | "success" | "invalid";

export default function ResetPassword() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("form");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const passwordValidation = usePasswordValidation(password);
  const passwordsMatch =
    confirmPassword.length === 0 || password === confirmPassword;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get("token");
    if (!tokenParam) {
      setStatus("invalid");
      setErrorMessage("This reset link is missing its token.");
      return;
    }
    setToken(tokenParam);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !passwordValidation.isValid || password !== confirmPassword) {
      return;
    }
    setIsLoading(true);
    setErrorMessage("");
    try {
      const result = await handleResetPasswordApi(token, password);
      if (result.success) {
        setStatus("success");
      } else {
        // The server returns one generic message for unknown/expired/used
        // tokens; treat any non-validation failure as an invalid link.
        setStatus("invalid");
        setErrorMessage(
          result.message ||
            "This password reset link is invalid or has expired.",
        );
      }
    } catch {
      setErrorMessage("Failed to connect to server. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-blue-50 via-white to-purple-50 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              {status === "success" ? (
                <CheckCircle className="w-8 h-8 text-green-600" aria-hidden="true" />
              ) : status === "invalid" ? (
                <ShieldAlert className="w-8 h-8 text-destructive" aria-hidden="true" />
              ) : (
                <LockKeyhole className="w-8 h-8 text-primary" aria-hidden="true" />
              )}
            </div>
          </div>
          <div className="text-center">
            <CardTitle className="text-2xl font-bold">
              {status === "success"
                ? "Password reset"
                : status === "invalid"
                  ? "Link invalid or expired"
                  : "Choose a new password"}
            </CardTitle>
            <CardDescription>
              {status === "success"
                ? "Your password has been updated and all other sessions were signed out."
                : status === "invalid"
                  ? errorMessage ||
                    "This password reset link is invalid or has expired."
                  : "Set a strong password for your account."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "success" && (
            <Button asChild className="w-full">
              <Link href="/login">Sign in with your new password</Link>
            </Button>
          )}

          {status === "invalid" && (
            <div className="space-y-3">
              <Button asChild className="w-full">
                <Link href="/forgot-password">Request a new reset link</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">Back to sign in</Link>
              </Button>
            </div>
          )}

          {status === "form" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <FormField label="New Password" htmlFor="newPassword" required>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  aria-describedby="password-requirements"
                  required
                  minLength={8}
                  maxLength={PASSWORD_MAX_LENGTH}
                />
                <div id="password-requirements" className="mt-2">
                  <PasswordStrengthMeter password={password} />
                </div>
              </FormField>

              <FormField
                label="Confirm Password"
                htmlFor="confirmPassword"
                required
              >
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Re-enter your new password"
                  maxLength={PASSWORD_MAX_LENGTH}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                {!passwordsMatch && (
                  <p role="alert" className="text-xs text-destructive mt-1">
                    Passwords do not match
                  </p>
                )}
              </FormField>

              {errorMessage && (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage}
                </p>
              )}

              <Button
                type="submit"
                className="w-full bg-rose-400 hover:bg-rose-500"
                disabled={
                  isLoading ||
                  !passwordValidation.isValid ||
                  password !== confirmPassword ||
                  confirmPassword.length === 0
                }
              >
                {isLoading ? (
                  <>
                    <Loader2
                      className="w-4 h-4 mr-2 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    Resetting password...
                  </>
                ) : (
                  "Reset password"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
