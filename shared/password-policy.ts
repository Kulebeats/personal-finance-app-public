/**
 * Single definition of the password policy.
 *
 * The server builds its Zod schema from these rules and the client renders its
 * strength checklist from the same rules, so the two cannot drift apart.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_MIN_LENGTH_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
export const PASSWORD_MAX_LENGTH_MESSAGE = "Password too long";

export interface PasswordCharacterRule {
  id: "lowercase" | "uppercase" | "number" | "special";
  /** Short label shown in the client checklist. */
  label: string;
  /** Message returned by the server when the rule is not met. */
  message: string;
  pattern: RegExp;
}

/** Character-class rules, in the order the server reports them. */
export const PASSWORD_CHARACTER_RULES: readonly PasswordCharacterRule[] = [
  {
    id: "lowercase",
    label: "One lowercase letter",
    message: "Password must contain at least one lowercase letter",
    pattern: /[a-z]/,
  },
  {
    id: "uppercase",
    label: "One uppercase letter",
    message: "Password must contain at least one uppercase letter",
    pattern: /[A-Z]/,
  },
  {
    id: "number",
    label: "One number",
    message: "Password must contain at least one number",
    pattern: /[0-9]/,
  },
  {
    id: "special",
    label: 'One special character (! @ # $ % ^ & * ( ) , . ? " : { } | < >)',
    message: "Password must contain at least one special character",
    pattern: /[!@#$%^&*(),.?":{}|<>]/,
  },
];

export interface PasswordChecklistItem {
  id: "length" | "maxLength" | PasswordCharacterRule["id"];
  label: string;
  met: boolean;
}

/**
 * Checklist items (length first, then each character rule) for a password.
 * The maximum-length item appears only once it is exceeded.
 */
export function evaluatePasswordRules(password: string): PasswordChecklistItem[] {
  return [
    {
      id: "length",
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      met: password.length >= PASSWORD_MIN_LENGTH,
    },
    ...PASSWORD_CHARACTER_RULES.map((rule) => ({
      id: rule.id,
      label: rule.label,
      met: rule.pattern.test(password),
    })),
    ...(password.length > PASSWORD_MAX_LENGTH
      ? [{ id: "maxLength" as const, label: `At most ${PASSWORD_MAX_LENGTH} characters`, met: false }]
      : []),
  ];
}
