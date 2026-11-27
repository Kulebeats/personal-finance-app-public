/**
 * Household invitation e-mail identity (follow-up to public #29) — REAL DB,
 * REAL HTTP, REAL sign-in.
 *
 * #29 made sign-in addresses trimmed and matched case-insensitively through
 * `users_email_lower_unique`. Invitations were left out: invite creation ran
 * `z.string().email()` without `.trim()`, so " someone@example.test " was a
 * 400 instead of an invitation to "someone@example.test". These tests pin the
 * invite side to the same identity rule: trimmed on create, one address per
 * pending invitation whatever its case, accepted by the account whose address
 * differs only in case, and still refused for anyone else.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdInvitations, householdMembers, households, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

const ACTORS = ["owner", "invitee", "stranger"] as const;
type Actor = (typeof ACTORS)[number];

const householdId = randomUUID();
const stamp = randomUUID().slice(0, 8);
const password = "SyntheticInviteIdentity123!";
// The invitee's account is stored with capitals; invitations are lowercased.
const inviteeAccountEmail = `Invite.Identity-${stamp}@Example.Test`;
const inviteeLower = inviteeAccountEmail.toLowerCase();
const actors = new Map<Actor, { id: string; email: string; cookie: string }>();
let app: Awaited<ReturnType<typeof getTestApp>>;

const actor = (name: Actor) => actors.get(name)!;
const invite = (as: Actor, email: string) =>
  request(app).post("/api/household/invite").set("Cookie", actor(as).cookie).send({ email, role: "member" });
const accept = (as: Actor, inviteCode: string) =>
  request(app).post("/api/household/invite/accept").set("Cookie", actor(as).cookie).send({ inviteCode });

const invitationRows = () =>
  db.select().from(householdInvitations).where(eq(householdInvitations.householdId, householdId));

async function membershipsOf(userId: string): Promise<string[]> {
  const rows = await db.select({ householdId: householdMembers.householdId })
    .from(householdMembers).where(eq(householdMembers.userId, userId));
  return rows.map((row) => row.householdId!);
}

function emailFor(name: Actor): string {
  return name === "invitee" ? inviteeAccountEmail : `invite-identity-${name}-${stamp}@example.test`;
}

describe("household invitation e-mail identity — real DB, real sign-in", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic invite identity" });
    const passwordHash = await hashPassword(password);
    for (const name of ACTORS) {
      const id = randomUUID();
      const email = emailFor(name);
      await db.insert(users).values({
        id, email, username: `invid-${name}-${id.slice(0, 8)}`, passwordHash, emailVerified: true,
      });
      const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
      actors.set(name, { id, email, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") });
    }
  }, 30000);

  beforeEach(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(householdInvitations).where(eq(householdInvitations.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.insert(householdMembers).values({ householdId, userId: actor("owner").id, role: "owner" });
  });

  afterAll(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    const ids = [...actors.values()].map(({ id }) => id);
    for (const id of ids) {
      await db.delete(auditLogs).where(eq(auditLogs.userId, id));
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
    }
    if (ids.length > 0) await db.delete(users).where(inArray(users.id, ids));
  });

  it("accepts an address with surrounding spaces and stores it trimmed", async () => {
    const response = await invite("owner", `  ${inviteeAccountEmail}\t `);

    expect(response.status).toBe(201);
    expect(response.body.data.invitation.email).toBe(inviteeLower);
    const rows = await invitationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(inviteeLower);
  });

  it("refuses a second pending invitation for the same address in another case", async () => {
    await invite("owner", ` ${inviteeLower} `).expect(201);

    const duplicate = await invite("owner", `  ${inviteeLower.toUpperCase()}  `);

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.message).toMatch(/already pending/i);
    expect(await invitationRows()).toHaveLength(1);
  });

  it("lets the invitee whose address differs only in case accept", async () => {
    await invite("owner", ` ${inviteeLower.toUpperCase()} `).expect(201);
    const [invitation] = await invitationRows();

    const response = await accept("invitee", invitation.inviteCode);

    expect(response.status).toBe(200);
    expect(await membershipsOf(actor("invitee").id)).toEqual([householdId]);
    const [used] = await invitationRows();
    expect(used.acceptedBy).toBe(actor("invitee").id);
  });

  it("still refuses a different signed-in user, without echoing the invited address", async () => {
    await invite("owner", `  ${inviteeAccountEmail} `).expect(201);
    const [invitation] = await invitationRows();

    const response = await accept("stranger", invitation.inviteCode);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVITE_RECIPIENT_MISMATCH");
    expect(JSON.stringify(response.body).toLowerCase()).not.toContain(inviteeLower);
    expect(await membershipsOf(actor("stranger").id)).toEqual([]);
    const [unused] = await invitationRows();
    expect(unused.acceptedAt).toBeNull();
    expect(unused.acceptedBy).toBeNull();
  });
});
