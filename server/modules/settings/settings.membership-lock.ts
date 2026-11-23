/**
 * Settings Module - Live membership lock for personal uploads
 *
 * A banner or picture upload publishes its URL on the user row. Erasure locks
 * the household's member rows before it reads the user row's URLs, collects
 * the user's personal objects and removes the membership. Locking this
 * member's row FOR SHARE first, in that same order, serializes the two: an
 * erasure that committed first leaves no row, so the upload refuses and its
 * bytes are discarded; an upload that committed first is seen by the erasure.
 *
 * @module modules/settings/settings.membership-lock
 */
import { and, eq } from "drizzle-orm";
import { householdMembers } from "@shared/schema";
import { NotFoundError } from "../../core/errors";
import type { TransactionType } from "../../utils/withTransaction";

export async function lockLiveMembership(tx: TransactionType, householdId: string, userId: string): Promise<void> {
  const [member] = await tx.select({ userId: householdMembers.userId }).from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .for("share").limit(1);
  if (!member) throw new NotFoundError("Household membership not found");
}
