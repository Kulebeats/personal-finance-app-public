/**
 * Security Routes
 *
 * Main router that mounts security sub-routers.
 *
 * Routes:
 * - /email/* - Email verification and change (security.email.ts)
 * - /sessions/* - Session management (security.sessions.ts)
 * - /mfa/* - Multi-factor authentication (security.mfa.ts)
 *
 * @module routes/security
 */

import { Router, Request, Response } from "express";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../auth";
import { logger } from "../utils/logger";
import { isEmailServiceConfigured } from "../services/emailService";
import { generalLimiter } from "../middleware/rateLimit";
import { requireStepUp } from "../middleware/requireStepUp";
import { settingsController } from "../modules/settings/settings.controller";

// Import sub-routers
import emailRoutes from "./security.email";
import sessionsRoutes from "./security.sessions";
import mfaRoutes from "./security.mfa";

const router = Router();

// SEC-RATE-006: Apply rate limiting to all security routes
router.use(generalLimiter);

// Mount email routes (some don't require auth - verify endpoint)
router.use("/email", emailRoutes);

// All remaining routes require authentication
router.use(requireAuth);

// GET /api/settings/security - Get security status
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;

    const [user] = await db
      .select({
        email: users.email,
        emailVerified: users.emailVerified,
        pendingEmail: users.pendingEmail,
        passwordHash: users.passwordHash,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    // Check if user has a password (vs only social login)
    const hasPassword = !!user.passwordHash && user.passwordHash.length > 0;

    res.json({
      data: {
        email: user.email,
        emailVerified: user.emailVerified ?? false,
        pendingEmail: user.pendingEmail,
        hasPassword,
        emailServiceConfigured: isEmailServiceConfigured(),
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    logger.error(
      "Error fetching security status",
      {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
      },
      error as Error
    );
    res
      .status(500)
      .json({ error: { message: "Failed to fetch security status" } });
  }
});

// PUT /password - Change password (step-up gated).
// Canonical home for the password change the client already calls
// (/api/settings/security/password). Reuses the settings controller handler;
// the duplicate PUT /api/settings/password was removed from the settings module.
router.put(
  "/password",
  requireStepUp("SETTINGS"),
  settingsController.changePassword
);

// Mount session routes
router.use("/sessions", sessionsRoutes);

// GET /login-history - Get login history (backward compatibility)
router.get("/login-history", (req: Request, res: Response, next) => {
  req.url = "/login-history";
  sessionsRoutes(req, res, next);
});

// Mount MFA routes
router.use("/mfa", mfaRoutes);

// Step-up routes (also part of MFA)
router.post("/step-up", (req: Request, res: Response, next) => {
  req.url = "/step-up";
  mfaRoutes(req, res, next);
});

router.get("/step-up/status", (req: Request, res: Response, next) => {
  req.url = "/step-up/status";
  mfaRoutes(req, res, next);
});

export default router;
