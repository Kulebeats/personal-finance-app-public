/**
 * MFA Login Routes
 *
 * Send and verify MFA codes during login.
 *
 * @module routes/security.mfa.login
 */

import { Router, Request, Response } from "express";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, verifyPassword as verifyHash } from "../auth";
import { logger } from "../utils/logger";
import { isEmailServiceConfigured } from "../services/emailService";
import {
  generateMfaCode,
  MFA_BACKUP_CODE_EXPIRY_DAYS,
} from "./security.mfa.utils";
import { authSessionService } from "../modules/auth/auth.session.service";

const sendMfaCodeSchema = z.object({
  email: z.string().email(),
});

const verifyMfaCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

const verifyBackupCodeSchema = z.object({
  email: z.string().email(),
  backupCode: z.string().min(8),
});

export function registerMfaLoginRoutes(router: Router): void {
  /**
   * POST /send-code - Send MFA code to user's email (used during login).
   */
  // FIX AUTH-LEGACY-001: DEPRECATED - Use /api/auth/login with MFA flow instead
  router.post("/send-code", async (req: Request, res: Response) => {
    logger.warn("DEPRECATED ENDPOINT: /api/settings/security/mfa/send-code", {
      requestId: req.requestId,
      note: "This endpoint is deprecated. Use /api/auth/login instead",
    });
    try {
      const validation = sendMfaCodeSchema.safeParse(req.body);

      if (!validation.success) {
        return res
          .status(400)
          .json({ error: { message: "Valid email required" } });
      }

      // Find user
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, validation.data.email))
        .limit(1);

      if (!user || !user.mfaEnabled) {
        // Don't reveal if user exists or has MFA
        return res.json({
          success: true,
          message: "If MFA is enabled, a code has been sent",
        });
      }

      // Generate and store code
      const code = generateMfaCode();
      const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await db
        .update(users)
        .set({
          mfaCode: await hashPassword(code), // Hash the code
          mfaCodeExpiry: expiry,
        })
        .where(eq(users.id, user.id));

      // Send email with code
      if (isEmailServiceConfigured()) {
        const { sendMfaCodeEmail } = await import("../services/emailService");
        await sendMfaCodeEmail(user.email, code, user.firstName || user.username);
      } else {
        logger.warn("Email service not configured, MFA code not sent", {
          userId: user.id.substring(0, 8) + "...",
          // Security: MFA code intentionally not logged
        });
      }

      logger.info("MFA code sent", {
        requestId: req.requestId,
        userId: user.id.substring(0, 8) + "...",
      });

      res.json({ success: true, message: "MFA code sent to your email" });
    } catch (error) {
      logger.error(
        "Error sending MFA code",
        { requestId: req.requestId },
        error as Error
      );
      res.status(500).json({ error: { message: "Failed to send MFA code" } });
    }
  });

  /**
   * POST /verify-code - Verify MFA code during login.
   */
  // FIX AUTH-LEGACY-001: DEPRECATED - Use /api/auth/mfa/verify instead
router.post("/verify-code", async (req: Request, res: Response) => {
  // Log deprecation warning
  logger.warn("DEPRECATED ENDPOINT: /api/settings/security/mfa/verify-code", {
    requestId: req.requestId,
    userId: req.session.userId,
    note: "This endpoint is deprecated. Use /api/auth/mfa/verify instead",
  });
    try {
      const validation = verifyMfaCodeSchema.safeParse(req.body);

      if (!validation.success) {
        return res
          .status(400)
          .json({ error: { message: "Invalid code format" } });
      }

      // Find user
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, validation.data.email))
        .limit(1);

      if (!user || !user.mfaEnabled) {
        return res.status(400).json({ error: { message: "Invalid request" } });
      }

      // Check code expiry
      if (
        !user.mfaCode ||
        !user.mfaCodeExpiry ||
        new Date() > user.mfaCodeExpiry
      ) {
        return res
          .status(400)
          .json({ error: { message: "Code expired. Request a new one." } });
      }

      // Verify code
      const isValid = await verifyHash(validation.data.code, user.mfaCode);
      if (!isValid) {
        return res.status(400).json({ error: { message: "Invalid code" } });
      }

      // Clear the code (one-time use)
      await db
        .update(users)
        .set({
          mfaCode: null,
          mfaCodeExpiry: null,
        })
        .where(eq(users.id, user.id));

      // FIX AUTH-LEGACY-001: Use proper session handling with regeneration and login history
      await authSessionService.finalizeLogin(
        user,
        req,
        false, // rememberMe: false for legacy endpoint
        req.ip || '',
        req.get('user-agent') || ''
      );

      logger.info("MFA verification successful", {
        requestId: req.requestId,
        userId: user.id.substring(0, 8) + "...",
      });

      res.json({
        success: true,
        message: "MFA verification successful",
        data: { userId: user.id },
      });
    } catch (error) {
      logger.error(
        "Error verifying MFA code",
        { requestId: req.requestId },
        error as Error
      );
      res.status(500).json({ error: { message: "Failed to verify MFA code" } });
    }
  });

  /**
   * POST /verify-backup - Verify MFA using a backup code (one-time use, 90-day expiry).
   * SEC-06: Backup codes expire 90 days after generation.
   */
  // FIX AUTH-LEGACY-001: DEPRECATED - Use /api/auth/mfa/verify-backup instead
  router.post("/verify-backup", async (req: Request, res: Response) => {
    logger.warn("DEPRECATED ENDPOINT: /api/settings/security/mfa/verify-backup", {
      requestId: req.requestId,
      userId: req.session.userId,
      note: "This endpoint is deprecated. Use /api/auth/mfa/verify-backup instead",
    });
    try {
      const validation = verifyBackupCodeSchema.safeParse(req.body);

      if (!validation.success) {
        return res
          .status(400)
          .json({ error: { message: "Invalid backup code format" } });
      }

      // Find user
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, validation.data.email))
        .limit(1);

      if (!user || !user.mfaEnabled) {
        return res.status(400).json({ error: { message: "Invalid request" } });
      }

      // Check if backup codes exist
      if (!user.mfaBackupCodes || user.mfaBackupCodes.length === 0) {
        return res
          .status(400)
          .json({ error: { message: "No backup codes available" } });
      }

      // SEC-06: Check if backup codes have expired (90-day expiry)
      if (user.mfaBackupCodesGeneratedAt) {
        const expiryDate = new Date(user.mfaBackupCodesGeneratedAt);
        expiryDate.setDate(expiryDate.getDate() + MFA_BACKUP_CODE_EXPIRY_DAYS);

        if (new Date() > expiryDate) {
          return res.status(400).json({
            error: {
              code: "BACKUP_CODES_EXPIRED",
              message:
                "Backup codes have expired. Please regenerate them after logging in.",
            },
          });
        }
      }

      // Verify backup code against stored hashes
      let validCodeIndex = -1;
      for (let i = 0; i < user.mfaBackupCodes.length; i++) {
        const isValid = await verifyHash(
          validation.data.backupCode,
          user.mfaBackupCodes[i]
        );
        if (isValid) {
          validCodeIndex = i;
          break;
        }
      }

      if (validCodeIndex === -1) {
        return res
          .status(400)
          .json({ error: { message: "Invalid backup code" } });
      }

      // Remove used backup code (one-time use)
      const remainingCodes = user.mfaBackupCodes.filter(
        (_, i) => i !== validCodeIndex
      );

      await db
        .update(users)
        .set({
          mfaBackupCodes: remainingCodes,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      // FIX AUTH-LEGACY-001: Use proper session handling with regeneration and login history
      await authSessionService.finalizeLogin(
        user,
        req,
        false, // rememberMe: false for legacy endpoint
        req.ip || '',
        req.get('user-agent') || ''
      );

      logger.info("MFA backup code verification successful", {
        requestId: req.requestId,
        userId: user.id.substring(0, 8) + "...",
        remainingCodes: remainingCodes.length,
      });

      // Warn if low on backup codes
      const lowCodesWarning = remainingCodes.length <= 3;

      res.json({
        success: true,
        message: "MFA verification successful",
        data: {
          userId: user.id,
          remainingBackupCodes: remainingCodes.length,
          lowCodesWarning,
        },
      });
    } catch (error) {
      logger.error(
        "Error verifying MFA backup code",
        { requestId: req.requestId },
        error as Error
      );
      res
        .status(500)
        .json({ error: { message: "Failed to verify backup code" } });
    }
  });
}
