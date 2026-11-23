import type { Router } from "express";

/**
 * These authenticated, email-selected login aliases could switch the caller
 * into another identity. The offered OTP and backup-code forms use the
 * password-established pending session at /api/auth/mfa/verify instead.
 */
export function registerMfaLoginRoutes(router: Router): void {
  for (const path of ["/send-code", "/verify-code", "/verify-backup"]) {
    router.post(path, (_req, res) => {
      res.status(410).json({ success: false, error: {
        code: "MFA_ENDPOINT_RETIRED",
        message: "Sign in through /api/auth/login, then use /api/auth/mfa/verify or /api/auth/mfa/resend with that pending session.",
      } });
    });
  }
}
