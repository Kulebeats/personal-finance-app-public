/**
 * Auth Email Service
 *
 * Handles email verification operations.
 * Split from auth.service.ts to keep file sizes under 500 LOC.
 *
 * @module modules/auth/auth.email.service
 */

import { Request } from "express";
import { userRepository } from "../../repositories/UserRepository";
import { sendEmail } from "../../services/emailService";
import { buildEmailHtml } from "../../services/notification/email";
import { auditService, AuditEventType } from "../../services/AuditService";
import { logger } from "../../utils/logger";
import { ValidationError } from "../../core/errors";
import { sha256Hex } from "../../core/tokenHash";

/**
 * Auth Email Service
 *
 * Handles email verification and related operations.
 */
export const authEmailService = {
  /**
   * Verify email address
   */
  async verifyEmail(token: string): Promise<void> {
    const user = await userRepository.findByVerificationToken(
      sha256Hex(token),
    );
    if (!user) {
      throw new ValidationError("Invalid verification token");
    }

    if (
      user.emailVerificationExpiry &&
      new Date() > new Date(user.emailVerificationExpiry)
    ) {
      throw new ValidationError("Verification token expired");
    }

    if (user.emailVerified) {
      return; // Already verified
    }

    await userRepository.update(user.id, {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiry: null,
    });

    await auditService.log({
      eventType: AuditEventType.EMAIL_VERIFIED,
      userId: user.id,
      details: { email: user.email },
    });
  },

  /**
   * Resend verification email
   */
  async resendVerification(email: string): Promise<void> {
    const user = await userRepository.findByEmail(email);
    if (!user) {
      // Silent failure for security (don't reveal email existence)
      return;
    }

    if (user.emailVerified) {
      // Already verified
      return;
    }

    const crypto = await import("crypto");
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Only the hash is persisted; the raw token is emailed below.
    await userRepository.update(user.id, {
      emailVerificationToken: sha256Hex(verificationToken),
      emailVerificationExpiry: verificationExpiry,
    });

    try {
      const baseUrl = process.env.APP_URL || "http://localhost:5000";
      const verificationLink = `${baseUrl}/verify-email?token=${verificationToken}`;

      const emailHtml = buildEmailHtml(
        "Verify your email",
        "Please verify your email address to complete your registration.",
        verificationLink,
      );

      await sendEmail({
        to: email,
        subject: "Verify your email",
        html: emailHtml,
        text: `Please verify your email: ${verificationLink}`,
      });
      logger.info(`Verification email resent to ${email}`);
    } catch (error) {
      logger.error(
        `Failed to resend verification email to ${email}`,
        {},
        error as Error,
      );
    }
  },

  /**
   * Send initial verification email for new registration
   */
  async sendVerificationEmail(
    email: string,
    verificationToken: string,
  ): Promise<void> {
    try {
      const baseUrl = process.env.APP_URL || "http://localhost:5000";
      const verificationLink = `${baseUrl}/verify-email?token=${verificationToken}`;

      const emailHtml = buildEmailHtml(
        "Verify your email",
        "Please verify your email address to complete your registration.",
        verificationLink,
      );

      await sendEmail({
        to: email,
        subject: "Verify your email",
        html: emailHtml,
        text: `Please verify your email: ${verificationLink}`,
      });
      logger.info(`Verification email sent to ${email}`);
    } catch (error) {
      logger.error(
        `Failed to send verification email to ${email}`,
        {},
        error as Error,
      );
      // Don't fail registration if email fails
    }
  },
};
