/**
 * MFA Authenticated Routes
 *
 * Email-code MFA management for a signed-in user (R06.1):
 * - POST /enable                  email an enrolment code (MFA stays off)
 * - POST /enable/confirm          code -> MFA on, backup codes shown once
 * - POST /code                    { purpose } email a code for disable OR regenerate
 * - POST /disable                 password + code -> MFA off
 * - POST /backup-codes/regenerate code -> new backup codes shown once
 * - GET  /status
 *
 * AH-11: /enable, /disable and /backup-codes/regenerate also need a recent
 * step-up (sudo mode), like the other sensitive security routes. /enable/confirm is not gated: it only accepts
 * the code /enable issued, bound to this session and purpose.
 *
 * Business logic lives in modules/auth/auth.mfa-enrolment.service.ts.
 *
 * @module routes/security.mfa.auth
 */

import { Router, Request, Response, NextFunction, RequestHandler } from "express";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireAuthAllowingMfaEnrolment } from "../auth";
import { authLimiter } from "../middleware/rateLimit";
import { requireStepUp } from "../middleware/requireStepUp";
import { logger } from "../utils/logger";
import { success } from "../core/http";
import { ValidationError } from "../core/errors";
import { mfaCompliance } from "../modules/auth/auth.mfa-compliance";
import {
  confirmMfaEnrolment, disableMfa, regenerateMfaBackupCodes, sendMfaSettingsCode,
} from "../modules/auth/auth.mfa-enrolment.service";

const codeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your email"),
});
const codePurposeSchema = z.object({
  purpose: z.enum(["disable", "regenerate"], { message: "Say which change the code is for" }),
});
const disableMfaSchema = codeSchema.extend({
  password: z.string().min(1, "Enter your password"),
});

// Matches the low-codes threshold used by the backup-code login/verify path.
const LOW_BACKUP_CODES_THRESHOLD = 3;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(result.error.errors[0]?.message ?? "Invalid request", result.error.errors);
  }
  return result.data;
}

/** Wrap an async handler so thrown AppErrors reach the error middleware. */
const handle = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

const logChange = (req: Request, message: string) =>
  logger.info(message, { requestId: req.requestId, userId: req.session.userId?.substring(0, 8) + "..." });

/** Responses carrying plaintext backup codes must never be cached. */
function sendBackupCodes(res: Response, backupCodes: string[], message: string): void {
  res.set("Cache-Control", "no-store");
  success(res, { backupCodes }, 200, { message });
}

export function registerMfaAuthRoutes(router: Router): void {
  router.post("/enable", authLimiter, requireAuthAllowingMfaEnrolment, requireStepUp("SETTINGS"), handle(async (req, res) => {
    const sent = await sendMfaSettingsCode(req, "enable");
    success(res, { codeSent: true, ...sent }, 200, { message: "We emailed you a 6-digit code" });
  }));

  router.post("/enable/confirm", authLimiter, requireAuthAllowingMfaEnrolment, handle(async (req, res) => {
    const { code } = parse(codeSchema, req.body);
    const backupCodes = await confirmMfaEnrolment(req, code);
    logChange(req, "MFA enabled");
    sendBackupCodes(res, backupCodes, "Two-step verification is on");
  }));

  router.post("/code", authLimiter, requireAuth, handle(async (req, res) => {
    const { purpose } = parse(codePurposeSchema, req.body);
    const sent = await sendMfaSettingsCode(req, purpose);
    success(res, { codeSent: true, ...sent }, 200, { message: "We emailed you a 6-digit code" });
  }));

  router.post("/disable", authLimiter, requireAuth, requireStepUp("SETTINGS"), handle(async (req, res) => {
    const { password, code } = parse(disableMfaSchema, req.body);
    await disableMfa(req, password, code);
    logChange(req, "MFA disabled");
    success(res, null, 200, { message: "Two-step verification is off" });
  }));

  router.post("/backup-codes/regenerate", authLimiter, requireAuth, requireStepUp("SETTINGS"), handle(async (req, res) => {
    const { code } = parse(codeSchema, req.body);
    const backupCodes = await regenerateMfaBackupCodes(req, code);
    logChange(req, "MFA backup codes regenerated");
    sendBackupCodes(res, backupCodes, "New backup codes created");
  }));

  router.get("/status", requireAuthAllowingMfaEnrolment, handle(async (req, res) => {
    const [user] = await db
      .select({ mfaEnabled: users.mfaEnabled, mfaMethod: users.mfaMethod, mfaBackupCodes: users.mfaBackupCodes,
        mfaGraceEndsAt: users.mfaGraceEndsAt })
      .from(users)
      .where(eq(users.id, req.session.userId!))
      .limit(1);

    const mfaEnabled = user?.mfaEnabled || false;
    const backupCodesRemaining = user?.mfaBackupCodes?.length ?? 0;
    success(res, {
      mfaEnabled,
      mfaMethod: user?.mfaMethod || null,
      backupCodesRemaining,
      // Only meaningful once MFA is on; otherwise there is nothing to regenerate.
      lowCodesWarning: mfaEnabled && backupCodesRemaining <= LOW_BACKUP_CODES_THRESHOLD,
      // AH-11: every member needs MFA; `state` says whether this one is in the grace or past it.
      policy: user ? { required: true, ...mfaCompliance(user) } : null,
    });
  }));
}
