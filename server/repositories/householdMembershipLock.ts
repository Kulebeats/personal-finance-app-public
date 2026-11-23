/**
 * Per-user membership lock: the one-household-per-user rule (AH-06).
 *
 * Every write that can give a user a household membership (creating a
 * household, accepting an invitation) takes this transaction-scoped advisory
 * lock and then re-checks the user's memberships under it, so two concurrent
 * joins by one user serialise and the second sees the first's commit.
 *
 * Lock order: callers that also lock a household row take the household row
 * FIRST, then this lock (the same parent-first order as ownership changes and
 * erasure, none of which take this lock), so the order has no cycle.
 *
 * @module repositories/householdMembershipLock
 */
import { sql } from "drizzle-orm";
import type { TransactionType } from "../utils/withTransaction";

/**
 * Advisory-lock namespace (classid), ASCII "hous". Paired with hashtext(userId)
 * as the objid so it never collides with advisory locks taken for other
 * purposes. A hash collision only over-serialises two users briefly; the
 * membership re-check is still scoped to the exact userId.
 */
const HOUSEHOLD_MEMBERSHIP_LOCK_NAMESPACE = 0x686f7573;

export async function lockUserMembership(tx: TransactionType, userId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${HOUSEHOLD_MEMBERSHIP_LOCK_NAMESPACE}::int4, hashtext(${userId}))`,
  );
}
