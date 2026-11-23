/**
 * Auth Password Reset Service (R1)
 *
 * Forgot/reset password business logic.
 *
 * SECURITY DESIGN:
 * - Tokens are 32 random bytes (hex); only the sha256 hash is persisted.
 *   The raw token exists solely in the reset email and is never logged.
 * - Requests are enumeration-safe: unknown emails do equivalent work and
 *   return the exact same response as known emails.
 * - Reset is single-use, time-limited (60 min), and consumes the token row
 *   under FOR UPDATE inside one transaction (Rule 10).
 * - A successful reset revokes EVERY existing session for the user (both the
 *   connect-pg-simple session store and the userSessions tracking table) and
 *   clears login-lockout counters.
 * - Both request and completion write securityAuditLogs events (never the
 *   token).
 *
 * @module modules/auth/auth.password-reset.service
 */

import { Request } from "express";
import { randomBytes } from "crypto";
import { and, eq, isNull, ne } from "drizzle-orm";
import { passwordResetTokens, users, securityAuditLogs } from "@shared/schema";
import { userRepository } from "../../repositories/UserRepository";
import { withTransaction } from "../../utils/withTransaction";
import { hashPassword, validatePasswordComplexity } from "../../auth";
import { sendPasswordResetEmail } from "../../services/emailService";
import { AuditEventType } from "../../services/AuditService";
import { revokeUserSessions } from "../../services/session-revocation";
import { assertPasswordNotReused, recordPasswordInHistory } from "./auth.password-history";
import { logger } from "../../utils/logger";
import { ValidationError } from "../../core/errors";
import { sha256Hex } from "../../core/tokenHash";
import { enqueueSecurityNotice } from "../../services/security-notice";

/** Reset links are valid for 60 minutes. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Single generic message - no oracle for unknown vs expired vs used tokens. */
const GENERIC_TOKEN_ERROR =
  "This password reset link is invalid or has expired. Please request a new one.";

function requestContext(req: Request): {
  ipAddress: string;
  userAgent: string;
} {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || "unknown",
    userAgent: req.headers["user-agent"] || "unknown",
  };
}

/**
 * Auth Password Reset Service
 */
export const authPasswordResetService = {
  /**
   * Handle a forgot-password request.
   *
   * ALWAYS resolves without revealing whether the email is registered.
   * When the user exists: invalidates previous unused tokens, stores a new
   * hashed token, emails the raw token, and audits the request.
   */
  async requestPasswordReset(email: string, req: Request): Promise<void> {
    const { ipAddress, userAgent } = requestContext(req);
    const user = await userRepository.findByEmail(email);

    if (!user) {
      /**
       * SECURITY: enumeration safety. Perform equivalent token work so the
       * unknown-email branch does not return measurably faster, then exit
       * silently with the same generic response as the known-email path.
       */
      sha256Hex(randomBytes(32).toString("hex"));
      return;
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    const issued = await withTransaction(async (tx) => {
      const [current] = await tx.select().from(users).where(eq(users.id, user.id)).for("update");
      if (!current || current.erasedAt || current.passwordHash.startsWith("!erased!") || current.email !== email || current.email !== user.email) return;
      // Invalidate any previous outstanding tokens for this user.
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            isNull(passwordResetTokens.usedAt),
          ),
        );

      await tx.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash,
        expiresAt,
        requestIp: req.ip || null,
      });
      await tx.insert(securityAuditLogs).values({ eventType: AuditEventType.PASSWORD_RESET_REQUEST, userId: current.id,
        ipAddress, userAgent, details: { action: "password_reset_request" } });
      return { recipient: current.email };
    });
    if (!issued) return;

    try {
      await sendPasswordResetEmail(issued.recipient, rawToken);
    } catch {
      // The response must stay generic; log the failure server-side only.
      logger.error(
        "Failed to send password reset email",
        { userId: user.id.substring(0, 8) + "..." },
      );
    }
  },

  /**
   * Complete a password reset with a raw token from the email link.
   *
   * Atomically (Rule 10): consumes the token under FOR UPDATE, rotates the
   * password, invalidates the user's other outstanding tokens, clears
   * login-lockout counters, and revokes ALL existing sessions.
   */
  async resetPassword(
    rawToken: string,
    newPassword: string,
    req: Request,
  ): Promise<void> {
    const { ipAddress, userAgent } = requestContext(req);

    // Same server-side complexity gate as registration.
    const complexity = validatePasswordComplexity(newPassword);
    if (!complexity.valid) {
      throw new ValidationError(
        "Password does not meet complexity requirements",
        complexity.errors.map((message) => ({ field: "newPassword", message })),
      );
    }

    const tokenHash = sha256Hex(rawToken);
    const newPasswordHash = await hashPassword(newPassword);

    const { userId } = await withTransaction(async (tx) => {
      // Resolve the subject, then use the same user-first lock order as every
      // other identity mutation before locking/consuming the token itself.
      const [candidate] = await tx
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .limit(1);
      if (!candidate) throw new ValidationError(GENERIC_TOKEN_ERROR);

      const [user] = await tx.select().from(users).where(eq(users.id, candidate.userId)).for("update").limit(1);
      if (!user || user.erasedAt || user.passwordHash.startsWith("!erased!")) throw new ValidationError(GENERIC_TOKEN_ERROR);
      const [tokenRow] = await tx.select().from(passwordResetTokens).where(eq(passwordResetTokens.id, candidate.id)).for("update").limit(1);

      if (
        !tokenRow ||
        tokenRow.usedAt !== null ||
        tokenRow.expiresAt.getTime() <= Date.now()
      ) {
        // One generic error for unknown, used, and expired tokens.
        throw new ValidationError(GENERIC_TOKEN_ERROR);
      }

      await assertPasswordNotReused(tx, user, newPassword);
      await recordPasswordInHistory(user.id, user.passwordHash, tx);

      // Consume this token and invalidate any other outstanding tokens.
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, tokenRow.id));
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            isNull(passwordResetTokens.usedAt),
            ne(passwordResetTokens.id, tokenRow.id),
          ),
        );

      // Rotate the password and clear login-lockout counters.
      await tx
        .update(users)
        .set({
          passwordHash: newPasswordHash,
          ...(user.pendingEmail !== null ? { pendingEmail: null, emailVerificationToken: null, emailVerificationExpiry: null } : {}),
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastFailedLoginAt: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      /**
       * Revoke ALL existing sessions for this user (fail-closed: if this
       * fails the whole reset rolls back rather than leaving live sessions
       * on a rotated password). Unlike an authenticated password CHANGE,
       * a reset has no "current session" worth preserving - the requester
       * is not authenticated, so every session goes.
       */
      await revokeUserSessions(tx, user.id);
      await enqueueSecurityNotice(tx, user, req, { eventType: "PASSWORD_RESET_COMPLETE", kind: "password_changed",
        recipients: [user.email], action: "password_reset", sessionsRevoked: true });

      return { userId: user.id };
    });

    logger.info("Password reset completed", {
      userId: userId.substring(0, 8) + "...",
    });
  },
};
