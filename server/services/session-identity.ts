import { createHash } from "node:crypto";
import { db } from "../db";
import { sessionRevocations, userSessions, users, type User } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { UnauthorizedError } from "../core/errors";
import { withTransaction, type TransactionType } from "../utils/withTransaction";

export const sessionIdentityHash = (sid: string) => createHash("sha256").update(sid).digest("hex");

/** A credential snapshot is never upgraded to a newer security generation. */
export async function assertCurrentCredential(user: User): Promise<void> {
  const [current] = await db.select({ generation: users.securityGeneration, erasedAt: users.erasedAt, hash: users.passwordHash })
    .from(users).where(eq(users.id, user.id));
  if (!current || current.erasedAt || current.generation !== (user.securityGeneration ?? 0) || current.hash !== user.passwordHash) {
    throw new UnauthorizedError("Authentication changed; sign in again");
  }
}

/** Lock and recheck the credential snapshot that actually passed verification. */
export async function lockCredentialSnapshot(tx: TransactionType, snapshot: User): Promise<User> {
  const [current] = await tx.select().from(users).where(eq(users.id, snapshot.id)).for("update");
  if (!current || current.erasedAt || current.passwordHash.startsWith("!erased!") ||
      current.email !== snapshot.email || current.passwordHash !== snapshot.passwordHash || current.securityGeneration !== (snapshot.securityGeneration ?? 0)) {
    throw new UnauthorizedError("Authentication changed; sign in again");
  }
  return current;
}

/** Recheck an authenticated/pending mutation before any identity write. */
export async function lockCurrentSessionCredential(tx: TransactionType, snapshot: User, sid: string, sessionGeneration: number | undefined, state: "authenticated" | "pendingMfa" = "authenticated"): Promise<User> {
  const current = await lockCredentialSnapshot(tx, snapshot);
  if (current.securityGeneration !== (sessionGeneration ?? 0)) throw new UnauthorizedError("Authentication changed; sign in again");
  const [revoked] = await tx.select().from(sessionRevocations).where(eq(sessionRevocations.sessionIdHash, sessionIdentityHash(sid)));
  const userKey = state === "pendingMfa" ? "mfaPendingUserId" : "userId";
  const generationKey = state === "pendingMfa" ? "mfaPendingSecurityGeneration" : "securityGeneration";
  const persisted = await tx.execute(sql`SELECT 1 FROM "session" WHERE sid = ${sid} AND expire >= now()
    AND sess->>${userKey} = ${current.id} AND COALESCE(sess->>${generationKey}, '0') = ${String(current.securityGeneration)}`);
  if (revoked || persisted.rows.length === 0) throw new UnauthorizedError("Authentication changed; sign in again");
  return current;
}

/** Serialize tracking creation with resets/revocations; no ghost device row. */
export async function registerSessionIdentity(user: User, data: typeof userSessions.$inferInsert): Promise<void> {
  await withTransaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, user.id)).for("update");
    if (!current || current.erasedAt || current.securityGeneration !== (user.securityGeneration ?? 0) || current.passwordHash !== user.passwordHash) {
      throw new UnauthorizedError("Authentication changed; sign in again");
    }
    const [revoked] = await tx.select().from(sessionRevocations).where(eq(sessionRevocations.sessionIdHash, sessionIdentityHash(data.sessionToken)));
    if (revoked) throw new UnauthorizedError("Authentication changed; sign in again");
    await tx.insert(userSessions).values(data).onConflictDoUpdate({ target: userSessions.sessionToken, set: data });
  });
}

export async function revokeLoginSession(userId: string, token: string): Promise<void> {
  const { revokeSessionByToken } = await import("./session-revocation");
  await withTransaction((tx) => revokeSessionByToken(tx, userId, token));
}
