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
import { requireAuth } from "../../auth";
import { authLimiter, strictLimiter } from "../../middleware/rateLimit";

const router = Router();

// Public routes (with rate limiting)
router.post("/register", authLimiter, authController.register);
router.post("/login", authLimiter, authController.login);
router.post("/mfa/verify", authLimiter, authController.verifyMfa);
router.post("/mfa/resend", authLimiter, authController.resendMfa);
router.post("/verify-email", authLimiter, authController.verifyEmail);
router.post(
  "/resend-verification",
  authLimiter,
  authController.resendVerification,
);
// Password reset: strictest IP-based tier (5/min) on top of the mount-level
// auth limiters - these endpoints trigger email egress and password writes.
router.post(
  "/forgot-password",
  strictLimiter,
  authController.forgotPassword,
);
router.post("/reset-password", strictLimiter, authController.resetPassword);

// Protected routes
router.post("/logout", requireAuth, authController.logout);
router.get("/me", requireAuth, authController.getCurrentUser);

export default router;
