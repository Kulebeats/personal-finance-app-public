/**
 * Auth Module MFA Service
 *
 * Handles Multi-Factor Authentication logic.
 * Extracted from auth.service.ts to reduce LOC.
 *
 * @module modules/auth/auth.mfa.service
 */

import crypto from "node:crypto";
import { Request } from "express";
import {
  isEmailServiceConfigured,
  sendMfaCodeEmail,
} from "../../services/emailService";
import { auditService, AuditEventType } from "../../services/AuditService";
import { logger } from "../../utils/logger";
import { UnauthorizedError } from "../../core/errors";
import { User } from "@shared/schema";
import { MfaLoginVerifyInput } from "./auth.validation";
import { assertCurrentCredential } from "../../services/session-identity";
import { consumeMfaCredential, storeMfaChallenge } from "./auth.mfa-credential";
import { authSessionService } from "./auth.session.service";

/**
 * MFA login code TTL
 */
const MFA_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const authMfaService = {
  /**
   * Begin MFA login flow by creating a pending MFA session state.
   *
   * The user is NOT authenticated yet. We store the pending user ID
   * and remember-me preference in the session, and store a hashed MFA
   * code with expiry on the user record.
   */
  async beginMfaLogin(
    user: User,
    req: Request,
    rememberMe: boolean,
    ipAddress: string,
    userAgent: string,
  ): Promise<void> {
    await assertCurrentCredential(user);
    const code = this.generateMfaCode();
    const expiry = new Date(Date.now() + MFA_CODE_TTL_MS);

    // Hash the code before storage
    // SECURITY: mfa_code is now hashed to prevent OTP leakage from database
    const hashedCode = await import("../../auth").then((m) =>
      m.hashPassword(code),
    );

    await storeMfaChallenge(user, hashedCode, expiry);

    // An authenticated or different pending identity cannot keep its SID when
    // entering this challenge. Ordinary anonymous challenges/resends keep their
    // existing CSRF-bound session until successful MFA completion rotates it.
    if (req.session.userId || (req.session.mfaPendingUserId && req.session.mfaPendingUserId !== user.id)) {
      await authSessionService.regenerateSession(req);
    }

    // Ensure no authenticated session is set yet
    delete req.session.userId;
    req.session.mfaPendingUserId = user.id;
    req.session.mfaPendingSecurityGeneration = user.securityGeneration ?? 0;
    req.session.mfaPendingRememberMe = rememberMe;

    // Send MFA code via email when configured
    if (isEmailServiceConfigured()) {
      await sendMfaCodeEmail(user.email, code, user.fullName || user.username);
    } else {
      logger.warn("Email service not configured, MFA code not sent", {
        userId: user.id.substring(0, 8) + "...",
      });
    }

    logger.info("MFA challenge created", {
      requestId: req.requestId,
      userId: user.id.substring(0, 8) + "...",
      ipAddress,
      userAgent,
    });
  },

  /**
   * Verify MFA during login using pending-session state.
   *
   * Requires req.session.mfaPendingUserId to be set by beginMfaLogin().
   * Returns details needed to finalize login (which is done by auth.service).
   */
  async verifyMfaLogin(
    data: MfaLoginVerifyInput,
    req: Request,
  ): Promise<{
    user: User;
    rememberMe: boolean;
    ipAddress: string;
    userAgent: string;
  }> {
    const pendingUserId = req.session.mfaPendingUserId;
    if (!pendingUserId) {
      throw new UnauthorizedError("MFA verification session not found");
    }

    const ipAddress = req.ip || req.socket?.remoteAddress || "unknown";
    const userAgent = req.headers["user-agent"] || "unknown";

    let user: User;
    try { ({ user } = await consumeMfaCredential(req, data.code, "login")); }
    catch (error) {
      await auditService.log({
        eventType: AuditEventType.MFA_FAILED,
        userId: pendingUserId,
        ipAddress,
        userAgent,
        details: { reason: error instanceof UnauthorizedError ? "invalid_or_expired_code" : "verification_unavailable" },
      });
      throw error;
    }

    const rememberMePending = Boolean(req.session.mfaPendingRememberMe);

    // Keep the pending identity until finalizeLogin retires its exact old SID.
    // Session regeneration then drops pending state before setting userId.

    return {
      user,
      rememberMe: rememberMePending,
      ipAddress,
      userAgent,
    };
  },

  /**
   * Generate a 6-digit MFA code using a cryptographically secure RNG.
   */
  generateMfaCode(): string {
    const code = crypto.randomInt(0, 1_000_000);
    return code.toString().padStart(6, "0");
  },

};
