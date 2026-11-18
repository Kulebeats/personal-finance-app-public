/**
 * Household membership lifecycle race safety — REAL DB.
 *
 * Two pre-existing race-safety gaps in the household membership lifecycle,
 * surfaced during the SCP-332 erasure review and unchanged by it:
 *
 *  Gap 1 — eraseAccount removed the user's membership by userId across EVERY
 *          household, but only decided the fate of the resolved household
 *          (deleteHouseholdFinancialData + last-member delete are scoped to
 *          ctx.householdId). A user who — against the single-household invariant
 *          enforced by household.create + invitations.acceptInvite — belonged to
 *          two households would have the SECOND one silently orphaned (its
 *          membership removed, but its financial data and household row left with
 *          no member and no fate decision). Fix: scope the membership delete to
 *          the resolved household and assert single-household membership, failing
 *          loudly (no silent orphaning) otherwise.
 *
 *  Gap 2 — a sole-member household erase and a concurrent acceptInvite shared no
 *          serialization anchor. acceptInvite locked the INVITATION row; its
 *          duplicate-membership guard locked a (householdId,userId) member row
 *          that does not exist yet, so it locked nothing. eraseAccount's
 *          last-member branch hard-deleted the household with no lock on a common
 *          row. household_members.household_id is ON DELETE CASCADE, so the
 *          joiner could be inserted into a household being deleted and then
 *          silently cascade-removed — a "ghost": invite consumed, no membership,
 *          household gone. Fix: both paths take SELECT households ... FOR UPDATE
 *          as the serialization anchor before touching the member set.
 *
 * Gap 2 is reproduced deterministically rather than by a naive Promise.all race
 * (the ghost window is too narrow to hit reliably): a control connection holds
 * the invitation row FOR UPDATE, and the two operations are started in a fixed
 * order so acceptInvite enqueues on that lock first. On the UNFIXED code both
 * acceptInvite (its invitation lock) and eraseAccount (its last-member
 * DELETE household_invitations) queue on that same row, so when the control lock
 * releases, acceptInvite inserts the member and commits, then eraseAccount
 * deletes the household and cascade-removes the just-inserted member → the ghost.
 * On the FIXED code eraseAccount and acceptInvite serialize on the household row
 * lock instead, so the household is kept (the joiner won) — no ghost.
 *
 * Real db client; per-case cleanup. tsconfig excludes *.test.ts from tsc, so run
 * explicitly:  cd server && npx vitest run settings.account-deletion.race
 */

import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { db, pool } from "../../../db";
import { and, eq, inArray } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  householdInvitations,
  accounts,
  auditLogs,
} from "@shared/schema";
import { createTestUser } from "../../../__tests__/fixtures";
import { householdRepository } from "../../../repositories/HouseholdRepository";
import { eraseAccount } from "../settings.account-deletion.service";
import { ConflictError } from "../../../core/errors";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Track everything we create so cleanup is reliable even when a path under test
// deletes some of it mid-run.
const createdUserIds = new Set<string>();
const createdHouseholdIds = new Set<string>();

async function seedUser(label: string): Promise<{ id: string; email: string }> {
  const u = createTestUser({
    email: `race-${label}-${randomUUID().slice(0, 8)}@example.com`,
    username: `race-${label}-${randomUUID().slice(0, 8)}`,
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
  createdUserIds.add(u.id);
  return { id: u.id, email: u.email };
}

async function seedHousehold(name: string): Promise<string> {
  const id = randomUUID();
  await db.insert(households).values({ id, name, currency: "ZMW" });
  createdHouseholdIds.add(id);
  return id;
}

async function addMember(
  householdId: string,
  userId: string,
  role: "owner" | "admin" | "member" | "view_only",
): Promise<void> {
  await db.insert(householdMembers).values({ householdId, userId, role });
}

afterEach(async () => {
  try {
    const householdIds = [...createdHouseholdIds];
    const userIds = [...createdUserIds];
    if (householdIds.length > 0) {
      await db
        .delete(auditLogs)
        .where(inArray(auditLogs.householdId, householdIds));
      await db
        .delete(accounts)
        .where(inArray(accounts.householdId, householdIds));
      await db
        .delete(householdInvitations)
        .where(inArray(householdInvitations.householdId, householdIds));
      await db
        .delete(householdMembers)
        .where(inArray(householdMembers.householdId, householdIds));
      await db.delete(households).where(inArray(households.id, householdIds));
    }
    if (userIds.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("race-test cleanup error", error);
  } finally {
    createdHouseholdIds.clear();
    createdUserIds.clear();
  }
});

describe("Household membership lifecycle race safety", () => {
  /**
   * Gap 2: a sole-member household erase racing an acceptInvite for that
   * household must converge to ONE deterministic valid state, never a ghost
   * membership (acceptInvite reporting success while the joiner is not actually a
   * member of a surviving household).
   */
  it("erase-sole-member vs acceptInvite never leaves a ghost membership", async () => {
    const owner = await seedUser("g2-owner");
    const joiner = await seedUser("g2-joiner");
    const householdId = await seedHousehold(`race-g2-${Date.now()}`);
    await addMember(householdId, owner.id, "owner");

    const invitationId = randomUUID();
    await db.insert(householdInvitations).values({
      id: invitationId,
      householdId,
      email: joiner.email,
      role: "member",
      inviteCode: `race-g2-${randomUUID().slice(0, 12)}`,
      invitedBy: owner.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Control connection pins the invitation row so we can order the two
    // operations onto its wait queue: acceptInvite first, eraseAccount second.
    const ctrl = await pool.connect();
    let acceptResult: PromiseSettledResult<void>;
    let eraseResult: PromiseSettledResult<unknown>;
    try {
      await ctrl.query("BEGIN");
      await ctrl.query(
        "SELECT id FROM household_invitations WHERE id = $1 FOR UPDATE",
        [invitationId],
      );

      // Start acceptInvite first. On the unfixed code it blocks directly on the
      // pinned invitation row, enqueueing first. On the fixed code it immediately
      // acquires the household FOR UPDATE lock and THEN blocks on the pinned
      // invitation row — so when eraseAccount starts below it must wait for the
      // household lock acceptInvite already holds (ordering it after acceptInvite).
      const acceptPromise = householdRepository
        .acceptInvite(invitationId, householdId, joiner.id, "member")
        .then(
          () => ({ status: "fulfilled" }) as PromiseFulfilledResult<void>,
          (reason) =>
            ({ status: "rejected", reason }) as PromiseRejectedResult,
        );
      await sleep(250);

      // Start eraseAccount; on the unfixed code it reaches the last-member
      // DELETE household_invitations and enqueues second on the same row.
      const erasePromise = eraseAccount({
        userId: owner.id,
        householdId,
        userEmail: owner.email,
        ipAddress: "127.0.0.1",
      }).then(
        (value) =>
          ({ status: "fulfilled", value }) as PromiseFulfilledResult<unknown>,
        (reason) => ({ status: "rejected", reason }) as PromiseRejectedResult,
      );
      await sleep(250);

      // Release the pin; the queued operations now run in order.
      await ctrl.query("COMMIT");

      [acceptResult, eraseResult] = await Promise.all([
        acceptPromise,
        erasePromise,
      ]);
    } finally {
      try {
        await ctrl.query("ROLLBACK");
      } catch {
        /* already committed */
      }
      ctrl.release();
    }

    const householdExists =
      (
        await db.select().from(households).where(eq(households.id, householdId))
      ).length > 0;

    const joinerMembershipCount = (
      await db
        .select()
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, householdId),
            eq(householdMembers.userId, joiner.id),
          ),
        )
    ).length;

    const acceptFulfilled = acceptResult.status === "fulfilled";

    // The core invariant: acceptInvite never reports success while the joiner is
    // not actually a member of a surviving household (the ghost).
    if (acceptFulfilled) {
      expect(
        householdExists,
        "accept fulfilled => household must still exist",
      ).toBe(true);
      expect(
        joinerMembershipCount,
        "accept fulfilled => joiner is a member exactly once",
      ).toBe(1);
    }

    // If the household was deleted, the joiner must not be a dangling member and
    // the accept must have been rejected.
    if (!householdExists) {
      expect(
        joinerMembershipCount,
        "household deleted => joiner has no membership row",
      ).toBe(0);
      expect(
        acceptFulfilled,
        "household deleted => accept must have failed",
      ).toBe(false);
    }

    // The erase itself must always complete: it either deletes the now-empty
    // household, or keeps it because the joiner won the lock and remains.
    expect(
      eraseResult.status,
      `erase must complete (reason: ${
        eraseResult.status === "rejected"
          ? String((eraseResult as PromiseRejectedResult).reason)
          : "n/a"
      })`,
    ).toBe("fulfilled");
    // Generous timeout: this test deliberately holds a row lock and sleeps to
    // order the wait queue, and eraseAccount issues ~40 deletes — well over
    // vitest's 5000ms default under a loaded CI Postgres shared across files.
  }, 30000);

  /**
   * Gap 1: a user who (against the single-household invariant) is the sole owner
   * of two households must NOT be able to erase their account silently — the
   * erasure must fail loudly and leave BOTH households fully intact rather than
   * orphaning the one not chosen as ctx.householdId.
   */
  it("blocks erasure for a multi-household user and orphans nothing", async () => {
    const user = await seedUser("g1-multi");
    const householdA = await seedHousehold(`race-g1-A-${Date.now()}`);
    const householdB = await seedHousehold(`race-g1-B-${Date.now()}`);
    await addMember(householdA, user.id, "owner");
    await addMember(householdB, user.id, "owner");

    // Financial data in the household NOT chosen as ctx.householdId — it must
    // survive an erasure that targets householdA.
    const bAccountId = randomUUID();
    await db.insert(accounts).values({
      id: bAccountId,
      householdId: householdB,
      name: "Household B Checking",
      type: "checking",
      balance: "4200.00",
      currency: "ZMW",
    });

    // Erasure targets householdA; the user is also sole owner of householdB.
    await expect(
      eraseAccount({
        userId: user.id,
        householdId: householdA,
        userEmail: user.email,
        ipAddress: "127.0.0.1",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    // Both households still exist.
    const aRows = await db
      .select()
      .from(households)
      .where(eq(households.id, householdA));
    const bRows = await db
      .select()
      .from(households)
      .where(eq(households.id, householdB));
    expect(aRows.length, "household A must still exist").toBe(1);
    expect(bRows.length, "household B must still exist").toBe(1);

    // Both memberships intact (nothing removed by the rolled-back erasure).
    const memberships = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, user.id));
    expect(
      memberships.map((m) => m.householdId).sort(),
      "user remains a member of both households",
    ).toEqual([householdA, householdB].sort());

    // Household B's financial data untouched (no orphaning, no partial wipe).
    const bAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.householdId, householdB));
    expect(bAccounts.length, "household B account must survive").toBe(1);

    // The user row is NOT anonymised — erasure rolled back entirely.
    const [erasedUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(erasedUser.email, "user must not be anonymised").toBe(user.email);
  }, 30000);
});
