/**
 * Login Form Component
 *
 * Handles email/password authentication.
 */

import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { FormField } from "@/features/settings/components";

interface LoginFormProps {
  loginEmail: string;
  setLoginEmail: (email: string) => void;
  loginPassword: string;
  setLoginPassword: (password: string) => void;
  rememberMe: boolean;
  setRememberMe: (remember: boolean) => void;
  showPassword: boolean;
  capsLockOn: boolean;
  isLoading: boolean;
  showResendVerification: boolean;
  isResendingVerification: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onTogglePassword: () => void;
  onKeyEvent: (e: React.KeyboardEvent) => void;
  onResendVerification: () => void;
  onSwitchToRegister: () => void;
}

export function LoginForm({
  loginEmail,
  setLoginEmail,
  loginPassword,
  setLoginPassword,
  rememberMe,
  setRememberMe,
  showPassword,
  capsLockOn,
  isLoading,
  showResendVerification,
  isResendingVerification,
  onSubmit,
  onTogglePassword,
  onKeyEvent,
  onResendVerification,
  onSwitchToRegister,
}: LoginFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormField label="Email" htmlFor="email" required>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          value={loginEmail}
          onChange={(e) => setLoginEmail(e.target.value)}
          autoComplete="username"
          required
        />
      </FormField>

      <FormField label="Password" htmlFor="password" required>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder="Enter your password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            onKeyDown={onKeyEvent}
            onKeyUp={onKeyEvent}
            autoComplete="current-password"
            className="pr-10"
            required
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
            onClick={onTogglePassword}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Eye className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </div>
        {capsLockOn && (
          <p className="text-xs text-amber-600 mt-1">Caps Lock is on</p>
        )}
      </FormField>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 min-h-[44px]">
          <Checkbox
            id="rememberMe"
            checked={rememberMe}
            onCheckedChange={(checked) => setRememberMe(!!checked)}
          />
          <Label
            htmlFor="rememberMe"
            className="text-sm text-foreground cursor-pointer"
          >
            Remember me
          </Label>
        </div>
        <Link
          href="/forgot-password"
          className="text-sm text-primary hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <Button
        type="submit"
        className="w-full bg-rose-400 hover:bg-rose-500"
        disabled={isLoading}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin motion-reduce:animate-none" />
            Signing in...
          </>
        ) : (
          "Sign In"
        )}
      </Button>

      {showResendVerification && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={onResendVerification}
          disabled={isResendingVerification}
        >
          {isResendingVerification ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin motion-reduce:animate-none" />
              Resending...
            </>
          ) : (
            "Resend verification email"
          )}
        </Button>
      )}

      <div className="text-center text-sm text-muted-foreground">
        Don't have an account?{" "}
        <button
          type="button"
          onClick={onSwitchToRegister}
          className="text-primary hover:underline font-medium"
        >
          Sign up
        </button>
      </div>
    </form>
  );
}
