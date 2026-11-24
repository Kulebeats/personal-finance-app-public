import nodemailer, { type Transporter } from "nodemailer";
import { randomBytes } from "crypto";
import { logger } from "../utils/logger";
import { buildPublicAuthLink } from "../core/public-auth-link";
import { escapeHtml } from "./notification/escape";

/**
 * Email Service
 *
 * Handles sending emails for verification, password reset, etc.
 * Uses Nodemailer with configurable SMTP transport.
 */

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Journaled callers need an unknown outcome when SMTP acceptance cannot be proven. */
  throwOnUnknownDelivery?: boolean;
}

/** Nodemailer's CONN error can come from the socket after the message was sent. */
function definitelyNotAccepted(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, command, message, response, syscall, timeoutType, responseCode } = error as {
    message?: string; response?: string;
    code?: string; command?: string; syscall?: string; timeoutType?: string; responseCode?: number;
  };
  if (code === "EDNS" || code === "EAUTH" || syscall === "connect") return true;
  if (code === "ETIMEDOUT" && ["CONNECT_TIMEOUT", "GREETING_TIMEOUT", "UPGRADE_TIMEOUT"].includes(timeoutType ?? "")) {
    return true;
  }
  if (command === "EHLO" || command === "HELO" || command === "STARTTLS") return true;
  if (command === "MAIL FROM" || command === "RCPT TO") return true;
  const rejected = typeof responseCode === "number" && responseCode >= 400 && responseCode < 600;
  // Nodemailer also uses EPROTOCOL/CONN for unexpected responses. Only
  // _actionGreeting emits this message before the envelope or its data.
  if (code === "EPROTOCOL" && command === "CONN" && rejected && response
    && message === `Invalid greeting. response=${response}: ${response}`) return true;
  return rejected && command === "DATA" && (code === "EENVELOPE" || code === "EMESSAGE");
}

// SEC-CONFIG-001: Email config from environment variables (no unsafe defaults)
const getEmailConfig = (): EmailConfig | null => {
  if (process.env.NODE_ENV === "test") {
    return null;
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  // Return null if required SMTP config is missing
  if (!host || !user || !pass) {
    return null;
  }

  return {
    host,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  };
};

// Create reusable transporter
let transporter: Transporter | null = null;

const getTransporter = (): Transporter | null => {
  if (!transporter) {
    const config = getEmailConfig();
    if (!config) {
      return null;
    }
    transporter = nodemailer.createTransport(config);
  }
  return transporter;
};

// Check if email service is configured
export function isEmailServiceConfigured(): boolean {
  return getEmailConfig() !== null;
}

// Log SMTP status on module load
logger.info("SMTP configured", {
  configured: isEmailServiceConfigured() ? "YES" : "NO",
});
if (!isEmailServiceConfigured()) {
  logger.info("Missing SMTP_USER or SMTP_PASS");
}

// Send email
export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  let attempted = false;
  try {
    const transport = getTransporter();

    if (!transport) {
      // SEC-CONFIG-002: Only allow skipping email outside production modes
      if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
        logger.warn("SMTP not configured, skipping email send", {
          environment: process.env.NODE_ENV,
        });
        logger.debug("Would send email", {
          to: options.to,
          subject: options.subject,
        });
        return false;
      }
      // In production, SMTP must be configured
      logger.error("SMTP not configured in production - email send failed");
      return false;
    }

    // SEC-CONFIG-003: SMTP_FROM is required, no unsafe fallbacks
    const fromEmail = process.env.SMTP_FROM;
    if (!fromEmail) {
      logger.error("SMTP_FROM not configured - email send failed");
      return false;
    }

    const message = {
      // nodemailer encodes the display name itself, so quotes and non-ASCII are safe.
      from: { name: fromDisplayName(), address: fromEmail },
      to: options.to,
      // A user name in a subject must not be able to add headers.
      subject: options.subject.replace(/[\r\n]+/g, " "),
      html: options.html,
      text: options.text || options.html.replace(/<[^>]*>/g, ""),
      disableFileAccess: true,
      disableUrlAccess: true,
    };
    attempted = true;
    await transport.sendMail(message);

    logger.info("Email sent", { to: options.to });
    return true;
  } catch (error) {
    logger.error("Failed to send email", {}, error as Error);
    if (options.throwOnUnknownDelivery && attempted && !definitelyNotAccepted(error)) {
      throw new Error("SMTP acceptance could not be determined");
    }
    return false;
  }
}

const DEFAULT_FROM_NAME = "Personal Finance App";

/**
 * The From display name: SMTP_FROM_NAME, or the app's name when unset or blank.
 * Line breaks become spaces, so the name can never start a header of its own.
 */
function fromDisplayName(): string {
  const configured = (process.env.SMTP_FROM_NAME ?? "").replace(/[\r\n]+/g, " ").trim();
  return configured || DEFAULT_FROM_NAME;
}

// Generate verification token
//
// SECURITY: Math.random() is NOT a CSPRNG - its output is predictable from a
// small number of samples, which would let an attacker guess a live email
// verification/change token and hijack the flow. Use crypto.randomBytes,
// mirroring the reset-token generator in auth.password-reset.service.ts.
export function generateVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

// Send email verification
export async function sendVerificationEmail(
  email: string,
  token: string,
  isEmailChange = false
): Promise<boolean> {
  const verifyUrl = buildPublicAuthLink("/verify-email", token);

  const subject = isEmailChange
    ? "Confirm Your New Email Address"
    : "Verify Your Email Address";
  const safeVerifyUrl = escapeHtml(verifyUrl);

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">
          ${isEmailChange ? "Confirm Email Change" : "Verify Your Email"}
        </h1>
      </div>
      <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="margin-top: 0;">
          ${
            isEmailChange
              ? "You've requested to change your email address. Click the button below to confirm this change."
              : "Welcome! Please verify your email address to complete your account setup."
          }
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${safeVerifyUrl}"
             style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                    color: white; 
                    padding: 14px 28px; 
                    text-decoration: none; 
                    border-radius: 8px; 
                    font-weight: 600;
                    display: inline-block;">
            ${isEmailChange ? "Confirm Email Change" : "Verify Your Email"}
          </a>
        </div>
        <p style="font-size: 14px; color: #6b7280;">
          This link will expire in 24 hours. If you didn't request this, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="font-size: 12px; color: #9ca3af; margin-bottom: 0;">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${safeVerifyUrl}" style="color: #667eea; word-break: break-all;">${safeVerifyUrl}</a>
        </p>
      </div>
    </body>
    </html>
  `;

  return sendEmail({ to: email, subject, html });
}

// Send password reset email
export async function sendPasswordResetEmail(
  email: string,
  token: string
): Promise<boolean> {
  const resetUrl = buildPublicAuthLink("/reset-password", token);
  const safeResetUrl = escapeHtml(resetUrl);

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Reset Your Password</h1>
      </div>
      <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="margin-top: 0;">
          We received a request to reset your password. Click the button below to create a new password.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${safeResetUrl}"
             style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); 
                    color: white; 
                    padding: 14px 28px; 
                    text-decoration: none; 
                    border-radius: 8px; 
                    font-weight: 600;
                    display: inline-block;">
            Reset Password
          </a>
        </div>
        <p style="font-size: 14px; color: #6b7280;">
          This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="font-size: 12px; color: #9ca3af; margin-bottom: 0;">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${safeResetUrl}" style="color: #f59e0b; word-break: break-all;">${safeResetUrl}</a>
        </p>
      </div>
    </body>
    </html>
  `;

  return sendEmail({ to: email, subject: "Reset Your Password", html });
}

// Send MFA verification code email
export async function sendMfaCodeEmail(
  email: string,
  code: string,
  name: string,
  purpose: "login" | "settings" = "login"
): Promise<boolean> {
  const reason = purpose === "settings"
    ? "to change your two-step verification settings"
    : "for logging in";
  const html = `
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Your Verification Code</h1>
      </div>
      <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="margin-top: 0;">
          Hi ${escapeHtml(name)},
        </p>
        <p>
          Your verification code ${reason} is:
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <span style="background: #f3f4f6; 
                       padding: 20px 40px; 
                       font-size: 32px; 
                       font-weight: bold; 
                       letter-spacing: 8px;
                       border-radius: 8px;
                       color: #1f2937;">
            ${escapeHtml(code)}
          </span>
        </div>
        <p style="font-size: 14px; color: #6b7280;">
          This code will expire in 10 minutes. If you didn't request this code, please ignore this email and consider changing your password.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="font-size: 12px; color: #9ca3af; margin-bottom: 0;">
          For security, never share this code with anyone. Our team will never ask for it.
        </p>
      </div>
    </body>
    </html>
  `;

  return sendEmail({ to: email, subject: "Your Verification Code", html });
}
