/**
 * Seed a push subscription the way production registers one: a live session
 * for the user, written through the real session store, and the subscription
 * saved for that session (`session_id_hash` = the session's identity hash).
 * A send skips and deletes a subscription with no live session, so a fixture
 * that inserts a bare row gets no push.
 */
import { randomBytes } from "node:crypto";
import session, { type SessionData } from "express-session";
import { pool } from "../db";
import { sessionStore } from "../config/session-store";
import { saveSessionSubscription, type StoredPushSubscription } from "../services/notification/push-subscriptions";

const SESSION_LIFETIME_MS = 60 * 60 * 1000;

function storeSession(sid: string, data: SessionData): Promise<void> {
  return new Promise((resolve, reject) => {
    sessionStore.set(sid, data, (error?: unknown) => (error ? reject(error) : resolve()));
  });
}

/** Create a live session for this user and register the subscription from it. Returns the session id. */
export async function seedLivePushSubscription(userId: string, subscription: StoredPushSubscription): Promise<string> {
  const sid = randomBytes(24).toString("base64url");
  const cookie = Object.assign(new session.Cookie(), { maxAge: SESSION_LIFETIME_MS });
  const data: SessionData = { cookie, userId };
  await storeSession(sid, data);
  const stored = await pool.query('SELECT 1 FROM "session" WHERE sid = $1 AND expire >= now()', [sid]);
  if (stored.rows.length !== 1) throw new Error("seedLivePushSubscription: the session store refused the session");
  await saveSessionSubscription(userId, sid, subscription);
  return sid;
}

/** Remove the sessions a fixture created for these users. */
export async function deleteSeededSessions(userIds: string[]): Promise<void> {
  if (userIds.length) await pool.query(`DELETE FROM "session" WHERE sess->>'userId' = ANY($1::text[])`, [userIds]);
}
