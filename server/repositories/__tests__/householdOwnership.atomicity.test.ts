/**
 * SCP-318: household ownership transfer & invite acceptance must be atomic and
 * race-safe — REAL DB.
 *
 * transferOwnership previously ran two sequential role updates with no
 * transaction or lock, so a partial failure (or two concurrent transfers) could
 * leave the household with two owners or none. acceptInvite (addMember +
 * markInvitationAccepted) was similarly non-atomic. Both now run inside one
 * withTransaction with FOR UPDATE on the relevant rows.
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
import { ForbiddenError, ConflictError } from "../../utils/errorHandler";
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

  const ownerCount = async (): Promise<number> =>
    (
      await db
        .select()
        .from(householdMembers)
        .where(eq(householdMembers.householdId, householdId))
    ).filter((m) => m.role === "owner").length;

  it("ends with exactly one owner when two transfers race", async () => {
    const owner = await seedUser("owner");
    const candidateA = await seedUser("candA");
    const candidateB = await seedUser("candB");

    await db.insert(householdMembers).values([
      { householdId, userId: owner, role: "owner" },
      { householdId, userId: candidateA, role: "admin" },
      { householdId, userId: candidateB, role: "admin" },
    ]);

    const results = await Promise.allSettled([
      householdRepository.transferOwnership(householdId, owner, candidateA),
      householdRepository.transferOwnership(householdId, owner, candidateB),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one transfer applies; the other is rejected (owner already demoted).
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ForbiddenError
    );

    // The invariant: never two owners, never zero owners.
    expect(await ownerCount()).toBe(1);
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
    await db.insert(householdInvitations).values({
      id: invitationId,
      householdId,
      email: "joiner@example.com",
      role: "member",
      inviteCode: `code-${randomUUID().slice(0, 12)}`,
      invitedBy: owner,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const results = await Promise.allSettled([
      householdRepository.acceptInvite(invitationId, householdId, joiner, "member"),
      householdRepository.acceptInvite(invitationId, householdId, joiner, "member"),
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
