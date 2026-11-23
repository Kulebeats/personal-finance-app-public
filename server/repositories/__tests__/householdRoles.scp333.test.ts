/**
 * SCP-333: household member roles — REAL DB.
 *
 * Covers the repository-level pieces of SCP-333:
 *  1. findMembers joins the users table so each member carries name + email
 *     (MemberList previously rendered blank rows because no join existed).
 *
 * Role changes, removals and ownership transfer moved to
 * modules/household/ownership.service.ts (NEW-12); their real-DB HTTP tests are
 * in modules/household/__tests__/completion-r03.single-owner.realdb.integration.test.ts.
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
});
