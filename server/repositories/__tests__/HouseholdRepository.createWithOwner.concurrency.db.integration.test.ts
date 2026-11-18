/**
 * HouseholdRepository.createWithOwner — REAL DB concurrency (TOCTOU).
 *
 * The household "create" path guards a user against creating a second household
 * with a check-then-act sequence: findByUserId (time of CHECK) followed by the
 * create (time of USE). With no serialization between the two, two concurrent
 * create requests by the SAME user can both pass the check — neither sees the
 * other's not-yet-committed owner membership — and both create a household,
 * leaving the user a member of TWO households (findByUserId then returns one
 * arbitrarily). A blanket unique index on household_members.userId is the WRONG
 * fix: users legitimately belong to multiple households via invitations
 * (HouseholdRepository.acceptInvite).
 *
 * createWithOwner closes the race by taking a per-user, transaction-scoped
 * Postgres advisory lock (pg_advisory_xact_lock) as the first statement in the
 * transaction, then re-checking membership INSIDE the lock. A second concurrent
 * create blocks until the first commits, then sees the now-committed membership
 * and is rejected with ConflictError (CLAUDE.md Rule 10: atomic read-then-write
 * on a contended path).
 *
 * These tests run against a REAL Postgres database (no repo / no db mock). They
 * fire two concurrent createWithOwner calls for one user and assert the final
 * state is valid exactly once: one household created, the other rejected, and
 * the persisted rows agree.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

import { db } from "../../db";
import {
  households,
  householdMembers,
  tags,
  users,
  type Household,
} from "@shared/schema";
import { householdRepository } from "../HouseholdRepository";
import { ConflictError } from "../../utils/errorHandler";
import { createTestUser } from "../../__tests__/fixtures";

describe("HouseholdRepository.createWithOwner — real DB concurrency (TOCTOU)", () => {
  const createdHouseholdIds: string[] = [];
  const createdUserIds: string[] = [];

  async function seedUser(): Promise<string> {
    const u = createTestUser({
      email: `hh-race-${randomUUID().slice(0, 8)}@example.com`,
      username: `hh-race-${randomUUID().slice(0, 8)}`,
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
      console.error("createWithOwner concurrency cleanup error", error);
    }
  });

  it("serializes two concurrent creates for the same user: exactly one household, the other rejects with ConflictError", async () => {
    const userId = await seedUser();

    // Fire both creates concurrently. Each createWithOwner call opens its
    // transaction immediately, so both transactions are in flight before either
    // commits — exactly the window the TOCTOU race exploits. allSettled (not
    // all) because exactly one of the two is expected to reject.
    const results = await Promise.allSettled([
      householdRepository.createWithOwner({
        name: `Race A ${randomUUID().slice(0, 8)}`,
        currency: "ZMW",
        userId,
      }),
      householdRepository.createWithOwner({
        name: `Race B ${randomUUID().slice(0, 8)}`,
        currency: "ZMW",
        userId,
      }),
    ]);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Household> => r.status === "fulfilled",
    );
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );

    // Track every household that actually got created so cleanup removes it,
    // including the buggy two-household case where this assertion fails.
    for (const r of fulfilled) createdHouseholdIds.push(r.value.id);

    // Exactly one create succeeds; exactly one is rejected as a conflict.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictError);

    // The persisted state agrees: the user is a member of exactly ONE
    // household — the one that committed — as its owner.
    const memberRows = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, userId));
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0].householdId).toBe(fulfilled[0].value.id);
    expect(memberRows[0].role).toBe("owner");

    // The rejected create rolled back fully: only the winning household exists.
    const householdRows = await db
      .select()
      .from(households)
      .where(eq(households.id, fulfilled[0].value.id));
    expect(householdRows).toHaveLength(1);
  });
});
