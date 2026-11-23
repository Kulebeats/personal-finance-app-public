/**
 * SCP-318: household invite acceptance must be atomic and race-safe — REAL DB.
 *
 * The ownership-transfer race moved with the transfer itself to
 * modules/household/ownership.service.ts (NEW-12) and is tested over HTTP in
 * completion-r03.single-owner.realdb.integration.test.ts.
 *
 * Invite acceptance (insert member + mark the invitation used) was non-atomic;
 * it now runs as modules/household/invitations.accept.ts acceptInvitation, in
 * one withTransaction with FOR UPDATE on the household and invitation rows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import {
  householdMembers,
  householdInvitations,
  users,
  households,
} from "@shared/schema";
import { householdRepository } from "../HouseholdRepository";
import { acceptInvitation } from "../../modules/household/invitations.accept";
import { ConflictError } from "../../utils/errorHandler";
import { createTestUser, createTestHousehold } from "../../__tests__/fixtures";

describe("Household ownership/invite atomicity (SCP-318)", () => {
  let householdId: string;
  const userIds: string[] = [];

  async function seedUser(label: string): Promise<string> {
    const u = createTestUser({
      email: `scp318-${label}-${randomUUID().slice(0, 8)}@example.com`,
      username: `scp318-${label}-${randomUUID().slice(0, 8)}`,
    });
    await db.insert(users).values({
      id: u.id,
      email: u.email,
      username: u.username,
      passwordHash: u.passwordHash,
      fullName: u.fullName,
      emailVerified: u.emailVerified,
      mfaEnabled: u.mfaEnabled,
      failedLoginAttempts: u.failedLoginAttempts,
      lockedUntil: u.lockedUntil,
    });
    userIds.push(u.id);
    return u.id;
  }

  beforeAll(async () => {
    const seedUserId = randomUUID();
    const hh = createTestHousehold(seedUserId, { name: `scp318-${Date.now()}` });
    householdId = hh.id;
    await db.insert(households).values({
      id: hh.id,
      name: hh.name,
      currency: hh.currency,
    });
  });

  afterAll(async () => {
    try {
      await db
        .delete(householdInvitations)
        .where(eq(householdInvitations.householdId, householdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      for (const id of userIds) {
        await db.delete(users).where(eq(users.id, id));
      }
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("SCP-318 cleanup error", error);
    }
  });

  it("accepts an invite once when two accepts race the same code", async () => {
    const owner = await seedUser("inv-owner");
    const joiner = await seedUser("joiner");
    await db.insert(householdMembers).values({
      householdId,
      userId: owner,
      role: "owner",
    });

    const invitationId = randomUUID();
    const inviteCode = `code-${randomUUID().slice(0, 12)}`;
    const [joinerRow] = await db.select({ email: users.email }).from(users).where(eq(users.id, joiner));
    await db.insert(householdInvitations).values({
      id: invitationId,
      householdId,
      email: joinerRow.email,
      role: "member",
      inviteCode,
      invitedBy: owner,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const results = await Promise.allSettled([
      acceptInvitation({ userId: joiner }, inviteCode),
      acceptInvitation({ userId: joiner }, inviteCode),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictError
    );

    // The joiner is a member exactly once (no duplicate membership row).
    const joinerRows = (
      await db
        .select()
        .from(householdMembers)
        .where(eq(householdMembers.householdId, householdId))
    ).filter((m) => m.userId === joiner);
    expect(joinerRows).toHaveLength(1);

    // The invitation is marked used.
    const [inv] = await db
      .select()
      .from(householdInvitations)
      .where(eq(householdInvitations.id, invitationId))
      .limit(1);
    expect(inv.acceptedAt).not.toBeNull();
    expect(inv.acceptedBy).toBe(joiner);
  });

  // The household_members_household_user_unique constraint is the ultimate
  // backstop: even two raw concurrent addMember calls (e.g. two distinct invite
  // codes for the same user racing, outside acceptInvite's FOR UPDATE) can add
  // the member at most once.
  it("adds a member exactly once when two addMember calls race", async () => {
    const member = await seedUser("dup-add");

    const results = await Promise.allSettled([
      householdRepository.addMember({ householdId, userId: member, role: "member" }),
      householdRepository.addMember({ householdId, userId: member, role: "admin" }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictError
    );

    const rows = (
      await db
        .select()
        .from(householdMembers)
        .where(eq(householdMembers.householdId, householdId))
    ).filter((m) => m.userId === member);
    expect(rows).toHaveLength(1);
  });
});
