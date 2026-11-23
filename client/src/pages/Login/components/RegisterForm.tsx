/**
 * Registration Form Component
 *
 * Handles new user registration with password validation.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { FormField } from "@/features/settings/components";
import {
  PasswordStrengthMeter,
  usePasswordValidation,
} from "@/components/auth";
import { PASSWORD_MAX_LENGTH } from "@shared/password-policy";
import { fieldErrorProps, type FieldMessages } from "../authFieldErrors";

interface RegisterFormProps {
  fullName: string;
  setFullName: (name: string) => void;
  username: string;
  setUsername: (username: string) => void;
  email: string;
  setEmail: (email: string) => void;
  password: string;
  setPassword: (password: string) => void;
  showPassword: boolean;
  capsLockOn: boolean;
  isLoading: boolean;
  fieldErrors?: FieldMessages;
  onSubmit: (e: React.FormEvent) => void;
  onTogglePassword: () => void;
  onKeyEvent: (e: React.KeyboardEvent) => void;
  onSwitchToLogin: () => void;
}

export function RegisterForm({
  fullName,
  setFullName,
  username,
  setUsername,
  email,
  setEmail,
  password,
  setPassword,
  showPassword,
  capsLockOn,
  isLoading,
  fieldErrors = {},
  onSubmit,
  onTogglePassword,
  onKeyEvent,
  onSwitchToLogin,
}: RegisterFormProps) {
  // Password validation for registration
  const passwordValidation = usePasswordValidation(password, email);

  const handleSubmit = (e: React.FormEvent) => {
    // Client-side validation before submit
    if (!passwordValidation.isValid) {
      e.preventDefault();
      return;
    }
    onSubmit(e);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormField label="Full Name" htmlFor="fullName" required error={fieldErrors.fullName}>
        <Input
          id="fullName"
          disabled={isLoading}
          type="text"
          placeholder="John Doe"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="name"
          required
          {...fieldErrorProps("fullName", fieldErrors.fullName)}
        />
      </FormField>

      <FormField
        label="Username"
        htmlFor="username"
        required
        error={fieldErrors.username}
        tooltip="Choose a unique username (min 3 characters)"
      >
        <Input
          id="username"
          disabled={isLoading}
          type="text"
          placeholder="johndoe"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          minLength={3}
          {...fieldErrorProps("username", fieldErrors.username)}
        />
      </FormField>

      <FormField label="Email" htmlFor="registerEmail" required error={fieldErrors.email}>
        <Input
          id="registerEmail"
          disabled={isLoading}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          {...fieldErrorProps("registerEmail", fieldErrors.email)}
        />
      </FormField>

      <FormField label="Password" htmlFor="registerPassword" required error={fieldErrors.password}>
        <div className="relative">
          <Input
            id="registerPassword"
            disabled={isLoading}
            type={showPassword ? "text" : "password"}
            placeholder="Create a strong password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onKeyEvent}
            onKeyUp={onKeyEvent}
            autoComplete="new-password"
            className="pr-10"
            required
            minLength={8}
            maxLength={PASSWORD_MAX_LENGTH}
            {...fieldErrorProps("registerPassword", fieldErrors.password, "password-requirements")}
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
        <div id="password-requirements" className="mt-2">
          <PasswordStrengthMeter password={password} email={email} />
        </div>
      </FormField>

      <Button
        type="submit"
        className="w-full bg-rose-400 hover:bg-rose-500"
        disabled={isLoading || !passwordValidation.isValid}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin motion-reduce:animate-none" />
            Creating account...
          </>
        ) : (
          "Create Account"
        )}
      </Button>

      <div className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-primary hover:underline font-medium"
        >
          Sign in
        </button>
      </div>
    </form>
  );
}
