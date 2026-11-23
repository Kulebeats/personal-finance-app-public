import { and, eq, inArray } from "drizzle-orm";
import { householdMembers, households } from "@shared/schema";
import { can } from "../core/authz/capabilities";
import { AuthorizationError, NotFoundError, ValidationError } from "../core/errors";
import type { TransactionType } from "../utils/withTransaction";

/** Match household lifecycle writers on the parent before locking its members. */
export async function lockAccountHousehold(tx: TransactionType, householdId: string): Promise<void> {
  const [household] = await tx.select({ id: households.id }).from(households)
    .where(eq(households.id, householdId)).for("key share");
  if (!household) throw new NotFoundError("Household");
}

export async function lockAccountMembers(tx: TransactionType, householdId: string, ...userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.flatMap(id => id ? [id.toLowerCase()] : []))];
  if (!ids.length) return [];
  return tx.select({ id: householdMembers.userId, role: householdMembers.role }).from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), inArray(householdMembers.userId, ids)))
    .orderBy(householdMembers.userId).for("share");
}

export function requireAccountWriter(members: Awaited<ReturnType<typeof lockAccountMembers>>, userId: string) {
  const actor = members.find(member => member.id === userId.toLowerCase());
  if (!actor || !can(actor.role, "financial.write")) throw new AuthorizationError("Financial write access required");
  return actor;
}

/** Final owner/grant validation remains locked through account and audit commit. */
export async function lockAccountCreationGrant(tx: TransactionType, householdId: string, userId: string, ownerUserId: string | null) {
  await lockAccountHousehold(tx, householdId);
  const members = await lockAccountMembers(tx, householdId, userId, ownerUserId);
  const actor = requireAccountWriter(members, userId);
  if (ownerUserId && ownerUserId !== userId) {
    if (actor.role !== "owner" && actor.role !== "admin") throw new AuthorizationError("Only admins can create accounts for other members");
    if (!members.some(member => member.id === ownerUserId.toLowerCase())) throw new ValidationError("Owner must be a household member");
  }
}
