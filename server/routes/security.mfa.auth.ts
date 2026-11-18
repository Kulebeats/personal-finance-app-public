/**
 * MFA Authenticated Routes
 *
 * Enable/disable/status operations that require an authenticated session.
 * PERF: Uses standard response helpers (improves API consistency)
 *
 * @module routes/security.mfa.auth
 */

import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, hashPassword, verifyPassword as verifyHash } from "../auth";
import { logger } from "../utils/logger";
import { auditService, AuditEventType } from "../services/AuditService";
import { generateBackupCodes } from "./security.mfa.utils";
import { success } from "../core/http";
import { ValidationError, NotFoundError, UnauthorizedError } from "../core/errors";

const disableMfaSchema = z.object({
  password: z.string().min(1),
});

// Matches the low-codes threshold used by the backup-code login/verify path
// (see security.mfa.login.ts).
const LOW_BACKUP_CODES_THRESHOLD = 3;

export function registerMfaAuthRoutes(router: Router): void {
  /**
   * POST /enable - Enable email-based MFA for the user.
   */
  router.post("/enable", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;

      // Get user
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) {
        throw new NotFoundError("User not found");
      }

      // Generate backup codes
      const backupCodes = generateBackupCodes();
      const hashedBackupCodes = await Promise.all(
        backupCodes.map((code) => hashPassword(code))
      );

      // Enable MFA
      await db
        .update(users)
        .set({
          mfaEnabled: true,
          mfaMethod: "email",
          mfaBackupCodes: hashedBackupCodes,
          mfaBackupCodesGeneratedAt: new Date(), // SEC-06: Track for 90-day expiry
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      logger.info("MFA enabled", {
        requestId: req.requestId,
        userId: userId.substring(0, 8) + "...",
      });

      await auditService.log(
        auditService.fromRequest(req, AuditEventType.MFA_ENABLED, {
          method: "email",
        })
      );

      return success(res, { backupCodes }, 200, { message: "MFA enabled successfully" });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /disable - Disable MFA for the user (requires current password).
   */
  router.post("/disable", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const validation = disableMfaSchema.safeParse(req.body);

      if (!validation.success) {
        throw new ValidationError("Password required");
      }

      // Get user
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) {
        throw new NotFoundError("User not found");
      }

      // Verify password
      const isValid = await verifyHash(
        validation.data.password,
        user.passwordHash
      );
      if (!isValid) {
        throw new UnauthorizedError("Invalid password");
      }

      // Disable MFA
      await db
        .update(users)
        .set({
          mfaEnabled: false,
          mfaMethod: null,
          mfaCode: null,
          mfaCodeExpiry: null,
          mfaBackupCodes: null,
          mfaBackupCodesGeneratedAt: null, // SEC-06: Clear expiry timestamp
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      logger.info("MFA disabled", {
        requestId: req.requestId,
        userId: userId.substring(0, 8) + "...",
      });

      await auditService.log(
        auditService.fromRequest(req, AuditEventType.MFA_DISABLED)
      );

      return success(res, null, 200, { message: "MFA disabled successfully" });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /status - Get current MFA status.
   */
  router.get("/status", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;

      const [user] = await db
        .select({
          mfaEnabled: users.mfaEnabled,
          mfaMethod: users.mfaMethod,
          mfaBackupCodes: users.mfaBackupCodes,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const mfaEnabled = user?.mfaEnabled || false;
      const backupCodesRemaining = user?.mfaBackupCodes?.length ?? 0;

      return success(res, {
        mfaEnabled,
        mfaMethod: user?.mfaMethod || null,
        backupCodesRemaining,
        // Only meaningful once MFA is actually on — otherwise there's
        // nothing to "regenerate".
        lowCodesWarning:
          mfaEnabled && backupCodesRemaining <= LOW_BACKUP_CODES_THRESHOLD,
      });
    } catch (error) {
      next(error);
    }
  });
}
