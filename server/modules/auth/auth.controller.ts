/**
 * Auth Module Controller
 *
 * Thin controller layer - handles HTTP request/response.
 * All business logic is delegated to the service layer.
 *
 * Migrated from server/routes/auth.ts
 * PERF: Uses standard response helpers (improves API consistency)
 *
 * @module modules/auth/auth.controller
 */

import { Request, Response, NextFunction } from "express";
import { authService } from "./auth.service";
import { authPasswordResetService } from "./auth.password-reset.service";
import {
  loginSchema,
  registerSchema,
  mfaLoginVerifySchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./auth.validation";
import { success, created } from "../../core/http";
import { ValidationError, UnauthorizedError } from "../../core/errors";

/**
 * Auth Controller
 *
 * Each method:
 * 1. Validates input (using Zod)
 * 2. Calls service method
 * 3. Returns standardized response
 */
export const authController = {
  /**
   * POST /auth/register
   */
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const validation = registerSchema.safeParse(req.body);
      if (!validation.success) {
        throw new ValidationError("Invalid input", validation.error.errors);
      }

      const result = await authService.register(validation.data, req);
      return created(res, result);
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /auth/login
   */
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const validation = loginSchema.safeParse(req.body);
      if (!validation.success) {
        throw new ValidationError("Invalid input", validation.error.errors);
      }

      const result = await authService.login(validation.data, req);
      return success(res, result);
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /auth/mfa/verify
   *
   * Verifies MFA during login using pending session state.
   */
  async verifyMfa(req: Request, res: Response, next: NextFunction) {
    try {
      const validation = mfaLoginVerifySchema.safeParse(req.body);
      if (!validation.success) {
        throw new ValidationError("Invalid input", validation.error.errors);
      }

      const result = await authService.verifyMfaLogin(validation.data, req);
      return success(res, result);
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /auth/mfa/resend
   *
   * Resends MFA code to the user in pending session.
   */
  async resendMfa(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.resendMfaCode(req);
      return success(res, result);
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /auth/verify-email
   */
  async verifyEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const validation = verifyEmailSchema.safeParse(req.body);
      if (!validation.success) {
        throw new ValidationError("Invalid input", validation.error.errors);
      }

      await authService.verifyEmail(validation.data.token);
      return success(res, null, 200, { message: "Email verified successfully" });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /auth/resend-verification
   */
  async resendVerification(req: Request, res: Response, next: NextFunction) {
    try {
      const validation = resendVerificationSchema.safeParse(req.body);
      if (!validation.success) {
        throw new ValidationError("Invalid input", validation.error.errors);
      }

      await authService.resendVerification(validation.data.email);
      return success(res, null, 200, { message: "Verification email sent" });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /auth/forgot-password
   *
   * SECURITY: ALWAYS returns the same generic 200 response, whether or not
   * the email is registered (enumeration safety).
   */
  async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const validation = forgotPasswordSchema.safeParse(req.body);
      if (!validation.success) {
        throw new ValidationError("Invalid input", validation.error.errors);
      }

      await authPasswordResetService.requestPasswordReset(
        validation.data.email,
        req,
      );
      return success(res, null, 200, {
        message: "If that email is registered, we sent a password reset link.",
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /auth/reset-password
   */
  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const validation = resetPasswordSchema.safeParse(req.body);
      if (!validation.success) {
        throw new ValidationError("Invalid input", validation.error.errors);
      }

      await authPasswordResetService.resetPassword(
        validation.data.token,
        validation.data.newPassword,
        req,
      );
      return success(res, null, 200, {
        message: "Password reset successfully. Please sign in.",
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /auth/logout
   */
  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      await authService.logout(req);
      return success(res, null, 200, { message: "Logged out successfully" });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /auth/me
   */
  async getCurrentUser(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId;
      if (!userId) {
        throw new UnauthorizedError("Not authenticated");
      }
      const user = await authService.getCurrentUser(userId);
      return success(res, { user });
    } catch (error) {
      next(error);
    }
  },
};
