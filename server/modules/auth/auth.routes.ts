/**
 * Auth Module Routes
 *
 * Express router with minimal route definitions.
 * Routes are thin - they only call controller methods.
 *
 * Migrated from server/routes/auth.ts
 *
 * @module modules/auth/auth.routes
 */

import { Router } from "express";
import { authController } from "./auth.controller";
import { requirePendingAwareSessionUser } from "../../auth";
import { getSessionStatus } from "./auth.status";
import { readSessionPreconditions, SessionContextChangedError } from "../../core/authz/session-preconditions";
import {
  authLimiter,
  ipAuthLimiter,
  strictLimiter,
} from "../../middleware/rateLimit";

const router = Router();

// Session snapshots inherit the existing general API quota, not credential attempts.
router.get("/session", getSessionStatus);

// Public routes (with rate limiting)
router.post("/register", ipAuthLimiter, authLimiter, authController.register);
router.post("/login", ipAuthLimiter, authLimiter, authController.login);
router.post("/mfa/verify", ipAuthLimiter, authLimiter, authController.verifyMfa);
router.post("/mfa/resend", ipAuthLimiter, authLimiter, authController.resendMfa);
router.post("/verify-email", ipAuthLimiter, authLimiter, authController.verifyEmail);
router.post(
  "/resend-verification",
  ipAuthLimiter,
  authLimiter,
  authController.resendVerification,
);
// Credential attempts share the IP tier; reset also retains its strict tier.
// Session reads and logout only inherit the global general quota.
router.post(
  "/forgot-password",
  ipAuthLimiter,
  authLimiter,
  strictLimiter,
  authController.forgotPassword,
);
router.post(
  "/reset-password",
  ipAuthLimiter,
  authLimiter,
  strictLimiter,
  authController.resetPassword,
);

// A pending challenge is not an authenticated user, but must be cancellable.
// Only logout admits it; the guarded store already validates its SID identity.
router.post("/logout", (req, res, next) => {
  if (!req.session.userId && req.session.mfaPendingUserId) {
    const preconditions = readSessionPreconditions(req);
    if (preconditions.subject || preconditions.household) throw new SessionContextChangedError();
    return next();
  }
  return requirePendingAwareSessionUser(req, res, next);
}, authController.logout);
// Protected routes
router.get("/me", requirePendingAwareSessionUser, authController.getCurrentUser);

export default router;
