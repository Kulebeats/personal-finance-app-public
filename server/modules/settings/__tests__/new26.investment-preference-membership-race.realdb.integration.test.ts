/**
 * NEW-26 (#40 follow-up): PUT /api/investments/notifications/preferences picks
 * the household before its transaction, so the save must re-read membership
 * under the lock that membership changes take, never trust the earlier pick.
 *
 * - Removed while waiting: removal holds the household row FOR UPDATE. The save
 *   waits behind it on the household, then finds the member gone. It must
 *   refuse with the typed 409 and write neither the preference nor an audit row
 *   into a household the user no longer belongs to.
 * - Joined while waiting: a join (invitations.accept.ts) takes the household row
 *   and then the per-user membership lock (householdMembershipLock.ts). A
 *   household-free save must hold that lock from its membership read to its
 *   commit, so a join cannot commit in between and leave an unaudited write by
 *   a member.
 *
 * Real HTTP against real Postgres; each interleaving is forced with held locks
 * and checked through pg_blocking_pids.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdMembers, households, userNotificationPreferences, users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

const password = "SyntheticPreferenceRace123!";
const householdId = randomUUID();
const ownerId = randomUUID();
const memberId = randomUUID();
const loneId = randomUUID();
const type = "price_alert";
const MEMBERSHIP_LOCK_NAMESPACE = 0x686f7573; // householdMembershipLock.ts
const POLL_MS = 25;
const WAIT_MS = 10_000;
const JOIN_SETTLE_MS = 1_500;
let app: Awaited<ReturnType<typeof getTestApp>>;
const cookies = new Map<string, string>();

const put = (userId: string) => request(app).put("/api/investments/notifications/preferences")
  .set("Cookie", cookies.get(userId)!).send({ notificationType: type, emailEnabled: false });
const preferenceRows = (userId: string) => db.select().from(userNotificationPreferences)
  .where(and(eq(userNotificationPreferences.userId, userId), eq(userNotificationPreferences.notificationType, type)));
const preferenceAudits = (userId: string) => db.select().from(auditLogs)
  .where(and(eq(auditLogs.userId, userId), eq(auditLogs.entityType, "user")));

async function begin(): Promise<{ client: PoolClient; pid: number }> {
  const client = await pool.connect();
  await client.query("BEGIN");
  const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  return { client, pid: rows[0].pid };
}

async function end(client: PoolClient, verb: "COMMIT" | "ROLLBACK"): Promise<void> {
  try { await client.query(verb); } finally { client.release(); }
}

/** Some backend is waiting on `holderPid`. */
async function waitForWaiterOn(holderPid: number): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [holderPid]);
    if (rows[0].n > 0) return;
    if (Date.now() > deadline) throw new Error(`nothing queued behind backend ${holderPid}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function isBlocked(pid: number): Promise<boolean> {
  const { rows } = await pool.query<{ n: number }>("SELECT cardinality(pg_blocking_pids($1))::int AS n", [pid]);
  return rows[0].n > 0;
}

async function signIn(id: string): Promise<void> {
  const email = `pref-race-${id}@example.test`;
  await db.insert(users).values({ id, email, username: `pref-race-${id}`, passwordHash: await hashPassword(password), emailVerified: true });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  cookies.set(id, (login.headers["set-cookie"] as unknown as string[]).join("; "));
}

describe("NEW-26 investment preference save re-reads membership under the membership locks", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic preference race", currency: "ZMW" });
    for (const id of [ownerId, memberId, loneId]) await signIn(id);
    await db.insert(householdMembers).values({ householdId, userId: ownerId, role: "owner" });
  }, 60000);

  beforeEach(async () => {
    await db.delete(userNotificationPreferences).where(inArray(userNotificationPreferences.userId, [memberId, loneId]));
    await db.delete(auditLogs).where(inArray(auditLogs.userId, [memberId, loneId]));
    await db.delete(householdMembers).where(inArray(householdMembers.userId, [memberId, loneId]));
  });

  afterAll(async () => {
    const ids = [ownerId, memberId, loneId];
    for (const id of ids) await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [id]);
    await db.delete(auditLogs).where(inArray(auditLogs.userId, ids));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(users).where(inArray(users.id, ids));
  });

  it("refuses with 409 and writes nothing when the member is removed while the save waits", async () => {
    await db.insert(householdMembers).values({ householdId, userId: memberId, role: "member" });
    // Removal's parent lock, held while the save is in flight.
    const removal = await begin();
    await removal.client.query("SELECT id FROM households WHERE id = $1 FOR UPDATE", [householdId]);
    const pending = put(memberId).then((res) => res);
    try {
      await waitForWaiterOn(removal.pid);
      await removal.client.query("DELETE FROM household_members WHERE household_id = $1 AND user_id = $2", [householdId, memberId]);
    } finally {
      await end(removal.client, "COMMIT");
    }
    const response = await pending;

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({ code: "SESSION_CONTEXT_CHANGED" });
    expect(await preferenceRows(memberId)).toEqual([]);
    expect(await preferenceAudits(memberId)).toEqual([]);
  });

  it("keeps a join from committing between a household-free save's membership read and its commit", async () => {
    // Hold the user row so the save is provably in flight inside its transaction.
    const userGate = await begin();
    await userGate.client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [loneId]);
    const pending = put(loneId).then((res) => res);
    let joinedWhileSaving = false;
    let join: Promise<void> | undefined;
    try {
      await waitForWaiterOn(userGate.pid);
      // The join, in invitations.accept.ts order: household row, then the per-user membership lock.
      const joiner = await begin();
      join = (async () => {
        try {
          await joiner.client.query("SELECT id FROM households WHERE id = $1 FOR UPDATE", [householdId]);
          await joiner.client.query("SELECT pg_advisory_xact_lock($1::int4, hashtext($2))", [MEMBERSHIP_LOCK_NAMESPACE, loneId]);
          await joiner.client.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'member')", [householdId, loneId]);
          await end(joiner.client, "COMMIT");
        } catch (error) {
          await end(joiner.client, "ROLLBACK").catch(() => undefined);
          throw error;
        }
      })();
      const finished = join.then(() => true);
      const deadline = Date.now() + JOIN_SETTLE_MS;
      while (Date.now() < deadline) {
        if (await Promise.race([finished, new Promise<false>((resolve) => setTimeout(() => resolve(false), POLL_MS))])) {
          joinedWhileSaving = true;
          break;
        }
        if (await isBlocked(joiner.pid)) break;
      }
    } finally {
      await end(userGate.client, "ROLLBACK");
    }
    const response = await pending;
    await join;

    expect(joinedWhileSaving).toBe(false);
    // The save was ordered before the join: a household-free write, with no audit row, as before.
    expect(response.status).toBe(200);
    expect(await preferenceRows(loneId)).toHaveLength(1);
    expect(await preferenceAudits(loneId)).toEqual([]);
    const [membership] = await db.select().from(householdMembers).where(eq(householdMembers.userId, loneId));
    expect(membership?.householdId).toBe(householdId);
  });

  it("still saves and audits an unchallenged member's preference in the household", async () => {
    await db.insert(householdMembers).values({ householdId, userId: memberId, role: "member" });
    const response = await put(memberId);
    expect(response.status).toBe(200);
    expect(await preferenceRows(memberId)).toHaveLength(1);
    const audits = await preferenceAudits(memberId);
    expect(audits).toHaveLength(1);
    expect(audits[0].householdId).toBe(householdId);
  });
});
