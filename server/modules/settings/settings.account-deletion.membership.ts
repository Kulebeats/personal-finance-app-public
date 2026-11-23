/**
 * Settings Module - Account Deletion Membership Checks
 *
 * The membership preconditions of right-to-erasure, split from
 * settings.account-deletion.service.ts to keep it under its size limit.
 *
 * @module modules/settings/account-deletion-membership
 */
import { eq } from "drizzle-orm";
import { householdMembers } from "@shared/schema";
import type { TransactionType } from "../../utils/withTransaction";
import { ConflictError } from "../../core/errors";
import { logger } from "../../utils/logger";

/**
 * Lock this household's member rows FOR UPDATE (ordered by userId,
 * deadlock-safe) so the household-fate decision and any owner-succession
 * write form one race-safe unit.
 */
export async function lockHouseholdMembers(tx: TransactionType, householdId: string) {
  return tx
    .select({ userId: householdMembers.userId, role: householdMembers.role, joinedAt: householdMembers.joinedAt })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(householdMembers.userId)
    .for("update");
}

export type LockedMember = Awaited<ReturnType<typeof lockHouseholdMembers>>[number];

/**
 * Pick the most-senior member (earliest `joinedAt`, then `userId` as a
 * deterministic tiebreak; null `joinedAt` sorts last) to inherit ownership when
 * the erased user was the household's sole owner and members remain.
 */
export function pickSuccessor<T extends { userId: string; joinedAt: Date | null }>(
  members: readonly T[],
): T | undefined {
  return [...members].sort((a, b) => {
    const ta = a.joinedAt ? a.joinedAt.getTime() : Number.MAX_SAFE_INTEGER;
    const tb = b.joinedAt ? b.joinedAt.getTime() : Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  })[0];
}

async function membershipHouseholdIds(tx: TransactionType, userId: string): Promise<string[]> {
  const rows = await tx
    .select({ membershipHouseholdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId));
  return [...new Set(rows.map((m) => m.membershipHouseholdId).filter((id): id is string => id !== null))];
}

/**
 * Assert the user belongs ONLY to the resolved household (membership-lifecycle
 * race, Gap 1). Multi-household membership is not a supported state
 * (household.create rejects a second household; invitations.acceptInvite rejects
 * a user who already belongs to one), so the membership delete in eraseAccount is
 * scoped to the resolved household. If this user is somehow a member of ANOTHER
 * household, anonymising them here would leave that other household with a
 * scrubbed member (and, if they were its owner, no real owner) — so we fail
 * loudly rather than proceed. A plain read suffices: the household row is already
 * locked and the delete is scoped, so nothing here is orphaned; this is a
 * precondition tripwire, and locking the user's rows out of userId order would
 * risk a deadlock with the userId-ordered member lock. The offending household
 * ids are logged server-side, not surfaced to the client.
 */
export async function assertSingleHousehold(tx: TransactionType, userId: string, householdId: string): Promise<void> {
  const otherHouseholdIds = (await membershipHouseholdIds(tx, userId)).filter((id) => id !== householdId);
  if (otherHouseholdIds.length > 0) {
    logger.warn("Account erasure blocked: multi-household membership", { userId, householdId, otherHouseholdIds });
    throw new ConflictError(
      "Account erasure blocked: this account belongs to more than one " +
        "household. Multi-household membership is not supported; resolve the " +
        "extra membership(s) before erasing this account.",
    );
  }
}

/**
 * A-20: the household-free erasure path. Checked after the identity lock: a
 * membership that appeared since the request resolved no household means the
 * request is stale, so it must be retried and take the household path.
 */
export async function assertNoHousehold(tx: TransactionType, userId: string): Promise<void> {
  if ((await membershipHouseholdIds(tx, userId)).length > 0) {
    throw new ConflictError("Account erasure state changed; retry the request");
  }
}
