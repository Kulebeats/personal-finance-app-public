/**
 * Fixed user copy for a failed sign-in, registration, MFA, resend or password
 * reset request.
 *
 * The server's own error text is never shown: it is written for developers and
 * can carry internal detail. A known error code (server/core/errors) maps to
 * copy for that action; anything else, including an unknown code, a network
 * failure or an unreadable body, gets the action's one generic line.
 */

export type AuthAction =
  | "login" | "register" | "mfaVerify" | "mfaResend" | "resendVerification"
  | "forgotPassword" | "resetPassword";

const RATE_LIMITED = "Too many attempts. Wait a few minutes and try again.";
const MFA_SESSION_EXPIRED = "Your sign-in has expired. Sign in again to get a new code.";
const EMAIL_UNAVAILABLE = "We can't send email right now. Try again later.";
const RATE_LIMIT_CODES: readonly string[] = ["RATE_LIMITED", "RATE_LIMIT_EXCEEDED"];
const TOO_MANY_REQUESTS = 429;

const GENERIC: Readonly<Record<AuthAction, string>> = {
  login: "Sign-in failed. Please try again.",
  register: "We couldn't create your account. Please try again.",
  mfaVerify: "We couldn't verify that code. Please try again.",
  mfaResend: "We couldn't resend the code. Please try again.",
  resendVerification: "We couldn't resend the verification email. Please try again.",
  forgotPassword: "We couldn't send a reset link. Please try again.",
  resetPassword: "We couldn't reset your password. Please try again.",
};

const BY_CODE: Readonly<Record<AuthAction, Readonly<Record<string, string>>>> = {
  login: {
    INVALID_CREDENTIALS: "Invalid email or password.",
    FORBIDDEN: "This account is temporarily locked. Try again later.",
    EMAIL_VERIFICATION_REQUIRED: "Verify your email address before signing in.",
    VALIDATION_ERROR: "Enter your email and password.",
  },
  register: {
    CONFLICT: "We couldn't create an account with those details. Try a different email or username.",
    VALIDATION_ERROR: "Check the highlighted fields and try again.",
  },
  mfaVerify: {
    INVALID_CREDENTIALS: "That code is wrong or has expired. Check your email and try again.",
    UNAUTHORIZED: MFA_SESSION_EXPIRED,
    VALIDATION_ERROR: "Enter the code from your email.",
  },
  mfaResend: {
    UNAUTHORIZED: MFA_SESSION_EXPIRED,
    SERVICE_UNAVAILABLE: EMAIL_UNAVAILABLE,
  },
  resendVerification: {
    SERVICE_UNAVAILABLE: EMAIL_UNAVAILABLE,
    VALIDATION_ERROR: "Enter a valid email address.",
  },
  forgotPassword: {
    SERVICE_UNAVAILABLE: EMAIL_UNAVAILABLE,
    VALIDATION_ERROR: "Enter a valid email address.",
  },
  resetPassword: {
    // One code covers an invalid or expired link, a reused password and a password
    // that fails the rules, so the copy names both ways forward.
    VALIDATION_ERROR: "This reset link is invalid or has expired, or that password can't be used. Request a new link or choose a different password.",
  },
};

interface ErrorSignal {
  code?: unknown;
  status?: unknown;
}

function readSignal(source: unknown): ErrorSignal {
  return source !== null && typeof source === "object" ? (source as ErrorSignal) : {};
}

/** Copy from an error's code and status; `source` is a thrown error or an envelope's `error`. */
export function authErrorCopy(action: AuthAction, source: unknown): string {
  const { code, status } = readSignal(source);
  const knownCode = typeof code === "string" ? code : undefined;
  if (status === TOO_MANY_REQUESTS || (knownCode && RATE_LIMIT_CODES.includes(knownCode))) return RATE_LIMITED;
  const copy = BY_CODE[action];
  // Own keys only, so a code such as "constructor" cannot reach the prototype.
  return knownCode && Object.prototype.hasOwnProperty.call(copy, knownCode) ? copy[knownCode] : GENERIC[action];
}
