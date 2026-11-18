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
import { userSessions } from "@shared/schema";
import type { TransactionType } from "../utils/withTransaction";

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

  if (exceptSessionId) {
    await tx.execute(
      sql`DELETE FROM "session" WHERE sess->>'userId' = ${userId} AND sid != ${exceptSessionId}`,
    );
    await tx
      .delete(userSessions)
      .where(
        and(
          eq(userSessions.userId, userId),
          ne(userSessions.sessionToken, exceptSessionId),
        ),
      );
    return;
  }

  await tx.execute(
    sql`DELETE FROM "session" WHERE sess->>'userId' = ${userId}`,
  );
  await tx.delete(userSessions).where(eq(userSessions.userId, userId));
}
