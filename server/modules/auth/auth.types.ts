/**
 * Auth Module Types
 *
 * Module-specific types for the auth domain.
 */

import { z } from "zod";
import type { User } from "@shared/schema";

/**
 * The user fields auth responses (register, login, MFA verify, GET /auth/me)
 * may expose. Everything else on the row - token hashes, MFA codes and backup
 * codes, lockout counters, NRC, income - stays server-side.
 */
export type PublicUser = Pick<
  User,
  | "id"
  | "username"
  | "email"
  | "emailVerified"
  | "fullName"
  | "firstName"
  | "lastName"
  | "displayName"
  | "profilePictureUrl"
  | "timezone"
  | "mfaEnabled"
  | "mfaMethod"
  | "createdAt"
>;

/** Allow-list mapper: copies only the public fields, never spreads the row. */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerified,
    fullName: user.fullName,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    profilePictureUrl: user.profilePictureUrl,
    timezone: user.timezone,
    mfaEnabled: user.mfaEnabled,
    mfaMethod: user.mfaMethod,
    createdAt: user.createdAt,
  };
}

/**
 * Login request payload
 */
export interface LoginRequest {
  email: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * Registration request payload
 */
export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  fullName?: string;
}

/**
 * User session data
 */
export interface AuthSession {
  userId: string;
  email: string;
  mfaVerified?: boolean;
  stepUpVerifiedAt?: Date;
}

/**
 * Login response
 */
export interface LoginResponse {
  user: {
    id: string;
    email: string;
    username: string;
    fullName?: string;
    mfaEnabled: boolean;
  };
  requiresMfa: boolean;
}

/**
 * MFA verification request
 */
export interface MfaVerifyRequest {
  email: string;
  code: string;
}

/**
 * Auth event types for audit logging
 */
export type AuthEventType =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "REGISTER"
  | "PASSWORD_CHANGED"
  | "MFA_ENABLED"
  | "MFA_DISABLED"
  | "MFA_VERIFIED"
  | "MFA_FAILED"
  | "SESSION_REGENERATED"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_UNLOCKED";

/**
 * Device information parsed from user agent
 */
export interface DeviceInfo {
  deviceName: string;
  deviceType: "desktop" | "mobile" | "tablet";
  browser: string;
  os: string;
}

/**
 * Session device info from database
 */
export interface SessionDeviceInfo {
  deviceName?: string | null;
  deviceType?: string | null;
  browser?: string | null;
  os?: string | null;
}
