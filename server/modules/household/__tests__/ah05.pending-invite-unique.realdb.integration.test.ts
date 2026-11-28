/**
 * AH-05: one pending invitation per household and address — REAL DB, REAL HTTP.
 *
 * Before migration 0064 the only guard was the controller's read-then-insert
 * check (invitations.controller.ts), with no lock and no unique index. Two
 * concurrent invites for one address both passed the check and both landed,
 * and a legacy row stored in another letter case was never found by it.
 * The index `household_invitations_pending_email_unique` now refuses the
 * second row, HouseholdRepository.createInvitation maps that to 409, and an
 * expired, never accepted invitation is cleared first so the address can be
 * invited again. The last case runs the migration file itself against
 * duplicates, inside a transaction that is rolled back.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdInvitations, householdMembers, households, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { householdRepository } from "../../../repositories/HouseholdRepository";
import { getPostgresError } from "../../../utils/postgresError";

const INDEX_NAME = "household_invitations_pending_email_unique";
const MIGRATION_PATH = fileURLToPath(
  new URL("../../../../migrations/0064_ah05_pending_invite_unique.sql", import.meta.url),
);
const DAY_MS = 24 * 60 * 60 * 1000;

const householdId = randomUUID();
const stamp = randomUUID().slice(0, 8);
const password = "SyntheticPendingInvite123!";
const guest = `pending-guest-${stamp}@example.test`;
const owner = { id: randomUUID(), email: `pending-owner-${stamp}@example.test`, cookie: "" };
let app: Awaited<ReturnType<typeof getTestApp>>;

const invite = (email: string) =>
  request(app).post("/api/household/invite").set("Cookie", owner.cookie).send({ email, role: "member" });
const invitationRows = () =>
  db.select().from(householdInvitations).where(eq(householdInvitations.householdId, householdId));
const inviteRow = (email: string, offsetMs: { expires: number; created: number }) => ({
  householdId,
  email,
  role: "member" as const,
  inviteCode: randomUUID().replace(/-/g, ""),
  invitedBy: owner.id,
  expiresAt: new Date(Date.now() + offsetMs.expires),
  createdAt: new Date(Date.now() + offsetMs.created),
});

describe("AH-05 pending invitation uniqueness — real DB", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic pending invites" });
    await db.insert(users).values({
      id: owner.id, email: owner.email, username: `pending-${stamp}`,
      passwordHash: await hashPassword(password), emailVerified: true,
    });
    const login = await request(app).post("/api/auth/login").send({ email: owner.email, password }).expect(200);
    owner.cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  beforeEach(async () => {
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

  it("lets one of two concurrent invites for the same address land and answers the other 409", async () => {
    // Both requests pass the controller's pre-check, as they can when they race.
    vi.spyOn(householdRepository, "findPendingInvitationByEmail").mockResolvedValue(undefined);

    const responses = await Promise.all([invite(guest), invite(guest.toUpperCase())]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const refused = responses.find((response) => response.status === 409)!;
    expect(refused.body.error.message).toMatch(/already pending/i);
    expect(await invitationRows()).toHaveLength(1);
  });

  it("refuses an invite when a legacy pending row holds the address in another case", async () => {
    await db.insert(householdInvitations).values(inviteRow(guest.toUpperCase(), { expires: 7 * DAY_MS, created: 0 }));

    const response = await invite(guest);

    expect(response.status).toBe(409);
    expect(await invitationRows()).toHaveLength(1);
  });

  it("replaces an expired, never accepted invitation so the address can be invited again", async () => {
    const expired = inviteRow(guest, { expires: -DAY_MS, created: -8 * DAY_MS });
    await db.insert(householdInvitations).values(expired);

    const response = await invite(guest);

    expect(response.status).toBe(201);
    const rows = await invitationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].inviteCode).not.toBe(expired.inviteCode);
    expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("frees the address once the invitation is revoked", async () => {
    const first = await invite(guest).expect(201);

    await request(app).delete(`/api/household/invitations/${first.body.data.invitation.id}`)
      .set("Cookie", owner.cookie).expect(204);
    const again = await invite(guest);

    expect(again.status).toBe(201);
    expect(await invitationRows()).toHaveLength(1);
  });

  it("is enforced by the database for direct inserts, whatever the case", async () => {
    await db.insert(householdInvitations).values(inviteRow(guest, { expires: DAY_MS, created: 0 }));

    const duplicate = await db.insert(householdInvitations)
      .values(inviteRow(guest.toUpperCase(), { expires: DAY_MS, created: 0 }))
      .then(() => undefined, (error: unknown) => error);

    expect(getPostgresError(duplicate)).toMatchObject({ code: "23505", constraint: INDEX_NAME });
  });

  it("runs migration 0064 over existing duplicates: keeps the latest expiry, leaves accepted rows, builds the index", async () => {
    const statements = readFileSync(MIGRATION_PATH, "utf8").split("--> statement-breakpoint");
    const kept = inviteRow(guest.toUpperCase(), { expires: 7 * DAY_MS, created: -2 * DAY_MS });
    const older = inviteRow(guest, { expires: DAY_MS, created: -3 * DAY_MS });
    const expired = inviteRow(guest, { expires: -DAY_MS, created: -DAY_MS });
    const accepted = { ...inviteRow(guest, { expires: DAY_MS, created: -4 * DAY_MS }), acceptedAt: new Date(), acceptedBy: owner.id };
    const other = inviteRow(`other-${guest}`, { expires: DAY_MS, created: 0 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query(`DROP INDEX "${INDEX_NAME}"`);
      for (const row of [kept, older, expired, accepted, other]) {
        await client.query(
          `INSERT INTO household_invitations
             (household_id, email, role, invite_code, invited_by, expires_at, created_at, accepted_at, accepted_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [householdId, row.email, row.role, row.inviteCode, row.invitedBy, row.expiresAt, row.createdAt,
            "acceptedAt" in row ? row.acceptedAt : null, "acceptedBy" in row ? row.acceptedBy : null],
        );
      }

      for (const statement of statements) await client.query(statement);
      await client.query(statements[0]); // idempotent: a second run deletes nothing

      const remaining = await client.query<{ invite_code: string }>(
        "SELECT invite_code FROM household_invitations WHERE household_id = $1", [householdId]);
      expect(remaining.rows.map((row) => row.invite_code).sort())
        .toEqual([kept.inviteCode, accepted.inviteCode, other.inviteCode].sort());
      const index = await client.query("SELECT 1 FROM pg_indexes WHERE indexname = $1", [INDEX_NAME]);
      expect(index.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
