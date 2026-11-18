/**
 * MFA utilities.
 *
 * @module routes/security.mfa.utils
 */

import crypto from "crypto";

export const MFA_BACKUP_CODE_EXPIRY_DAYS = 90;

/**
 * Generate a 6-digit numeric OTP.
 */
export function generateMfaCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Generate backup codes (8 codes, 8 chars each).
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    codes.push(crypto.randomBytes(4).toString("hex").toUpperCase());
  }
  return codes;
}
