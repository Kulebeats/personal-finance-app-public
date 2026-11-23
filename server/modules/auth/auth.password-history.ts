import { db } from "../../db";
import { passwordHistory, type User } from "@shared/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { verifyPassword } from "../../auth";
import { ValidationError } from "../../core/errors";
import type { TransactionType } from "../../utils/withTransaction";

const PASSWORD_HISTORY_LIMIT = 5;

/** Identity mutations supply their user-locked transaction; errors propagate. */
export async function wasPasswordUsedRecently(userId: string, newPassword: string, executor: TransactionType): Promise<boolean> {
  const recent = await executor.select({ passwordHash: passwordHistory.passwordHash }).from(passwordHistory)
    .where(eq(passwordHistory.userId, userId)).orderBy(desc(passwordHistory.createdAt), desc(passwordHistory.id)).limit(PASSWORD_HISTORY_LIMIT);
  for (const record of recent) if (await verifyPassword(newPassword, record.passwordHash)) return true;
  return false;
}

/** Check the current credential and history while the caller holds the user lock. */
export async function assertPasswordNotReused(tx: TransactionType, user: User, newPassword: string): Promise<void> {
  if (newPassword.toLowerCase() === user.email.toLowerCase() ||
      await verifyPassword(newPassword, user.passwordHash) || await wasPasswordUsedRecently(user.id, newPassword, tx)) {
    throw new ValidationError("You cannot reuse recent passwords. Please choose a different one.");
  }
}

/** Record and prune in the same transaction as rotation and revocation. */
export async function recordPasswordInHistory(userId: string, oldPasswordHash: string, executor: TransactionType): Promise<void> {
  await executor.insert(passwordHistory).values({ userId, passwordHash: oldPasswordHash });
  const entries = await executor.select({ id: passwordHistory.id }).from(passwordHistory)
    .where(eq(passwordHistory.userId, userId)).orderBy(desc(passwordHistory.createdAt), desc(passwordHistory.id));
  const obsolete = entries.slice(PASSWORD_HISTORY_LIMIT).map((entry) => entry.id);
  if (obsolete.length) await executor.delete(passwordHistory).where(inArray(passwordHistory.id, obsolete));
}

export async function getPasswordHistoryCount(userId: string): Promise<number> {
  return (await db.select({ id: passwordHistory.id }).from(passwordHistory).where(eq(passwordHistory.userId, userId))).length;
}
