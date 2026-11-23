/**
 * A-20 follow-up: a household-free erasure racing the same user's join (an
 * invitation accept or a household create, say in a second tab). Exactly one
 * side wins:
 *   - erasure first: the join is refused, and no membership, household,
 *     accepted invitation or member audit row is left for the erased user;
 *   - join first: the erasure is refused (409, retry) and the user stays.
 *
 * Interleavings are forced with locks held on a separate connection:
 *   - erasure first: a lock on the user's preferences row stalls the erasure
 *     after its identity and membership checks, while the join arrives;
 *   - join first: the per-user membership lock is held while the join and
 *     then the erasure queue behind it, so the join is granted first.
 * Real Postgres, real services.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import type { PoolClient } from "pg";
import { auditLogs, householdInvitations, householdMembers, households, userPreferences, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { acceptInvitation } from "../../household/invitations.accept";
import { householdRepository } from "../../../repositories/HouseholdRepository";
import { createSignedHousehold, type SignedHousehold } from "../../../__tests__/signed-household-fixture";
import { eraseAccount } from "../settings.account-deletion.service";

/** The per-user membership advisory lock (repositories/householdMembershipLock.ts). */
const MEMBERSHIP_LOCK_NAMESPACE = 0x686f7573;
const LOCK_WAIT_DEADLINE_MS = 5_000;

type Join = "accept" | "create";

let inviter: SignedHousehold;
const raceUsers: string[] = [];

interface Candidate { userId: string; email: string; inviteCode: string; householdName: string }

async function householdFreeUser(): Promise<Candidate> {
  const userId = randomUUID();
  const email = `household-free-race-${userId}@example.invalid`;
  await db.insert(users).values({ id: userId, email, username: `household-free-race-${userId}`, passwordHash: "!synthetic", emailVerified: true });
  await db.insert(userPreferences).values({ userId });
  raceUsers.push(userId);
  const inviteCode = randomUUID().replace(/-/g, "");
  await db.insert(householdInvitations).values({ householdId: inviter.householdId, email, role: "member", inviteCode,
    invitedBy: inviter.userId, expiresAt: new Date(Date.now() + 86_400_000) });
  return { userId, email, inviteCode, householdName: `Synthetic race ${userId}` };
}

function join(kind: Join, candidate: Candidate): Promise<unknown> {
  return kind === "accept"
    ? acceptInvitation({ userId: candidate.userId }, candidate.inviteCode)
    : householdRepository.createWithOwner({ name: candidate.householdName, currency: "USD", userId: candidate.userId });
}

function erase(candidate: Candidate): Promise<unknown> {
  return eraseAccount({ userId: candidate.userId, householdId: null, userEmail: candidate.email });
}

/** Wait until `count` backends of this database wait on a lock. */
async function waitForLockWaiters(count: number): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_DEADLINE_MS;
  while (Date.now() < deadline) {
    const { rows: [row] } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
    if (row.n >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  // A missed wait would let the race run in the wrong order and still pass.
  throw new Error(`timed out waiting for ${count} lock waiter(s)`);
}

async function withBlocker(lock: (client: PoolClient) => Promise<void>, race: () => Promise<void>): Promise<void> {
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await lock(blocker);
    await race();
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
  }
}

function settle(promise: Promise<unknown>): Promise<PromiseSettledResult<unknown>> {
  return Promise.allSettled([promise]).then(([result]) => result);
}

async function memberships(userId: string) {
  return db.select({ householdId: householdMembers.householdId }).from(householdMembers).where(eq(householdMembers.userId, userId));
}

beforeAll(async () => {
  inviter = await createSignedHousehold("household-free-race");
}, 60_000);

afterAll(async () => {
  const joined = await db.select({ householdId: householdMembers.householdId }).from(householdMembers)
    .where(inArray(householdMembers.userId, raceUsers));
  const created = joined.map((row) => row.householdId).filter((id): id is string => id !== null && id !== inviter.householdId);
  if (created.length) {
    // Seeded tags and categories cascade with the household.
    await db.delete(householdMembers).where(inArray(householdMembers.householdId, created));
    await db.delete(households).where(inArray(households.id, created));
  }
  await inviter.cleanup(async () => {
    await db.delete(householdMembers).where(inArray(householdMembers.userId, raceUsers));
    await db.delete(householdInvitations).where(eq(householdInvitations.householdId, inviter.householdId));
    await db.delete(auditLogs).where(inArray(auditLogs.userId, raceUsers));
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = ANY($1::uuid[])", [raceUsers]);
    await db.delete(userPreferences).where(inArray(userPreferences.userId, raceUsers));
    await db.delete(users).where(inArray(users.id, raceUsers));
  });
}, 60_000);

describe("an erased account cannot accept an invitation", () => {
  it("refuses even when the row still carries the invited address", async () => {
    const candidate = await householdFreeUser();
    // Erased, but (unlike a real tombstone) still under the invited address:
    // the refusal must come from the erasure itself, not the e-mail mismatch.
    await db.update(users).set({ erasedAt: new Date() }).where(eq(users.id, candidate.userId));

    const result = await settle(join("accept", candidate));

    expect(result.status).toBe("rejected");
    expect(await memberships(candidate.userId)).toEqual([]);
  }, 30_000);
});

describe.each<Join>(["accept", "create"])("household-free erasure racing a %s", (kind) => {
  it("erasure first: the join is refused and nothing is left for the erased user", async () => {
    const candidate = await householdFreeUser();
    const pending: { erasing?: Promise<PromiseSettledResult<unknown>>; joining?: Promise<PromiseSettledResult<unknown>> } = {};

    await withBlocker(
      async (blocker) => { await blocker.query("SELECT 1 FROM user_preferences WHERE user_id = $1 FOR UPDATE", [candidate.userId]); },
      async () => {
        pending.erasing = settle(erase(candidate));
        await waitForLockWaiters(1);
        pending.joining = settle(join(kind, candidate));
        await waitForLockWaiters(2);
      },
    );
    const [erasure, joined] = await Promise.all([pending.erasing!, pending.joining!]);

    expect(erasure?.status, String((erasure as PromiseRejectedResult | undefined)?.reason)).toBe("fulfilled");
    expect(joined?.status).toBe("rejected");
    const [row] = await db.select({ erasedAt: users.erasedAt }).from(users).where(eq(users.id, candidate.userId));
    expect(row.erasedAt).not.toBeNull();
    expect(await memberships(candidate.userId)).toEqual([]);
    expect(await db.select().from(households).where(eq(households.name, candidate.householdName))).toEqual([]);
    const [invitation] = await db.select({ acceptedBy: householdInvitations.acceptedBy }).from(householdInvitations)
      .where(eq(householdInvitations.inviteCode, candidate.inviteCode));
    expect(invitation.acceptedBy).toBeNull();
    const memberAudits = await db.select({ id: auditLogs.id }).from(auditLogs)
      .where(and(eq(auditLogs.entityType, "household_member"), eq(auditLogs.entityId, candidate.userId)));
    expect(memberAudits).toEqual([]);
  }, 30_000);

  it("join first: the erasure is refused with 409 and the user keeps the membership", async () => {
    const candidate = await householdFreeUser();
    const pending: { erasing?: Promise<PromiseSettledResult<unknown>>; joining?: Promise<PromiseSettledResult<unknown>> } = {};

    await withBlocker(
      async (blocker) => {
        await blocker.query("SELECT pg_advisory_xact_lock($1::int4, hashtext($2))", [MEMBERSHIP_LOCK_NAMESPACE, candidate.userId]);
      },
      async () => {
        pending.joining = settle(join(kind, candidate));
        await waitForLockWaiters(1);
        pending.erasing = settle(erase(candidate));
        await waitForLockWaiters(2);
      },
    );
    const [joined, erasure] = await Promise.all([pending.joining!, pending.erasing!]);

    expect(joined?.status, String((joined as PromiseRejectedResult | undefined)?.reason)).toBe("fulfilled");
    expect(erasure?.status).toBe("rejected");
    expect((erasure as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 });
    const [row] = await db.select({ erasedAt: users.erasedAt }).from(users).where(eq(users.id, candidate.userId));
    expect(row.erasedAt).toBeNull();
    expect(await memberships(candidate.userId)).toHaveLength(1);
  }, 30_000);
});
