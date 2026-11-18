/**
 * Auth Module Service
 *
 * Business logic layer - owns all auth invariants and rules.
 * Email verification and session management are in separate files.
 *
 * Split modules:
 * - auth.email.service.ts: verifyEmail, resendVerification
 * - auth.session.service.ts: finalizeLogin, regenerateSession, logout
 *
 * @module modules/auth/auth.service
 */

import { Request } from "express";
import { userRepository } from "../../repositories/UserRepository";
import {
  hashPassword,
  verifyPassword,
  validatePasswordComplexity,
} from "../../auth";
import { seedDefaultNotificationPreferences } from "../../seed";
import { auditService, AuditEventType } from "../../services/AuditService";
import { logger } from "../../utils/logger";
import {
  LoginInput,
  RegisterInput,
  MfaLoginVerifyInput,
} from "./auth.validation";
import { authMfaService } from "./auth.mfa.service";
import { authSecurityMonitor } from "./auth.security.monitor";
import { authEmailService } from "./auth.email.service";
import { authSessionService } from "./auth.session.service";
import {
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "../../core/errors";
import { sha256Hex } from "../../core/tokenHash";
import { toPublicUser } from "./auth.types";
import type { User } from "@shared/schema";

// Re-export split services for backwards compatibility
export { authEmailService } from "./auth.email.service";
export { authSessionService } from "./auth.session.service";

// ============================================================================
// SECURITY CONSTANTS
// ============================================================================

/**
 * BUSINESS RULE: Brute Force Protection
 * - After MAX_FAILED_ATTEMPTS consecutive failures, account is locked
 * - Lockout duration prevents automated password guessing attacks
 * - Failed attempts reset on successful login
 */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * SECURITY (P4-51): Dummy hash for timing attack prevention
 * Used when user not found to maintain constant response time.
 * Pre-computed bcrypt hash with cost 12 (same as production).
 */
const DUMMY_HASH =
  "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.K2FqnEOJ1kOYXy";

// Extend session type to include pending MFA state
declare module "express-session" {
  interface SessionData {
    mfaPendingUserId?: string;
    mfaPendingRememberMe?: boolean;
  }
}

/**
 * Auth Service
 *
 * All authentication business logic lives here.
 */
export const authService = {
  /**
   * Register a new user
   *
   * SECURITY (P4-51): Account Enumeration Prevention
   * - Password is ALWAYS hashed even if email/username exists (constant time)
   * - Email conflicts return generic error to prevent email harvesting
   * - Username conflicts reveal existence (necessary for UX)
   */
  async register(
    data: RegisterInput,
    req: Request,
  ): Promise<{ user: Record<string, unknown> }> {
    // Validate password complexity
    const passwordValidation = validatePasswordComplexity(data.password);
    if (!passwordValidation.valid) {
      throw new ValidationError(
        "Password does not meet complexity requirements",
        passwordValidation.errors?.map((e: string) => ({
          field: "password",
          message: e,
        })) || [],
      );
    }

    /**
     * SECURITY: Constant-time password hashing
     * Hash password BEFORE checking if email exists.
     * This prevents timing attacks that could reveal registered emails.
     */
    const passwordHash = await hashPassword(data.password);

    // Check if email already exists
    const existingUser = await userRepository.findByEmail(data.email);
    if (existingUser) {
      throw new ConflictError(
        "Unable to create account. Please try a different email.",
      );
    }

    // Check if username already exists (OK to reveal - needed for UX)
    const existingUsername = await userRepository.findByUsername(data.username);
    if (existingUsername) {
      throw new ConflictError("Username already taken");
    }

    // Generate verification token. Only the SHA-256 hash is persisted; the
    // raw token is emailed and never stored (see server/core/tokenHash.ts).
    const crypto = await import("crypto");
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await userRepository.create({
      username: data.username,
      email: data.email,
      passwordHash,
      fullName: data.fullName,
      timezone: "UTC",
      emailVerificationToken: sha256Hex(verificationToken),
      emailVerificationExpiry: verificationExpiry,
      emailVerified: false,
    });

    // Create default display settings
    await userRepository.createDisplaySettings({
      userId: user.id,
      theme: "system",
      currency: "ZMW",
      numberFormat: "US",
      dateFormat: "MM/DD/YYYY",
      firstDayOfWeek: "Sunday",
      viewMode: "comfortable",
    });

    // Seed default notification preferences
    await seedDefaultNotificationPreferences(user.id);

    // FIX AUTH-SESSION-002: Regenerate session on registration to prevent session fixation
    await authSessionService.regenerateSession(req);
    req.session.userId = user.id;

    // Create session record for tracking
    const { parseDeviceInfo } = await import("./auth.device");
    const deviceInfo = parseDeviceInfo(req.headers["user-agent"] || "");
    try {
      await userRepository.upsertSession({
        userId: user.id,
        sessionToken: req.sessionID,
        deviceName: deviceInfo.deviceName,
        deviceType: deviceInfo.deviceType,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        ipAddress: req.ip || "unknown",
        expiresAt: new Date(
          Date.now() + (req.session.cookie.maxAge || 86400000),
        ),
      });

      // Create login history for registration (same as successful login)
      await userRepository.createLoginHistory({
        userId: user.id,
        deviceName: deviceInfo.deviceName,
        ipAddress: req.ip || "unknown",
        success: true,
      });
    } catch (sessionError) {
      logger.warn("Failed to create session record on registration", {
        userId: user.id?.substring(0, 8) + "...",
      });
    }

    // Audit log
    await auditService.log({
      eventType: AuditEventType.REGISTER,
      userId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: { email: data.email },
    });

    logger.info("User registered", {
      userId: user.id.substring(0, 8) + "...",
    });

    // Send verification email
    await authEmailService.sendVerificationEmail(data.email, verificationToken);

    return { user: toPublicUser(user) };
  },

  /**
   * Verify email address
   * @deprecated Use authEmailService.verifyEmail instead
   */
  async verifyEmail(token: string): Promise<void> {
    return authEmailService.verifyEmail(token);
  },

  /**
   * Resend verification email
   * @deprecated Use authEmailService.resendVerification instead
   */
  async resendVerification(email: string): Promise<void> {
    return authEmailService.resendVerification(email);
  },

  /**
   * Login user
   *
   * SECURITY (P4-51): Account Enumeration Prevention
   * - Performs dummy password verification when user not found (constant time)
   * - Same error message for invalid email and invalid password
   */
  async login(
    data: LoginInput,
    req: Request,
  ): Promise<{
    user?: Record<string, unknown>;
    requiresMfa?: boolean;
    maskedEmail?: string;
    suggestMfa?: boolean;
  }> {
    const ipAddress = req.ip || req.socket?.remoteAddress || "unknown";
    const userAgent = req.headers["user-agent"] || "unknown";

    // Find user
    const user = await userRepository.findByEmail(data.email);
    if (!user) {
      /**
       * SECURITY: Constant-time response for non-existent users
       * Perform a dummy password verification to prevent timing attacks.
       */
      await verifyPassword(data.password, DUMMY_HASH);
      throw new UnauthorizedError("Invalid email or password");
    }

    /**
     * SECURITY: Account Lockout Check
     */
    if (user.lockedUntil && new Date() < new Date(user.lockedUntil)) {
      const remainingMs = new Date(user.lockedUntil).getTime() - Date.now();
      const remainingMinutes = Math.ceil(remainingMs / 60000);
      throw new ForbiddenError(
        `Account is temporarily locked. Try again in ${remainingMinutes} minute(s).`,
      );
    }

    // Verify password
    const isValid = await verifyPassword(data.password, user.passwordHash);
    if (!isValid) {
      await this.handleFailedLogin(user.id, ipAddress, userAgent);
      throw new UnauthorizedError("Invalid email or password");
    }

    // SECURITY: Email Verification Check
    if (!user.emailVerified) {
      throw new ForbiddenError(
        "Email not verified. Please check your inbox.",
      );
    }

    // Reset failed login attempts on successful login
    if (user.failedLoginAttempts && user.failedLoginAttempts > 0) {
      await userRepository.update(user.id, {
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
    }

    // Return masked email for UX
    const maskedEmail = user.email.replace(
      /^(.)(.*)(.@.*)$/,
      (_, a, b, c) => a + b.replace(/./g, "*") + c,
    );

    if (user.mfaEnabled) {
      await authMfaService.beginMfaLogin(
        user,
        req,
        Boolean(data.rememberMe),
        ipAddress,
        userAgent,
      );
      return { requiresMfa: true, maskedEmail };
    }

    // Check if MFA should be suggested
    const { checkMfaPolicy } = await import("./auth.mfa-policy");
    const mfaPolicy = await checkMfaPolicy(user.id);

    // Complete login immediately when MFA is not required
    await authSessionService.finalizeLogin(
      user,
      req,
      Boolean(data.rememberMe),
      ipAddress,
      userAgent,
    );

    return {
      user: toPublicUser(user),
      suggestMfa: mfaPolicy.suggestEnrollment,
    };
  },

  /**
   * Resend MFA code
   */
  async resendMfaCode(
    req: Request,
  ): Promise<{ success: boolean; maskedEmail: string }> {
    const pendingUserId = req.session.mfaPendingUserId;
    if (!pendingUserId) {
      throw new UnauthorizedError("MFA verification session not found");
    }

    const user = await userRepository.findById(pendingUserId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const ipAddress = req.ip || req.socket?.remoteAddress || "unknown";
    const userAgent = req.headers["user-agent"] || "unknown";

    // Regenerate code (this invalidates previous code)
    await authMfaService.beginMfaLogin(
      user,
      req,
      Boolean(req.session.mfaPendingRememberMe),
      ipAddress,
      userAgent,
    );

    const maskedEmail = user.email.replace(
      /^(.)(.*)(.@.*)$/,
      (_, a, b, c) => a + b.replace(/./g, "*") + c,
    );

    return { success: true, maskedEmail };
  },

  /**
   * Verify MFA during login using pending-session state.
   */
  async verifyMfaLogin(
    data: MfaLoginVerifyInput,
    req: Request,
  ): Promise<{ user: Record<string, unknown> }> {
    const result = await authMfaService.verifyMfaLogin(data, req);

    // Complete login after MFA verification
    await authSessionService.finalizeLogin(
      result.user,
      req,
      result.rememberMe,
      result.ipAddress,
      result.userAgent,
    );

    return { user: toPublicUser(result.user) };
  },

  /**
   * Finalize login
   * @deprecated Use authSessionService.finalizeLogin instead
   */
  async finalizeLogin(
    user: User,
    req: Request,
    rememberMe: boolean,
    ipAddress: string,
    userAgent: string,
  ): Promise<void> {
    return authSessionService.finalizeLogin(user, req, rememberMe, ipAddress, userAgent);
  },

  /**
   * Handle failed login attempt
   */
  async handleFailedLogin(
    userId: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<void> {
    // Run security monitor checks (async, fire-and-forget)
    authSecurityMonitor.checkLoginVelocity(userId, ipAddress).catch((err) =>
      logger.error("Security monitor failed", {
        userId: userId.substring(0, 8) + "...",
        err,
      }),
    );

    const user = await userRepository.findById(userId);
    if (!user) return;

    const newAttempts = (user.failedLoginAttempts || 0) + 1;

    const updateData: Record<string, unknown> = {
      failedLoginAttempts: newAttempts,
      lastFailedLoginAt: new Date(),
    };

    // Lock account if threshold reached
    if (newAttempts >= MAX_FAILED_ATTEMPTS) {
      updateData.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);

      await auditService.log({
        eventType: AuditEventType.ACCOUNT_LOCKED,
        userId,
        ipAddress,
        userAgent,
        details: { reason: "max_failed_attempts", attempts: newAttempts },
      });
    }

    await userRepository.update(userId, updateData);

    // Log failed login
    await userRepository.createLoginHistory({
      userId,
      ipAddress,
      success: false,
      failureReason: "Invalid password",
    });

    await auditService.log({
      eventType: AuditEventType.LOGIN_FAILED,
      userId,
      ipAddress,
      userAgent,
    });
  },

  /**
   * Regenerate session
   * @deprecated Use authSessionService.regenerateSession instead
   */
  async regenerateSession(req: Request): Promise<void> {
    return authSessionService.regenerateSession(req);
  },

  /**
   * Logout user
   * @deprecated Use authSessionService.logout instead
   */
  async logout(req: Request): Promise<void> {
    return authSessionService.logout(req);
  },

  /**
   * Get current user profile
   */
  async getCurrentUser(userId: string): Promise<Record<string, unknown>> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    return toPublicUser(user);
  },
};
