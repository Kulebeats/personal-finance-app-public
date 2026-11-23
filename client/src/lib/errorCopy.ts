/**
 * User-facing copy for a failed request (UX misc toast sweep).
 *
 * A toast never shows the server's own error text: it can carry internal
 * detail, JSON or a stack, and it is written for developers. The copy comes
 * from the error's `code` (server/core/errors, docs/api/error-codes.md), then
 * its HTTP status, and otherwise from the caller's own fallback sentence.
 */
import type { ApiError } from "./api";

const SERVER_TROUBLE = "Something went wrong on our side. Try again in a moment.";
const INVALID_INPUT = "Some of the details aren't valid. Check them and try again.";
const NOT_FOUND = "It may have been deleted. Refresh the page and try again.";
const CONFLICT = "This was changed elsewhere or already exists. Refresh the page and try again.";
const FORBIDDEN = "You don't have permission to do this in this household.";
const SIGNED_OUT = "Your session has ended. Sign in again to continue.";
const OFFLINE = "Can't reach the server. Check your connection and try again.";

const BY_CODE: Readonly<Record<string, string>> = {
  VALIDATION_ERROR: INVALID_INPUT,
  INVALID_INPUT: INVALID_INPUT,
  BAD_REQUEST: INVALID_INPUT,
  INVALID_JSON: INVALID_INPUT,
  NOT_FOUND,
  HOUSEHOLD_NOT_FOUND: NOT_FOUND,
  CONFLICT,
  PRIVATE_ACCOUNTS_PREVENT_LEAVING: "Resolve your private accounts before leaving this household. Share or transfer them where account controls allow it, or delete them.",
  PRIVATE_ACCOUNTS_PREVENT_REMOVAL: "This member must resolve their private accounts before they can be removed.",
  FORBIDDEN,
  UNAUTHORIZED: SIGNED_OUT,
  CSRF_INVALID: "Your session needs refreshing. Reload the page and try again.",
  STEP_UP_REQUIRED: "Confirm your password to continue.",
  EMAIL_VERIFICATION_REQUIRED: "Verify your email address to continue.",
  MFA_ENROLMENT_REQUIRED: "Set up two-step verification to continue.",
  MFA_REQUIRED: "Two-step verification is required for every member and can't be turned off.",
  MISSING_FX_RATE: "An exchange rate this needs isn't available yet. Try again later.",
  FINANCIAL_DATA_UNAVAILABLE: "Some figures this needs can't be loaded right now. Try again later.",
  UNSUPPORTED_FORMAT: "That file type isn't supported.",
  STORAGE_UNAVAILABLE: "Files can't be stored right now. Try again later.",
  INTERNAL_ERROR: SERVER_TROUBLE,
  SERVER_ERROR: SERVER_TROUBLE,
  UNAVAILABLE: SERVER_TROUBLE,
};

const BY_STATUS: Readonly<Record<number, string>> = {
  400: INVALID_INPUT,
  401: SIGNED_OUT,
  403: FORBIDDEN,
  404: NOT_FOUND,
  409: CONFLICT,
  413: "That file is too large.",
  422: INVALID_INPUT,
};

const SERVER_ERROR_MIN = 500;

function rateLimited(retryAfterSeconds: number | undefined): string {
  if (retryAfterSeconds === undefined || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return "Too many attempts. Wait a moment and try again.";
  }
  const seconds = Math.ceil(retryAfterSeconds);
  return `Too many attempts. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
}

function asApiError(error: unknown): ApiError | null {
  return error instanceof Error ? (error as ApiError) : null;
}

/**
 * Plain copy for `error`, never the server's message. `fallback` is the
 * caller's own sentence for this action ("Your goal could not be saved."),
 * used when neither the code nor the status says more.
 */
export function userErrorMessage(error: unknown, fallback: string): string {
  const apiError = asApiError(error);
  if (!apiError) return fallback;
  if (apiError.code === "RATE_LIMITED" || apiError.status === 429) return rateLimited(apiError.retryAfterSeconds);
  const byCode = apiError.code ? BY_CODE[apiError.code] : undefined;
  if (byCode) return byCode;
  if (apiError.status !== undefined) {
    if (BY_STATUS[apiError.status]) return BY_STATUS[apiError.status];
    if (apiError.status >= SERVER_ERROR_MIN) return SERVER_TROUBLE;
    return fallback;
  }
  // fetch rejects with a TypeError when the request never reached the server.
  if (apiError instanceof TypeError) return OFFLINE;
  return fallback;
}
