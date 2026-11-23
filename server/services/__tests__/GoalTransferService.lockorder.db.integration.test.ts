/**
 * GoalTransferService.transfer — REAL DB lock-ordering (deadlock) regression.
 *
 * transfer() locked the two goal rows in REQUEST order: fromGoal, then toGoal.
 * Two opposing concurrent transfers then form a lock cycle — A→B holds A and
 * waits for B, while B→A holds B and waits for A. Neither can proceed, so
 * Postgres breaks the cycle by aborting one backend with a deadlock_detected
 * error (SQLSTATE 40P01): a legitimate transfer fails with a spurious 500.
 *
 * The fix acquires both locks in a consistent global order (ascending goal id)
 * regardless of transfer direction, so the second transfer queues behind the
 * first instead of deadlocking with it.
 *
 * DETERMINISM — the reason this test does not rely on timing luck:
 * Firing two transfers concurrently and hoping the interleaving lands in the
 * deadlock window is flaky. Instead the race is forced:
 *
 *   1. A separate connection opens a transaction and holds a FOR UPDATE lock on
 *      the LOWER-id goal, so every transfer must stop at that goal.
 *   2. Transfer T1 (lower→higher) starts and blocks on the held lock. We poll
 *      pg_stat_activity until exactly 1 backend is lock-waiting, which proves T1
 *      is queued (Postgres grants lock waiters FIFO, so T1 is now first in line).
 *   3. Transfer T2 (higher→lower) starts and also blocks. We poll until 2
 *      backends are lock-waiting. On the OLD code T2 has by then already taken
 *      the higher goal's lock (it locks its `from` first) and is waiting on the
 *      lower one — the cycle is now armed and unavoidable. On the NEW code T2
 *      waits on the lower goal without holding anything.
 *   4. The holder commits. OLD: T1 takes the lower lock, wants the higher (held
 *      by T2), T2 wants the lower (held by T1) → guaranteed deadlock. NEW: T1
 *      runs to completion, then T2 does → both succeed.
 *
 * Both waiters block on the SAME goal under either implementation, so the
 * 2-waiter barrier is reached identically and the test cannot hang on the fix.
 * The pool is pre-warmed so connection setup never delays a participant.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";

import { db, pool } from "../../db";
import {
  goals,
  goalTransfers,
  goalActivityLog,
  households,
  users,
  householdMembers,
} from "@shared/schema";
import { goalTransferService } from "../GoalTransferService";
import { createTestUser } from "../../__tests__/fixtures";
import { isPostgresError } from "../../utils/postgresError";

describe("GoalTransferService.transfer — real DB lock ordering (deadlock)", () => {
  const createdHouseholdIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdGoalIds: string[] = [];

  beforeAll(async () => {
    // Pre-warm the pool: establishing a TCP connection + auth mid-race would add
    // latency to whichever participant connects last and could mask the
    // interleaving we are forcing. Every participant must start hot.
    await Promise.all(
      Array.from({ length: 10 }, () => db.execute(sql`SELECT 1`)),
    );
  });

  afterAll(async () => {
    try {
      if (createdGoalIds.length > 0) {
        await db
          .delete(goalActivityLog)
          .where(inArray(goalActivityLog.goalId, createdGoalIds));
      }
      for (const id of createdHouseholdIds) {
        await db
          .delete(goalTransfers)
          .where(eq(goalTransfers.householdId, id));
        await db.delete(goals).where(eq(goals.householdId, id));
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
      console.error("goal transfer lock-order cleanup error", error);
    }
  });

  async function seed() {
    const [hh] = await db
      .insert(households)
      .values({ name: `gt-race-${randomUUID().slice(0, 8)}`, currency: "ZMW" })
      .returning();
    createdHouseholdIds.push(hh.id);

    const u = createTestUser({
      email: `gt-race-${randomUUID().slice(0, 8)}@example.com`,
      username: `gt-race-${randomUUID().slice(0, 8)}`,
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

    await db
      .insert(householdMembers)
      .values({ householdId: hh.id, userId: u.id, role: "owner" });

    // Two goals, same type/currency, each funded enough to transfer either way.
    const inserted = await db
      .insert(goals)
      .values([
        {
          householdId: hh.id,
          name: "Goal One",
          targetAmount: "1000.00",
          currentAmount: "500.00",
          currency: "ZMW",
          type: "save_up" as const,
          createdBy: u.id,
        },
        {
          householdId: hh.id,
          name: "Goal Two",
          targetAmount: "1000.00",
          currentAmount: "500.00",
          currency: "ZMW",
          type: "save_up" as const,
          createdBy: u.id,
        },
      ])
      .returning();

    for (const g of inserted) createdGoalIds.push(g.id);

    // Order by id: the fix locks the lower id first, so the external holder must
    // hold the LOWER id to stop both transfers at the same gate.
    const [lower, higher] = [inserted[0], inserted[1]].sort((a, b) =>
      a.id < b.id ? -1 : 1,
    );

    return { householdId: hh.id, userId: u.id, lower, higher };
  }

  /** Poll until `expected` backends are blocked waiting on a lock in this DB. */
  async function waitForLockWaiters(expected: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const res = await db.execute(sql`
        SELECT count(*)::int AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND state = 'active'
      `);
      const waiting = Number((res.rows[0] as { waiting: number }).waiting);
      if (waiting >= expected) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `Timed out waiting for ${expected} lock waiter(s) — the race was not armed`,
    );
  }

  it("does not deadlock when two opposing transfers run concurrently", async () => {
    const { householdId, userId, lower, higher } = await seed();

    // A dedicated connection holds the lower-id goal locked, gating both
    // transfers so we can queue them in a known order.
    const holder = await pool.connect();
    let holderOpen = true;

    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM goals WHERE id = $1 FOR UPDATE", [
        lower.id,
      ]);

      // T1: lower → higher. Blocks on the held lower lock; becomes waiter #1.
      const t1 = goalTransferService.transfer(householdId, userId, {
        fromGoalId: lower.id,
        toGoalId: higher.id,
        amount: { amount: "100.00", currency: "ZMW" },
        reason: "race T1",
      });
      await waitForLockWaiters(1);

      // T2: higher → lower (the opposing direction). On the old code this first
      // takes the higher lock, then waits on lower — arming the cycle.
      const t2 = goalTransferService.transfer(householdId, userId, {
        fromGoalId: higher.id,
        toGoalId: lower.id,
        amount: { amount: "50.00", currency: "ZMW" },
        reason: "race T2",
      });
      await waitForLockWaiters(2);

      // Release the gate: both transfers now contend directly.
      await holder.query("COMMIT");
      holderOpen = false;

      const results = await Promise.allSettled([t1, t2]);

      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );

      // Assert on the SQLSTATE, not just "an error": the defect under test is
      // specifically deadlock_detected (40P01). Checking the code proves the old
      // code fails for the RIGHT reason and stops this test from passing/failing
      // on some unrelated error.
      const deadlocked = rejected.filter((r) =>
        isPostgresError(r.reason, "40P01"),
      );
      expect(deadlocked).toHaveLength(0);

      // And no transfer failed for any other reason either.
      expect(
        rejected.map((r) => (r.reason as Error)?.message ?? String(r.reason)),
      ).toEqual([]);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    } finally {
      if (holderOpen) {
        try {
          await holder.query("ROLLBACK");
        } catch {
          // holder already aborted; nothing to release
        }
      }
      holder.release();
    }

    // Money is conserved and correct: net effect is lower −100 +50, higher +100 −50.
    const finalGoals = await db
      .select()
      .from(goals)
      .where(inArray(goals.id, [lower.id, higher.id]));

    const finalLower = finalGoals.find((g) => g.id === lower.id)!;
    const finalHigher = finalGoals.find((g) => g.id === higher.id)!;

    expect(finalLower.currentAmount).toBe("450.00");
    expect(finalHigher.currentAmount).toBe("550.00");

    // Both transfer records persisted — neither was lost to a deadlock abort.
    const transfers = await db
      .select()
      .from(goalTransfers)
      .where(eq(goalTransfers.householdId, householdId));
    expect(transfers).toHaveLength(2);
  });
});
