/**
 * Auth Email Service
 *
 * Handles email verification operations.
 * Split from auth.service.ts to keep file sizes under 500 LOC.
 *
 * @module modules/auth/auth.email.service
 */

import type { Request } from "express";
import { buildPublicAuthLink } from "../../core/public-auth-link";
import { sendEmail } from "../../services/emailService";
import { buildEmailHtml } from "../../services/notification/email";
import { logger } from "../../utils/logger";
import { consumeEmailVerificationToken, issueInitialEmailVerification } from "../../services/security-email";

/** Verification mail is transactional: a clear button and no notification-preferences footer. */
function buildVerificationEmailHtml(verificationLink: string): string {
  return buildEmailHtml(
    "Verify your email",
    "Please verify your email address to complete your registration.",
    verificationLink,
    { buttonLabel: "Verify my email", showPreferencesFooter: false },
  );
}

/**
 * Auth Email Service
 *
 * Handles email verification and related operations.
 */
export const authEmailService = {
  /**
   * Verify email address
   */
  async verifyEmail(token: string, req?: Request): Promise<void> {
    await consumeEmailVerificationToken(token, { initialOnly: true, request: req });
  },

  /**
   * Resend verification email
   */
  async resendVerification(email: string): Promise<void> {
    const issued = await issueInitialEmailVerification(email);
    if (!issued) return;
    const verificationToken = issued.token;

    try {
      const verificationLink = buildPublicAuthLink("/verify-email", verificationToken);

      const emailHtml = buildVerificationEmailHtml(verificationLink);

      const accepted = await sendEmail({
        to: issued.email,
        subject: "Verify your email",
        html: emailHtml,
        text: `Please verify your email: ${verificationLink}`,
      });
      if (accepted) logger.info("Verification email resend accepted", { userId: issued.userId, outcome: "success" });
      else logger.warn("Verification email resend unavailable", { userId: issued.userId, outcome: "failure" });
    } catch {
      logger.error("Verification email resend failed", { userId: issued.userId, outcome: "error" });
    }
  },

  /**
   * Send initial verification email for new registration
   */
  async sendVerificationEmail(
    email: string,
    verificationToken: string,
    userId?: string,
  ): Promise<void> {
    try {
      const verificationLink = buildPublicAuthLink("/verify-email", verificationToken);

      const emailHtml = buildVerificationEmailHtml(verificationLink);

      const accepted = await sendEmail({
        to: email,
        subject: "Verify your email",
        html: emailHtml,
        text: `Please verify your email: ${verificationLink}`,
      });
      if (accepted) logger.info("Verification email send accepted", { userId, outcome: "success" });
      else logger.warn("Verification email send unavailable", { userId, outcome: "failure" });
    } catch {
      logger.error("Verification email send failed", { userId, outcome: "error" });
      // Don't fail registration if email fails
    }
  },
};
