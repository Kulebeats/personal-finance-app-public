/**
 * Session Revocation
 *
 * Shared helper for killing a user's live sessions after a security-relevant
 * password event (reset or authenticated change). Revokes BOTH stores so a
 * revoked cookie is actually dead:
 *   - the connect-pg-simple `session` table (makes the cookie stop working)
 *   - the `userSessions` tracking table (keeps the "active devices" list
 *     consistent with reality)
 *
 * Extracted from auth.password-reset.service.ts (R1) so the authenticated
 * password-change path (settings.controller.ts) can reuse identical,
 * fail-closed revocation logic instead of duplicating it.
 *
 * @module services/session-revocation
 */

import { eq, and, ne, sql } from "drizzle-orm";
import { sessionRevocations, users, userSessions } from "@shared/schema";
import type { TransactionType } from "../utils/withTransaction";
import { sessionIdentityHash } from "./session-identity";
import { deleteSessionSubscriptions, deleteUserSubscriptions } from "./notification/push-subscriptions";

export interface RevokeUserSessionsOptions {
  /**
   * A connect-pg-simple session id (req.sessionID) / userSessions.sessionToken
   * to KEEP alive. Used on an authenticated, self-initiated password change so
   * the device the user is currently on stays logged in. Omit to revoke every
   * session (used by the unauthenticated password-reset flow).
   */
  exceptSessionId?: string;
}

/**
 * Revoke a user's sessions inside an existing transaction.
 *
 * MUST be called inside `withTransaction` alongside the password rotation so
 * the whole operation is fail-closed: if revocation fails, the password
 * change rolls back rather than leaving live sessions on a rotated password.
 */
export async function revokeUserSessions(
  tx: TransactionType,
  userId: string,
  options: RevokeUserSessionsOptions = {},
): Promise<void> {
  const { exceptSessionId } = options;
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  // Preserve the current device by upgrading its stored payload atomically.
  const [updated] = await tx.update(users).set({ securityGeneration: sql`${users.securityGeneration} + 1` })
    .where(eq(users.id, userId)).returning({ generation: users.securityGeneration });
  if (!updated) return;

  if (exceptSessionId) {
    await tx.execute(sql`UPDATE "session" SET sess = jsonb_set(sess::jsonb, '{securityGeneration}', to_jsonb(${updated.generation}::integer))
      WHERE sid = ${exceptSessionId} AND sess->>'userId' = ${userId}`);
    await tx.execute(
      sql`DELETE FROM "session" WHERE (sess->>'userId' = ${userId} OR sess->>'mfaPendingUserId' = ${userId}) AND sid != ${exceptSessionId}`,
    );
    await tx
      .delete(userSessions)
      .where(
        and(
          eq(userSessions.userId, userId),
          ne(userSessions.sessionToken, exceptSessionId),
        ),
      );
    // Only the device that stays signed in keeps its push subscription.
    await deleteUserSubscriptions(tx, userId, exceptSessionId);
    return;
  }

  await tx.execute(
    sql`DELETE FROM "session" WHERE sess->>'userId' = ${userId} OR sess->>'mfaPendingUserId' = ${userId}`,
  );
  // MUTANT (S5 RED run, reverted next commit): tracking rows survive erasure.
  void userSessions;
  await deleteUserSubscriptions(tx, userId);
}

/** Selected-device revocation never changes the user's global generation. */
export async function revokeSelectedSession(tx: TransactionType, userId: string, trackingId: string): Promise<boolean> {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  const [target] = await tx.select({ token: userSessions.sessionToken }).from(userSessions)
    .where(and(eq(userSessions.id, trackingId), eq(userSessions.userId, userId))).for("update");
  if (!target) return false;
  await revokeSessionByToken(tx, userId, target.token);
  return true;
}

export async function revokeSessionByToken(tx: TransactionType, userId: string, token: string): Promise<void> {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  await tx.insert(sessionRevocations).values({ userId, sessionIdHash: sessionIdentityHash(token) }).onConflictDoNothing();
  await tx.execute(sql`DELETE FROM "session" WHERE sid = ${token} AND (sess->>'userId' = ${userId} OR sess->>'mfaPendingUserId' = ${userId})`);
  await tx.delete(userSessions).where(and(eq(userSessions.userId, userId), eq(userSessions.sessionToken, token)));
  // Sign-out and a revoked device stop pushes to that browser.
  await deleteSessionSubscriptions(tx, userId, token);
}
