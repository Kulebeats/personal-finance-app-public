/**
 * Auth Module Validation Schemas
 *
 * Zod schemas for validating auth-related requests.
 */

import { z } from "zod";

/**
 * Login validation schema
 *
 * VAL-004: Input length limits for DoS prevention
 * - Email: max 254 chars (RFC 5321 limit)
 * - Password: max 128 chars (bcrypt has O(n) complexity)
 */
export const loginSchema = z.object({
  email: z.string().email("Invalid email address").max(254, "Email too long"),
  password: z
    .string()
    .min(1, "Password is required")
    .max(128, "Password too long"),
  rememberMe: z.boolean().optional().default(false),
});

/**
 * Registration-grade password policy.
 *
 * Single source of truth shared by registration and password reset so the
 * two flows can never drift apart (R1).
 */
export const registrationPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password too long")
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    "Password must contain at least one lowercase letter, one uppercase letter, and one number",
  );

/**
 * Registration validation schema
 *
 * VAL-002: Password cannot be the same as email
 * VAL-004: Input length limits for DoS prevention
 */
export const registerSchema = z
  .object({
    email: z.string().email("Invalid email address").max(254, "Email too long"),
    username: z
      .string()
      .min(3, "Username must be at least 3 characters")
      .max(50, "Username must be at most 50 characters")
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        "Username can only contain letters, numbers, underscores, and hyphens",
      ),
    password: registrationPasswordSchema,
    fullName: z.string().min(1).max(100).optional(),
  })
  .refine((data) => data.password.toLowerCase() !== data.email.toLowerCase(), {
    message: "Password cannot be the same as your email",
    path: ["password"],
  });

/**
 * Forgot-password request schema (R1)
 */
export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address").max(254, "Email too long"),
});

/**
 * Reset-password schema (R1)
 *
 * Reuses the registration password policy - do not duplicate it.
 * Token length is bounded for DoS prevention (raw tokens are 64 hex chars).
 */
export const resetPasswordSchema = z.object({
  token: z
    .string()
    .min(1, "Token is required")
    .max(256, "Token is too long"),
  newPassword: registrationPasswordSchema,
});

/**
 * MFA code verification schema
 */
export const mfaVerifySchema = z.object({
  email: z.string().email("Invalid email address"),
  code: z.string().length(6, "Code must be exactly 6 digits"),
});

/**
 * MFA login verification schema (pending-session based)
 *
 * Used by POST /api/auth/mfa/verify. The pending MFA user is
 * identified via session state, so only the code is required.
 */
export const mfaLoginVerifySchema = z.object({
  code: z
    .string()
    .min(6, "Code must be at least 6 characters")
    .max(64, "Code is too long"),
});

/**
 * Backup code verification schema
 */
export const backupCodeSchema = z.object({
  email: z.string().email("Invalid email address"),
  backupCode: z.string().min(8, "Invalid backup code"),
});

/**
 * Password change schema
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters")
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        "Password must contain at least one lowercase letter, one uppercase letter, and one number",
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/**
 * Verify email schema
 */
export const verifyEmailSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

/**
 * Resend verification email schema
 */
export const resendVerificationSchema = z.object({
  email: z.string().email("Invalid email address"),
});

// Type exports
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;
export type MfaLoginVerifyInput = z.infer<typeof mfaLoginVerifySchema>;
export type BackupCodeInput = z.infer<typeof backupCodeSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
