/**
 * AH-05 (#44 review follow-ups): invitation create and revoke are atomic with
 * their audit rows — REAL DB, REAL HTTP.
 *
 * Before: the create and revoke audit rows were written after the write had
 * committed, so a failed audit left an unaudited invitation (or an unaudited
 * revoke). The expired invitation a re-invite replaces was deleted with no
 * audit row. Revoke ran with no transaction and no lock: it read the row,
 * then deleted it, so an acceptance committing in between was deleted as if
 * it had been revoked. And the revoke log line carried the invitee's full
 * address.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdInvitations, householdMembers, households, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { logger } from "../../../utils/logger";

const DAY_MS = 24 * 60 * 60 * 1000;
const householdId = randomUUID();
const stamp = randomUUID().slice(0, 8);
const password = "SyntheticInviteAtomic123!";
const guest = `atomic-guest-${stamp}@example.test`;
const owner = { id: randomUUID(), email: `atomic-owner-${stamp}@example.test`, cookie: "" };
let app: Awaited<ReturnType<typeof getTestApp>>;

const invite = (email: string) =>
  request(app).post("/api/household/invite").set("Cookie", owner.cookie).send({ email, role: "member" });
const revoke = (inviteId: string) =>
  request(app).delete(`/api/household/invitations/${inviteId}`).set("Cookie", owner.cookie);
const invitationRows = () =>
  db.select().from(householdInvitations).where(eq(householdInvitations.householdId, householdId));
const invitationAudit = (action: "CREATE" | "DELETE") =>
  db.select().from(auditLogs).where(and(
    eq(auditLogs.householdId, householdId),
    eq(auditLogs.entityType, "household_invitation"),
    eq(auditLogs.action, action),
  ));

async function seedInvitation(expiresInMs: number) {
  const [row] = await db.insert(householdInvitations).values({
    householdId, email: guest, role: "member", inviteCode: randomUUID().replace(/-/g, ""),
    invitedBy: owner.id, expiresAt: new Date(Date.now() + expiresInMs),
  }).returning();
  return row;
}

/** Resolves once another backend is waiting on a lock held by `holderPid`. */
async function waitUntilBlockedBy(holderPid: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rowCount } = await pool.query(
      "SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [holderPid]);
    if (rowCount) return;
    if (Date.now() > deadline) throw new Error("The revoke never queued behind the held locks");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("AH-05 invitation writes and their audit rows — real DB", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic atomic invites" });
    await db.insert(users).values({
      id: owner.id, email: owner.email, username: `atomic-${stamp}`,
      passwordHash: await hashPassword(password), emailVerified: true,
    });
    const login = await request(app).post("/api/auth/login").send({ email: owner.email, password }).expect(200);
    owner.cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  beforeEach(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(householdInvitations).where(eq(householdInvitations.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.insert(householdMembers).values({ householdId, userId: owner.id, role: "owner" });
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.userId, owner.id));
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [owner.id]);
    await db.delete(users).where(inArray(users.id, [owner.id]));
  });

  it("writes the create audit in the invitation's transaction and stores nothing when it fails", async () => {
    vi.spyOn(businessAuditService, "logCreate").mockRejectedValueOnce(new Error("synthetic audit outage"));

    const response = await invite(guest);

    expect(response.status).toBe(500);
    expect(await invitationRows()).toHaveLength(0);
  });

  it("audits the expired invitation a re-invite replaces", async () => {
    const expired = await seedInvitation(-DAY_MS);

    await invite(guest).expect(201);

    const deletes = await invitationAudit("DELETE");
    expect(deletes.map((row) => row.entityId)).toEqual([expired.id]);
    expect(deletes[0].userId).toBe(owner.id);
    expect(await invitationAudit("CREATE")).toHaveLength(1);
  });

  it("writes the revoke audit in the revoke's transaction and keeps the invitation when it fails", async () => {
    const pending = await seedInvitation(7 * DAY_MS);
    vi.spyOn(businessAuditService, "logDelete").mockRejectedValueOnce(new Error("synthetic audit outage"));

    const response = await revoke(pending.id);

    expect(response.status).toBe(500);
    expect((await invitationRows()).map((row) => row.id)).toEqual([pending.id]);
  });

  it("refuses to revoke an invitation that an acceptance commits while the revoke waits", async () => {
    const pending = await seedInvitation(7 * DAY_MS);
    // Acceptance locks the household, then the invitation (invitations.accept.ts).
    const holder = await pool.connect();
    let revoking: Promise<Awaited<ReturnType<typeof revoke>>> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query("SET LOCAL lock_timeout = '5s'");
      await holder.query("SELECT id FROM households WHERE id = $1 FOR UPDATE", [householdId]);
      await holder.query("SELECT id FROM household_invitations WHERE id = $1 FOR UPDATE", [pending.id]);
      const { rows: [{ pid }] } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      revoking = Promise.resolve(revoke(pending.id));
      await waitUntilBlockedBy(pid);
      await holder.query("UPDATE household_invitations SET accepted_at = now(), accepted_by = $2 WHERE id = $1",
        [pending.id, owner.id]);
      await holder.query("COMMIT");
    } catch (error) {
      await holder.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      holder.release();
      await revoking?.catch(() => undefined);
    }

    expect((await revoking!).status).toBe(409);
    const [row] = await invitationRows();
    expect(row?.acceptedAt).not.toBeNull();
    expect(await invitationAudit("DELETE")).toHaveLength(0);
  });

  it("never logs the invitee's full address when revoking", async () => {
    const pending = await seedInvitation(7 * DAY_MS);
    const info = vi.spyOn(logger, "info");

    await revoke(pending.id).expect(204);

    expect(JSON.stringify(info.mock.calls)).not.toContain(guest);
    expect(await invitationAudit("DELETE")).toHaveLength(1);
  });
});
