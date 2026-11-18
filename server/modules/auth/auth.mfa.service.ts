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
import { userRepository } from "../../repositories/UserRepository";
import {
  isEmailServiceConfigured,
  sendMfaCodeEmail,
} from "../../services/emailService";
import { auditService, AuditEventType } from "../../services/AuditService";
import { verifyPassword } from "../../auth";
import { logger } from "../../utils/logger";
import { UnauthorizedError, NotFoundError } from "../../core/errors";
import { User } from "@shared/schema";
import { MfaLoginVerifyInput } from "./auth.validation";

/**
 * MFA login code TTL
 */
const MFA_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * MFA backup codes expire after 90 days
 */
const MFA_BACKUP_CODE_EXPIRY_DAYS = 90;

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
    const code = this.generateMfaCode();
    const expiry = new Date(Date.now() + MFA_CODE_TTL_MS);

    // Hash the code before storage
    // SECURITY: mfa_code is now hashed to prevent OTP leakage from database
    const hashedCode = await import("../../auth").then((m) =>
      m.hashPassword(code),
    );

    await userRepository.update(user.id, {
      mfaCode: hashedCode,
      mfaCodeExpiry: expiry,
    });

    // Ensure no authenticated session is set yet
    delete req.session.userId;
    req.session.mfaPendingUserId = user.id;
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

    const user = await userRepository.findById(pendingUserId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const now = new Date();
    let mfaVerified = false;
    let backupCodesUpdated: string[] | null | undefined;

    // Primary MFA code verification (time-limited OTP)
    const hasValidOtp =
      Boolean(user.mfaCode) &&
      Boolean(user.mfaCodeExpiry) &&
      user.mfaCodeExpiry !== null &&
      now <= new Date(user.mfaCodeExpiry);

    if (hasValidOtp && user.mfaCode) {
      // Compare provided code against stored hash
      mfaVerified = await verifyPassword(data.code, user.mfaCode);
    }

    // Backup code verification (one-time use, 90-day expiry)
    if (!mfaVerified && user.mfaBackupCodes && user.mfaBackupCodes.length > 0) {
      const backupCodesExpired = this.areBackupCodesExpired(
        user.mfaBackupCodesGeneratedAt,
      );

      if (!backupCodesExpired) {
        let validCodeIndex = -1;
        for (let i = 0; i < user.mfaBackupCodes.length; i++) {
          const isValid = await verifyPassword(
            data.code,
            user.mfaBackupCodes[i],
          );
          if (isValid) {
            validCodeIndex = i;
            break;
          }
        }

        if (validCodeIndex !== -1) {
          mfaVerified = true;
          backupCodesUpdated = user.mfaBackupCodes.filter(
            (_code, index) => index !== validCodeIndex,
          );
        }
      }
    }

    if (!mfaVerified) {
      await auditService.log({
        eventType: AuditEventType.MFA_FAILED,
        userId: user.id,
        ipAddress,
        userAgent,
        details: { reason: "invalid_or_expired_code" },
      });
      throw new UnauthorizedError("Invalid or expired MFA code");
    }

    const rememberMePending = Boolean(req.session.mfaPendingRememberMe);

    // Clear MFA code and pending session state
    delete req.session.mfaPendingUserId;
    delete req.session.mfaPendingRememberMe;

    const updateData: Partial<User> = {
      mfaCode: null,
      mfaCodeExpiry: null,
    };
    if (backupCodesUpdated !== undefined) {
      updateData.mfaBackupCodes = backupCodesUpdated;
    }
    await userRepository.update(user.id, updateData);

    await auditService.log({
      eventType: AuditEventType.MFA_VERIFIED,
      userId: user.id,
      ipAddress,
      userAgent,
    });

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

  /**
   * Check whether backup codes have expired.
   */
  areBackupCodesExpired(generatedAt?: Date | null): boolean {
    if (!generatedAt) return false;
    const expiryDate = new Date(generatedAt);
    expiryDate.setDate(expiryDate.getDate() + MFA_BACKUP_CODE_EXPIRY_DAYS);
    return new Date() > expiryDate;
  },
};
