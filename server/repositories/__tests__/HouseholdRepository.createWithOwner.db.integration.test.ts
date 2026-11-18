/**
 * HouseholdRepository.createWithOwner — REAL DB atomicity.
 *
 * The household "create" path used to issue three separate, non-transactional
 * writes: insert the household, add the owner membership, then seed default
 * tags. If the owner-membership insert (or tag seeding) failed, the household
 * row was left behind with no members — an orphaned, ownerless household that
 * findByUserId (which joins through household_members) can never reach, so the
 * creating user could neither see nor delete it.
 *
 * createWithOwner wraps all three writes in a single transaction. These tests
 * run against a REAL Postgres database (no repo / no db mock):
 *
 *  - happy path: a household, its single owner member, and the 8 default tags
 *    are all committed together;
 *  - injected failure in the addMember step (a userId with no matching users
 *    row → real foreign-key violation) rolls the whole transaction back, so NO
 *    household row survives — proving creation is all-or-nothing.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

import { db } from "../../db";
import { households, householdMembers, tags, users } from "@shared/schema";
import { householdRepository } from "../HouseholdRepository";
import { createTestUser } from "../../__tests__/fixtures";

describe("HouseholdRepository.createWithOwner — real DB atomicity", () => {
  const createdHouseholdIds: string[] = [];
  const createdUserIds: string[] = [];

  async function seedUser(): Promise<string> {
    const u = createTestUser({
      email: `hh-create-${randomUUID().slice(0, 8)}@example.com`,
      username: `hh-create-${randomUUID().slice(0, 8)}`,
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
    createdUserIds.push(u.id);
    return u.id;
  }

  afterAll(async () => {
    try {
      for (const id of createdHouseholdIds) {
        await db.delete(tags).where(eq(tags.householdId, id));
        await db
          .delete(householdMembers)
          .where(eq(householdMembers.householdId, id));
        await db.delete(households).where(eq(households.id, id));
      }
      for (const id of createdUserIds) {
        await db.delete(users).where(eq(users.id, id));
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("createWithOwner cleanup error", error);
    }
  });

  it("commits the household, its owner membership, and default tags together", async () => {
    const userId = await seedUser();
    const name = `Atomic Household ${randomUUID().slice(0, 8)}`;

    const household = await householdRepository.createWithOwner({
      name,
      currency: "ZMW",
      userId,
    });
    createdHouseholdIds.push(household.id);

    expect(household.id).toBeDefined();
    expect(household.name).toBe(name);

    const householdRows = await db
      .select()
      .from(households)
      .where(eq(households.id, household.id));
    expect(householdRows).toHaveLength(1);

    const memberRows = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.householdId, household.id));
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0].userId).toBe(userId);
    expect(memberRows[0].role).toBe("owner");

    const tagRows = await db
      .select()
      .from(tags)
      .where(eq(tags.householdId, household.id));
    expect(tagRows).toHaveLength(8);
  });

  it("rolls back fully when the owner-membership insert fails, leaving NO household row", async () => {
    // A userId with no matching users row makes the household_members insert
    // (the addMember step) fail with a foreign-key violation mid-transaction.
    const bogusUserId = randomUUID();
    const name = `Rollback Household ${randomUUID()}`;

    await expect(
      householdRepository.createWithOwner({
        name,
        currency: "ZMW",
        userId: bogusUserId,
      })
    ).rejects.toThrow();

    // Full rollback: the household insert that ran first must not survive, so
    // there is no orphaned, ownerless household.
    const householdRows = await db
      .select()
      .from(households)
      .where(eq(households.name, name));
    expect(householdRows).toHaveLength(0);

    // And the failed member belongs to no household.
    const memberRows = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, bogusUserId));
    expect(memberRows).toHaveLength(0);
  });
});
