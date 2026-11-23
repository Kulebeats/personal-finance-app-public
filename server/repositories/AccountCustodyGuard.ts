import type { SQL } from "drizzle-orm";
import { accounts, type Account } from "@shared/schema";
import { ConflictError, ValidationError } from "../core/errors";
import type { TransactionType } from "../utils/withTransaction";
import { lockAccountHousehold, lockAccountMembers, requireAccountWriter } from "./AccountCreationGrant";

/** The two fields that decide who can see an account. */
export function changesAccountCustody(data: Partial<Account>): boolean {
  return data.isPrivate !== undefined || data.ownerUserId !== undefined;
}

/**
 * An admitted signed writer must still have write access when custody changes.
 * Keep the household and both grants locked through the account update, in
 * household → member → account order. The unlocked read only determines which
 * member row to lock when the patch leaves the current owner in place.
 */
export async function lockAccountCustody(
  tx: TransactionType, householdId: string, scope: SQL, data: Partial<Account>, actorUserId?: string,
): Promise<Account | undefined> {
  await lockAccountHousehold(tx, householdId);
  const [candidate] = data.ownerUserId === undefined
    ? await tx.select({ ownerUserId: accounts.ownerUserId }).from(accounts).where(scope)
    : [];
  const ownerUserId = data.ownerUserId !== undefined ? data.ownerUserId : candidate?.ownerUserId;
  const members = await lockAccountMembers(tx, householdId, actorUserId, ownerUserId);
  if (actorUserId !== undefined) requireAccountWriter(members, actorUserId);

  const [locked] = await tx.select().from(accounts).where(scope).for("update");
  if (!locked) return;
  if (data.ownerUserId === undefined && locked.ownerUserId !== ownerUserId) {
    throw new ConflictError("Account was modified by another user. Please refresh and try again.");
  }

  const isPrivate = data.isPrivate ?? locked.isPrivate;
  if (isPrivate && !ownerUserId) {
    throw new ValidationError("Private accounts must have an owner", [
      { field: "isPrivate", message: "Choose an owner before making this account private" },
    ]);
  }
  if (ownerUserId && !members.some(member => member.id === ownerUserId.toLowerCase())) {
    throw new ValidationError("Owner must be a household member", [
      { field: "ownerUserId", message: "User is not a member of this household" },
    ]);
  }
  return locked;
}
