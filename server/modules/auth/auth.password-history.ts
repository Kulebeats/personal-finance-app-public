/**
 * Password History Service (P3-47)
 *
 * Manages password history to prevent reuse of recent passwords.
 * Default policy: Cannot reuse last 5 passwords.
 *
 * @module modules/auth/auth.password-history
 */

import { db } from "../../db";
import { passwordHistory } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { verifyPassword } from "../../auth";
import { logger } from "../../utils/logger";

/**
 * Number of previous passwords to check against.
 * User cannot reuse any of their last N passwords.
 */
const PASSWORD_HISTORY_LIMIT = 5;

/**
 * Check if a new password was used recently
 *
 * Compares the plain-text password against the last N password hashes.
 * Returns true if the password was used recently (should be rejected).
 */
export async function wasPasswordUsedRecently(
  userId: string,
  newPassword: string
): Promise<boolean> {
  try {
    // Get the last N password hashes for this user
    const recentPasswords = await db
      .select({ passwordHash: passwordHistory.passwordHash })
      .from(passwordHistory)
      .where(eq(passwordHistory.userId, userId))
      .orderBy(desc(passwordHistory.createdAt))
      .limit(PASSWORD_HISTORY_LIMIT);

    if (recentPasswords.length === 0) {
      return false;
    }

    // Check the new password against each historical hash
    for (const record of recentPasswords) {
      const matches = await verifyPassword(newPassword, record.passwordHash);
      if (matches) {
        logger.info("Password reuse attempt detected", {
          userId: userId.substring(0, 8) + "...",
        });
        return true;
      }
    }

    return false;
  } catch (error) {
    logger.error(
      "Error checking password history",
      { userId: userId.substring(0, 8) + "..." },
      error as Error
    );
    // Fail open - don't block password change on error
    return false;
  }
}

/**
 * Record a password in history
 *
 * Called after a successful password change to store the old hash.
 * Also prunes old entries beyond the limit.
 */
export async function recordPasswordInHistory(
  userId: string,
  oldPasswordHash: string
): Promise<void> {
  try {
    // Insert the old password hash
    await db.insert(passwordHistory).values({
      userId,
      passwordHash: oldPasswordHash,
    });

    // Prune old entries beyond the limit
    // Get all entries for the user ordered by date
    const allEntries = await db
      .select({ id: passwordHistory.id })
      .from(passwordHistory)
      .where(eq(passwordHistory.userId, userId))
      .orderBy(desc(passwordHistory.createdAt));

    // Delete entries beyond the limit
    if (allEntries.length > PASSWORD_HISTORY_LIMIT) {
      const idsToDelete = allEntries
        .slice(PASSWORD_HISTORY_LIMIT)
        .map((e) => e.id);

      for (const id of idsToDelete) {
        await db.delete(passwordHistory).where(eq(passwordHistory.id, id));
      }

      logger.debug("Pruned old password history entries", {
        userId: userId.substring(0, 8) + "...",
        deleted: idsToDelete.length,
      });
    }
  } catch (error) {
    logger.error(
      "Error recording password history",
      { userId: userId.substring(0, 8) + "..." },
      error as Error
    );
    // Don't throw - password change should still succeed
  }
}

/**
 * Get password history count for a user
 *
 * Utility function for testing and admin purposes.
 */
export async function getPasswordHistoryCount(userId: string): Promise<number> {
  const result = await db
    .select({ id: passwordHistory.id })
    .from(passwordHistory)
    .where(eq(passwordHistory.userId, userId));

  return result.length;
}
