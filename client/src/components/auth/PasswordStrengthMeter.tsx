/**
 * Password Strength Meter Component
 *
 * Visual indicator of password strength with requirement checklist.
 * Designed for registration forms to guide users toward secure passwords.
 *
 * A11Y-001, A11Y-002: Password requirements display and strength indicator
 * P4-60: Reduced motion support via motion-reduce:transition-none
 */

import { useMemo } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface PasswordRequirement {
  label: string;
  met: boolean;
}

interface Props {
  password: string;
  email?: string;
  showRequirements?: boolean;
  className?: string;
}

export function PasswordStrengthMeter({
  password,
  email,
  showRequirements = true,
  className,
}: Props) {
  const requirements = useMemo<PasswordRequirement[]>(() => {
    return [
      {
        label: "At least 8 characters",
        met: password.length >= 8,
      },
      {
        label: "One uppercase letter",
        met: /[A-Z]/.test(password),
      },
      {
        label: "One lowercase letter",
        met: /[a-z]/.test(password),
      },
      {
        label: "One number",
        met: /[0-9]/.test(password),
      },
      {
        label: "Not your email",
        met: !email || password.toLowerCase() !== email.toLowerCase(),
      },
    ];
  }, [password, email]);

  const strength = useMemo(() => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    // Penalize if same as email
    if (email && password.toLowerCase() === email.toLowerCase()) score = 0;
    return Math.min(Math.floor(score / 1.5), 4);
  }, [password, email]);

  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  const colors = [
    "bg-muted",
    "bg-red-500",
    "bg-orange-500",
    "bg-yellow-500",
    "bg-green-500",
  ];

  if (!password) return null;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Strength bars */}
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded transition-colors motion-reduce:transition-none",
              i <= strength ? colors[strength] : "bg-muted"
            )}
          />
        ))}
      </div>

      {/* Strength label */}
      {strength > 0 && (
        <p className="text-xs text-muted-foreground">{labels[strength]}</p>
      )}

      {/* Requirements checklist */}
      {showRequirements && (
        <div
          className="text-xs space-y-1"
          role="list"
          aria-label="Password requirements"
        >
          {requirements.map((req, index) => (
            <div
              key={index}
              role="listitem"
              className={cn(
                "flex items-center gap-1.5",
                req.met ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
              )}
            >
              {req.met ? (
                <Check className="h-3 w-3" aria-hidden="true" />
              ) : (
                <X className="h-3 w-3" aria-hidden="true" />
              )}
              <span>{req.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Hook to check if password meets all requirements
 */
export function usePasswordValidation(password: string, email?: string) {
  return useMemo(() => {
    const validations = {
      minLength: password.length >= 8,
      hasUppercase: /[A-Z]/.test(password),
      hasLowercase: /[a-z]/.test(password),
      hasNumber: /[0-9]/.test(password),
      notEmail: !email || password.toLowerCase() !== email.toLowerCase(),
    };

    const isValid = Object.values(validations).every(Boolean);

    return { ...validations, isValid };
  }, [password, email]);
}
