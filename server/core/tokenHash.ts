/**
 * Token Hashing
 *
 * Shared helper for hashing single-use secret tokens (password reset,
 * email verification/change) before they are persisted. The raw token
 * exists only transiently (in memory, in the outgoing email) and is never
 * written to the database - only its SHA-256 hash is stored. A DB read
 * (backup leak, log spill, insider access) must not yield a usable token.
 *
 * @module core/tokenHash
 */

import { createHash } from "crypto";

/** SHA-256 hash of a raw token, hex-encoded. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
