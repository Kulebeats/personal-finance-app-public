import type { RequestHandler } from "express";

/** Keep selection separate from token validation; the app supplies real csrf-csrf. */
export function createCsrfPolicyMiddleware(
  protect: RequestHandler,
  getEnvironment: () => string | undefined = () => process.env.NODE_ENV,
): RequestHandler {
  return (req, res, next) => {
    if (
      getEnvironment() === "test" || // Skip CSRF in test environment
      // These consumers authorize only the opaque token, never the visitor's session.
      (req.method === "POST" && (
        req.path === "/api/auth/verify-email" ||
        req.path === "/api/settings/security/email/verify"
      )) ||
      ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
      req.path === "/api/csrf-token" ||
      req.path.startsWith("/healthz") ||
      req.path.startsWith("/api/cron") || // Cron uses secret header auth
      req.path === "/api/auth/login" || // Pre-auth routes don't need CSRF
      req.path === "/api/auth/verify-mfa" || // Pre-auth MFA verification
      req.path === "/api/auth/mfa/verify" || // Pre-auth MFA verification
      req.path === "/api/auth/mfa/resend" || // Pre-auth MFA code resend (rate-limited)
      req.path === "/api/auth/resend-verification" || // Pre-auth email resend (rate-limited)
      req.path === "/api/auth/forgot-password" || // Pre-auth reset request (strict rate limit)
      req.path === "/api/auth/reset-password" || // Pre-auth reset completion (strict rate limit)
      req.path === "/api/auth/register" ||
      req.path === "/api/auth/logout" // Logout is safe to exempt - only destroys current session
    ) {
      next();
      return;
    }
    protect(req, res, next);
  };
}
