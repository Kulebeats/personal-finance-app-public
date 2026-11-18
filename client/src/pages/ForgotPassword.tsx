/**
 * Forgot Password Page (R1)
 *
 * Public page: request a password reset link by email.
 * SECURITY: always shows the same generic success state whether or not the
 * email is registered (enumeration safety mirrors the server response).
 */

import { useState } from "react";
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
import { Loader2, MailCheck, KeyRound, ArrowLeft } from "lucide-react";
import { FormField } from "@/features/settings/components";
import { handleForgotPasswordApi } from "./Login/useAuthHandlers";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage("");
    try {
      const result = await handleForgotPasswordApi(email);
      if (result.success) {
        setIsSubmitted(true);
      } else {
        setErrorMessage(result.message || "Something went wrong. Please try again.");
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
              {isSubmitted ? (
                <MailCheck className="w-8 h-8 text-primary" aria-hidden="true" />
              ) : (
                <KeyRound className="w-8 h-8 text-primary" aria-hidden="true" />
              )}
            </div>
          </div>
          <div className="text-center">
            <CardTitle className="text-2xl font-bold">
              {isSubmitted ? "Check your email" : "Forgot your password?"}
            </CardTitle>
            <CardDescription>
              {isSubmitted
                ? "If that email is registered, we sent a link to reset your password."
                : "Enter your email address and we'll send you a reset link."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSubmitted ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                The link expires in 1 hour. Check your spam folder if you don't
                see the email.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">
                  <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
                  Back to sign in
                </Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <FormField label="Email" htmlFor="forgotEmail" required>
                <Input
                  id="forgotEmail"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </FormField>

              {errorMessage && (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage}
                </p>
              )}

              <Button
                type="submit"
                className="w-full bg-rose-400 hover:bg-rose-500"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2
                      className="w-4 h-4 mr-2 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    Sending reset link...
                  </>
                ) : (
                  "Send reset link"
                )}
              </Button>

              <div className="text-center text-sm text-muted-foreground">
                Remembered your password?{" "}
                <Link href="/login" className="text-primary hover:underline font-medium">
                  Sign in
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
