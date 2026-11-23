/**
 * MFA utilities.
 *
 * @module routes/security.mfa.utils
 */

import crypto from "crypto";

export const MFA_BACKUP_CODE_EXPIRY_DAYS = 90;

/** How long an emailed one-time code stays usable. */
export const MFA_CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Generate a 6-digit numeric OTP with a cryptographically secure RNG.
 */
export function generateMfaCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
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
