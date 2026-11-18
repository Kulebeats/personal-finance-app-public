/**
 * SCP-333: household member roles — REAL DB.
 *
 * Covers the repository-level pieces of SCP-333:
 *  1. findMembers joins the users table so each member carries name + email
 *     (MemberList previously rendered blank rows because no join existed).
 *  2. updateMemberRoleAtomic locks the target row FOR UPDATE and re-checks it
 *     under the lock (race-safe role change), throwing NotFoundError for a
 *     missing member.
 *  3. removeMemberWithLastMemberGuard locks all member rows FOR UPDATE and
 *     re-checks the "not the last member" invariant under the lock, so two
 *     concurrent removals can't both pass the count check and empty the
 *     household.
 *
 * Mirrors the SCP-318 atomicity test template
 * (householdOwnership.atomicity.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { householdMembers, users, households } from "@shared/schema";
import { householdRepository } from "../HouseholdRepository";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { createTestUser, createTestHousehold } from "../../__tests__/fixtures";

describe("Household member roles (SCP-333)", () => {
  let householdId: string;
  const userIds: string[] = [];

  async function seedUser(label: string): Promise<{
    id: string;
    email: string;
    fullName: string;
  }> {
    const u = createTestUser({
      email: `scp333-${label}-${randomUUID().slice(0, 8)}@example.com`,
      username: `scp333-${label}-${randomUUID().slice(0, 8)}`,
      fullName: `SCP333 ${label}`,
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
    return { id: u.id, email: u.email, fullName: u.fullName };
  }

  beforeAll(async () => {
    const seedUserId = randomUUID();
    const hh = createTestHousehold(seedUserId, {
      name: `scp333-${Date.now()}`,
    });
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
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      for (const id of userIds) {
        await db.delete(users).where(eq(users.id, id));
      }
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("SCP-333 cleanup error", error);
    }
  });

  const memberCount = async (): Promise<number> =>
    (
      await db
        .select()
        .from(householdMembers)
        .where(eq(householdMembers.householdId, householdId))
    ).length;

  it("findMembers returns each member's name and email (users join)", async () => {
    const owner = await seedUser("members-owner");
    const viewer = await seedUser("members-viewer");
    await db.insert(householdMembers).values([
      { householdId, userId: owner.id, role: "owner" },
      { householdId, userId: viewer.id, role: "view_only" },
    ]);

    const members = await householdRepository.findMembers(householdId);

    const ownerRow = members.find((m) => m.userId === owner.id);
    const viewerRow = members.find((m) => m.userId === viewer.id);

    expect(ownerRow).toBeDefined();
    expect(ownerRow?.name).toBe(owner.fullName);
    expect(ownerRow?.email).toBe(owner.email);
    expect(ownerRow?.role).toBe("owner");

    expect(viewerRow).toBeDefined();
    expect(viewerRow?.name).toBe(viewer.fullName);
    expect(viewerRow?.email).toBe(viewer.email);
    expect(viewerRow?.role).toBe("view_only");

    // cleanup these rows so later tests start from a clean slate
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
  });

  it("updateMemberRoleAtomic changes a member's role", async () => {
    const owner = await seedUser("role-owner");
    const target = await seedUser("role-target");
    await db.insert(householdMembers).values([
      { householdId, userId: owner.id, role: "owner" },
      { householdId, userId: target.id, role: "member" },
    ]);

    const updated = await householdRepository.updateMemberRoleAtomic(
      householdId,
      target.id,
      "admin"
    );
    expect(updated.role).toBe("admin");

    const reread = await householdRepository.findMember(householdId, target.id);
    expect(reread.role).toBe("admin");

    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
  });

  it("updateMemberRoleAtomic throws NotFoundError for a missing member", async () => {
    await expect(
      householdRepository.updateMemberRoleAtomic(
        householdId,
        randomUUID(),
        "admin"
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("removeMemberWithLastMemberGuard removes a member when more than one exists", async () => {
    const owner = await seedUser("rm-owner");
    const target = await seedUser("rm-target");
    await db.insert(householdMembers).values([
      { householdId, userId: owner.id, role: "owner" },
      { householdId, userId: target.id, role: "member" },
    ]);

    await householdRepository.removeMemberWithLastMemberGuard(
      householdId,
      target.id
    );

    expect(
      await householdRepository.findMember(householdId, target.id)
    ).toBeUndefined();
    expect(await memberCount()).toBe(1);

    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
  });

  it("removeMemberWithLastMemberGuard rejects removing the last member", async () => {
    const onlyMember = await seedUser("rm-last");
    await db
      .insert(householdMembers)
      .values({ householdId, userId: onlyMember.id, role: "owner" });

    await expect(
      householdRepository.removeMemberWithLastMemberGuard(
        householdId,
        onlyMember.id
      )
    ).rejects.toBeInstanceOf(ValidationError);

    // The member is still there — the household was not emptied.
    expect(await memberCount()).toBe(1);

    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
  });

  it("keeps at least one member when two removals race the last two members", async () => {
    const a = await seedUser("race-a");
    const b = await seedUser("race-b");
    await db.insert(householdMembers).values([
      { householdId, userId: a.id, role: "owner" },
      { householdId, userId: b.id, role: "admin" },
    ]);

    const results = await Promise.allSettled([
      householdRepository.removeMemberWithLastMemberGuard(householdId, a.id),
      householdRepository.removeMemberWithLastMemberGuard(householdId, b.id),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one removal applies; the other is rejected by the last-member
    // guard re-checked under the FOR UPDATE lock.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ValidationError
    );

    // The invariant: the household is never emptied by a concurrent removal.
    expect(await memberCount()).toBe(1);

    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
  });
});
