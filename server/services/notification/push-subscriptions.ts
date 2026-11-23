/**
 * Push subscription rows, bound to the session that registered them.
 *
 * A browser's push subscription is that browser's signed-in session, not the
 * user's account. Each row records `sessionIdentityHash(sid)` (the hash
 * `session_revocations` uses), so:
 * - signing out or revoking that session removes the row;
 * - revoke-all and a self-initiated password change keep only the row of the
 *   session that stays signed in;
 * - a password reset, the last household membership ending and erasure remove
 *   every row;
 * - a send goes only to a row that still exists for that user, and whose
 *   session is live, unexpired and unrevoked.
 *
 * Rows saved before 0057 have no session (NULL). No push goes to them: the
 * first send removes such a row, and the settings page re-registers the
 * browser, which binds it to the current session.
 *
 * @module services/notification/push-subscriptions
 */

import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { sessionRevocations, userPushSubscriptions } from "@shared/schema";
import { db } from "../../db";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { sessionIdentityHash } from "../session-identity";

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface StoredPushSubscription {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

/**
 * Save this browser's subscription for the session that sends it. An endpoint
 * another user registered is that user's row, so it is deleted (never handed
 * over) and a new row is created for this user.
 */
export async function saveSessionSubscription(
  userId: string,
  sessionId: string,
  subscription: StoredPushSubscription,
): Promise<void> {
  const sessionIdHash = sessionIdentityHash(sessionId);
  await withTransaction(async (tx) => {
    const [existing] = await tx.select({ id: userPushSubscriptions.id, userId: userPushSubscriptions.userId })
      .from(userPushSubscriptions)
      .where(eq(userPushSubscriptions.endpoint, subscription.endpoint))
      .for("update");
    if (existing && existing.userId === userId) {
      await tx.update(userPushSubscriptions)
        .set({ keys: subscription.keys, sessionIdHash, updatedAt: new Date() })
        .where(eq(userPushSubscriptions.id, existing.id));
      return;
    }
    if (existing) await tx.delete(userPushSubscriptions).where(eq(userPushSubscriptions.id, existing.id));
    await tx.insert(userPushSubscriptions).values({
      userId, endpoint: subscription.endpoint, keys: subscription.keys, sessionIdHash,
      createdAt: new Date(), updatedAt: new Date(),
    });
  });
}

/** Remove the subscriptions registered from this session (sign-out, a revoked device). */
export async function deleteSessionSubscriptions(tx: TransactionType, userId: string, sessionId: string): Promise<void> {
  await tx.delete(userPushSubscriptions).where(and(
    eq(userPushSubscriptions.userId, userId),
    eq(userPushSubscriptions.sessionIdHash, sessionIdentityHash(sessionId)),
  ));
}

/**
 * Remove all of the user's subscriptions, or with `keepSessionId` all but the
 * rows of that session. Rows without a session are always removed.
 */
export async function deleteUserSubscriptions(tx: TransactionType, userId: string, keepSessionId?: string): Promise<void> {
  const others = keepSessionId === undefined ? undefined : or(
    isNull(userPushSubscriptions.sessionIdHash),
    ne(userPushSubscriptions.sessionIdHash, sessionIdentityHash(keepSessionId)),
  );
  await tx.delete(userPushSubscriptions).where(and(eq(userPushSubscriptions.userId, userId), others));
}

/**
 * Whether a push to this subscription may go out now: the row still belongs
 * to the user with these keys, and its session is recorded and live. A row
 * with no recorded session, or whose session has ended, is removed.
 */
export async function isDispatchableSubscription(userId: string, subscription: StoredPushSubscription): Promise<boolean> {
  const [row] = await db.select({ id: userPushSubscriptions.id, sessionIdHash: userPushSubscriptions.sessionIdHash })
    .from(userPushSubscriptions)
    .where(and(
      eq(userPushSubscriptions.userId, userId),
      eq(userPushSubscriptions.endpoint, subscription.endpoint),
      sql`${userPushSubscriptions.keys}->>'p256dh' = ${subscription.keys.p256dh}`,
      sql`${userPushSubscriptions.keys}->>'auth' = ${subscription.keys.auth}`,
    ));
  if (!row) return false;
  if (row.sessionIdHash !== null && await isLiveSession(userId, row.sessionIdHash)) return true;
  await db.delete(userPushSubscriptions).where(eq(userPushSubscriptions.id, row.id));
  return false;
}

/** A session of this user, by its identity hash, that is unexpired and not revoked. */
async function isLiveSession(userId: string, sessionIdHash: string): Promise<boolean> {
  const result = await db.execute<{ live: boolean }>(sql`
    SELECT exists (
      SELECT 1 FROM "session"
      WHERE sess->>'userId' = ${userId} AND expire >= now()
        AND encode(sha256(convert_to(sid, 'UTF8')), 'hex') = ${sessionIdHash}
    ) AND NOT exists (
      SELECT 1 FROM ${sessionRevocations} WHERE ${sessionRevocations.sessionIdHash} = ${sessionIdHash}
    ) AS live`);
  return result.rows[0]?.live === true;
}
