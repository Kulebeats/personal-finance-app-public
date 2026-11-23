/**
 * MFA Step-up Routes
 *
 * Verify step-up re-authentication for sensitive actions. Accepts the user's
 * PASSWORD (works for every user) OR an emailed MFA code (for MFA-enrolled
 * users). See docs/architecture/step-up-reauth-design.md.
 *
 * @module routes/security.mfa.stepup
 */

import { Router, Request, Response } from "express";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuthAllowingMfaEnrolment, verifyPassword as verifyHash } from "../auth";
import { authLimiter } from "../middleware/rateLimit";
import { logger } from "../utils/logger";
import { auditService, AuditEventType } from "../services/AuditService";
import { setStepUpVerified, isStepUpValid } from "../middleware/requireStepUp";
import { consumeMfaCredential } from "../modules/auth/auth.mfa-credential";
import { UnauthorizedError } from "../core/errors";
import {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
} from "../modules/auth/auth.service";

const stepUpSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/, "Code must be 6 digits").optional(),
    password: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.code) || Boolean(data.password), {
    message: "Password or 6-digit code required",
  });

export function registerMfaStepUpRoutes(router: Router): void {
  /**
   * POST /step-up - Verify password or MFA code for step-up authentication.
   */
  router.post(
    "/step-up",
    authLimiter,
    // AH-11: reachable past the MFA grace (password step-up precedes enrolment).
    requireAuthAllowingMfaEnrolment,
    async (req: Request, res: Response) => {
      try {
        const userId = req.session.userId!;
        const validation = stepUpSchema.safeParse(req.body);

        if (!validation.success) {
          return res.status(400).json({
            success: false,
            error: { message: "Password or 6-digit code required" },
          });
        }

        const { code, password } = validation.data;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (!user) {
          return res.status(401).json({
            success: false,
            error: {
              code: "INVALID_CREDENTIALS",
              message: "Invalid credentials",
            },
          });
        }

        // Account lockout: a hijacked session must not brute-force the password.
        // Uniform 401 so lock state is not revealed (no enumeration).
        if (user.lockedUntil && new Date() < new Date(user.lockedUntil)) {
          return res.status(401).json({
            success: false,
            error: {
              code: "INVALID_CREDENTIALS",
              message: "Invalid credentials",
            },
          });
        }

        let verified = false;
        let method: "password" | "mfa_code" | null = null;

        // Login and step-up consume through the same locked credential check.
        if (code) {
          try {
            await consumeMfaCredential(req, code, "step-up");
            verified = true;
            method = "mfa_code";
          } catch (error) { if (!(error instanceof UnauthorizedError)) throw error; }
        }

        // Password re-auth path: available to every user.
        if (!verified && password && user.passwordHash) {
          if (await verifyHash(password, user.passwordHash)) {
            verified = true;
            method = "password";
          }
        }

        if (!verified) {
          // Count password failures toward the same lockout as login. Code-only
          // failures are self-limiting (one-time, time-boxed) so they don't lock.
          if (password) {
            const attempts = (user.failedLoginAttempts ?? 0) + 1;
            const update: {
              failedLoginAttempts: number;
              lastFailedLoginAt: Date;
              lockedUntil?: Date;
            } = {
              failedLoginAttempts: attempts,
              lastFailedLoginAt: new Date(),
            };
            if (attempts >= MAX_FAILED_ATTEMPTS) {
              update.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
              await auditService.log({
                eventType: AuditEventType.ACCOUNT_LOCKED,
                userId,
                ipAddress: req.ip || req.socket.remoteAddress,
                userAgent: req.headers["user-agent"],
                details: {
                  reason: "max_failed_attempts",
                  attempts,
                  source: "step-up",
                },
              });
            }
            await db.update(users).set(update).where(eq(users.id, userId));
          }

          await auditService.log({
            eventType: AuditEventType.MFA_FAILED,
            userId,
            ipAddress: req.ip || req.socket.remoteAddress,
            userAgent: req.headers["user-agent"],
            details: { action: "step-up" },
          });

          return res.status(401).json({
            success: false,
            error: {
              code: "INVALID_CREDENTIALS",
              message: "Invalid credentials",
            },
          });
        }

        // Reset the failed-attempt counter on successful re-auth (mirror login).
        if (user.failedLoginAttempts && user.failedLoginAttempts > 0) {
          await db
            .update(users)
            .set({ failedLoginAttempts: 0, lockedUntil: null })
            .where(eq(users.id, userId));
        }

        setStepUpVerified(req);

        if (method === "password") await auditService.log({
          eventType: AuditEventType.MFA_VERIFIED,
          userId,
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.headers["user-agent"],
          details: { action: "step-up", method: method ?? undefined },
        });

        logger.info("Step-up verification successful", {
          requestId: req.requestId,
          userId: userId.substring(0, 8) + "...",
          method: method ?? undefined,
        });

        res.json({
          success: true,
          message: "Step-up verification successful",
          expiresIn: 15 * 60, // seconds
        });
      } catch (error) {
        logger.error(
          "Error verifying step-up",
          { requestId: req.requestId },
          error as Error,
        );
        res
          .status(500)
          .json({ error: { message: "Step-up verification failed" } });
      }
    },
  );

  /**
   * GET /step-up/status - Check if current session has valid step-up verification.
   */
  router.get("/step-up/status", requireAuthAllowingMfaEnrolment, (req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        isVerified: isStepUpValid(req),
      },
    });
  });
}
