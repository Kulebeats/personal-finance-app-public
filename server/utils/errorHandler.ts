import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";
import {
  HttpError,
  ValidationError,
  ForbiddenError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
} from "../core/errors";
import { MISSING_FX_RATE_STATUS, logMissingFxRate, missingFxRateBody } from "../core/errors/missingFxRate";
import { getPostgresError } from "./postgresError";

export {
  ValidationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ForbiddenError, // Exporting new one too
};

/**
 * Centralized API error handler function
 *
 * Shows user-friendly toast messages and logs detailed errors for debugging.
 * Sanitizes error messages to prevent exposure of technical details.
 *
 * @param error - The error to handle
 * @param context - Context string for logging
 * @returns Sanitized error message for the user
 */
export function handleApiError(
  error: unknown,
  context: string,
  req?: Request,
): string {
  // Safely convert error to Error object
  let errorObj: Error;
  if (error instanceof Error) {
    errorObj = error;
  } else {
    try {
      errorObj = new Error(String(error));
    } catch {
      // Handle objects that can't be converted to string (circular, proxy, etc.)
      errorObj = new Error("Unknown error object");
    }
  }

  // Log detailed error using structured logger
  if (req) {
    logger.requestError(req, context, errorObj);
  } else {
    logger.error(context, {}, errorObj);
  }

  // Return sanitized error message for user
  return sanitizeErrorMessage(error);
}

/**
 * Sanitizes error messages to remove technical details
 *
 * Removes stack traces, file paths, and internal implementation details
 * to prevent exposure of sensitive information to users.
 *
 * @param error - The error to sanitize
 * @returns User-friendly error message
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "An unexpected error occurred. Please try again.";
  }

  const message = error.message;

  // Check for technical details that should be hidden
  const hasTechnicalDetails =
    message.includes(" at ") || // Stack trace
    message.includes("/") || // File paths
    message.includes("\\") || // Windows file paths
    message.includes("node_modules") || // Node.js internals
    message.includes("Error:") || // Error prefixes
    message.includes("TypeError:") || // Type errors
    message.includes("ReferenceError:") || // Reference errors
    message.includes("SyntaxError:"); // Syntax errors

  if (hasTechnicalDetails) {
    return "An error occurred. Please try again.";
  }

  // Return the original message if it's user-friendly
  return message;
}

/**
 * Express error middleware for handling API errors
 *
 * Catches all errors in Express routes and returns appropriate HTTP responses
 * with sanitized error messages.
 *
 * @param err - The error that occurred
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export function apiErrorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Handle core HttpError types (UnauthorizedError, ForbiddenError, etc.)
  if (err instanceof HttpError) {
    // `RateLimitError` carries the backoff its thrower computed, so emit it as
    // a real header here — centrally, once — rather than making every limiter
    // remember to call setHeader before throwing (only the AI limiter did).
    // The error is the single source of truth: set unconditionally so the
    // header can never disagree with the error that produced it.
    //
    // RFC 9110 §10.2.3 allows delta-seconds or an HTTP-date; use delta-seconds
    // to match the other two 429 paths (server/middleware/rateLimit.ts and the
    // AI limiter) so the whole API speaks one format and clients need no
    // clock-skew handling.
    if (err instanceof RateLimitError) {
      res.setHeader("Retry-After", err.retryAfter.toString());
    }
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  // CSRF rejection from csrf-csrf is a generic http-error (named "ForbiddenError"
  // but NOT our ForbiddenError class), so it would otherwise fall through to a
  // 500. Surface a clean 403 the client can detect, clear its stale token on,
  // and transparently retry. It's an expected condition, so don't error-log it.
  const csrfErr = err as { code?: string };
  if (
    csrfErr.code === "EBADCSRFTOKEN" ||
    /invalid csrf token/i.test(err.message)
  ) {
    res.status(403).json({
      success: false,
      error: {
        code: "CSRF_INVALID",
        message: "Invalid or expired security token. Please retry.",
      },
    });
    return;
  }

  // R12: a missing exchange rate is missing financial data (422 naming the pair).
  const missingRate = missingFxRateBody(err);
  if (missingRate) {
    logMissingFxRate(req, missingRate);
    res.status(MISSING_FX_RATE_STATUS).json(missingRate);
    return;
  }

  if (getPostgresError(err)?.code === "22P02") {
    const invalidInput = new ValidationError("Invalid input");
    res.status(invalidInput.statusCode).json(invalidInput.toJSON());
    return;
  }

  // Message text is not redacted. requestError supplies the source route
  // template and safe error identity; raw paths/parameters never form labels.
  const sanitizedMessage = handleApiError(err, "API request failed", req);

  // Handle specific error types with V7 compliant envelope
  if (err instanceof ValidationError) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: sanitizedMessage,
        details: err.fields,
      },
    });
    return;
  }

  if (err instanceof ForbiddenError) {
    res.status(403).json({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "Access denied",
      },
    });
    return;
  }

  if (err instanceof NotFoundError) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: sanitizedMessage,
      },
    });
    return;
  }

  if (err instanceof ConflictError) {
    res.status(409).json({
      success: false,
      error: {
        code: "CONFLICT",
        message: sanitizedMessage,
      },
    });
    return;
  }

  // NOTE: there is deliberately no `RateLimitError` branch here. It extends
  // HttpError, so the branch above already returns for it — with the documented
  // `RATE_LIMIT_EXCEEDED` code (see the AI assistant API spec §3.4, which
  // clients branch on). A second branch here was unreachable dead code that
  // claimed a different, wrong code (`RATE_LIMITED`); it was removed rather
  // than hoisted, to keep one code on the wire.

  // Multer upload limits (MulterError carries a `code`, not an http status).
  const errCode = (err as { code?: string }).code;
  if (errCode === "LIMIT_FILE_SIZE") {
    res.status(413).json({
      success: false,
      error: { code: "PAYLOAD_TOO_LARGE", message: "Uploaded file is too large." },
    });
    return;
  }
  if (typeof errCode === "string" && errCode.startsWith("LIMIT_")) {
    res.status(400).json({
      success: false,
      error: { code: "UPLOAD_ERROR", message: "Invalid file upload." },
    });
    return;
  }

  // body-parser malformed JSON.
  if ((err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_JSON", message: "Malformed JSON in request body." },
    });
    return;
  }

  // Honor http-errors-style 4xx statuses (e.g. payload-too-large, or any
  // third-party http-error) instead of collapsing them to a 500 that breaks
  // client-side recovery. True 5xx still fall through to the generic handler.
  const httpStatus =
    (err as { statusCode?: number; status?: number }).statusCode ??
    (err as { status?: number }).status;
  if (typeof httpStatus === "number" && httpStatus >= 400 && httpStatus < 500) {
    const codeByStatus: Record<number, string> = {
      400: "BAD_REQUEST",
      401: "UNAUTHORIZED",
      403: "FORBIDDEN",
      413: "PAYLOAD_TOO_LARGE",
      429: "RATE_LIMITED",
    };
    res.status(httpStatus).json({
      success: false,
      error: { code: codeByStatus[httpStatus] || "HTTP_ERROR", message: sanitizedMessage },
    });
    return;
  }

  // Handle generic errors (true 5xx / unknown).
  //
  // SECURITY: a 500 is an UNEXPECTED error the app did not intend to surface,
  // so its message must never reach the client. `sanitizeErrorMessage` is a
  // denylist that only strips stack/path markers and misses e.g. raw SQL text
  // ("Failed query: select ... from \"password_reset_tokens\" ..."), which
  // would otherwise leak schema/query internals on an unauthenticated endpoint.
  // The full error is already logged server-side above; return a fixed generic
  // message. Intentional, user-facing messages only ever come from AppError
  // subclasses handled earlier (ValidationError/NotFoundError/ConflictError).
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An internal error occurred. Please try again.",
    },
  });
}

/**
 * Async wrapper for Express route handlers
 *
 * Automatically catches async errors and passes them to the error middleware.
 *
 * @param fn - Async route handler function
 * @returns Express route handler that catches async errors
 */
export function asyncHandler<T extends Request, U extends Response>(
  fn: (req: T, res: U, next: NextFunction) => Promise<any>,
) {
  return (req: T, res: U, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Client-side error handler for fetch API responses
 *
 * Handles API response errors and shows appropriate user feedback.
 * Can be used with fetch responses.
 *
 * @param response - Fetch API response or error
 * @param context - Context for logging
 * @returns Promise that rejects with sanitized error
 */
export async function handleClientApiError(
  response: globalThis.Response | Error,
  context: string,
): Promise<never> {
  let errorMessage: string;

  if (response instanceof Error) {
    errorMessage = handleApiError(response, context);
  } else if (!response.ok) {
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || "An error occurred";
    } catch {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    }
  } else {
    errorMessage = "An unexpected error occurred";
  }

  // Show user-friendly toast (if toast library is available)
  if (typeof window !== "undefined" && "toast" in window) {
    // Toast library may not be typed
    (
      window as Window & { toast?: { error?: (msg: string) => void } }
    ).toast?.error?.(sanitizeErrorMessage(new Error(errorMessage)));
  }

  throw new Error(sanitizeErrorMessage(new Error(errorMessage)));
}
