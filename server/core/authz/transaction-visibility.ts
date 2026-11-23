import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { accounts, householdMembers, transactions } from "@shared/schema";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { can } from "./capabilities";

/** Actor is mandatory. Membership, account and transaction privacy are distinct. */
export function readableMembershipPredicate(actor: HouseholdContext) {
  if (!actor || !can(actor.role, "financial.read")) return sql`false`;
  return sql`exists (select 1 from ${householdMembers} where ${and(
    eq(householdMembers.householdId, actor.householdId),
    eq(householdMembers.userId, actor.userId),
    inArray(householdMembers.role, ["owner", "admin", "member", "view_only", "professional"]),
  )})`;
}

/**
 * An account as a goal's retained source: the same privacy as a live one,
 * but soft deletion ignored, so deleting an account never hides the goals it
 * fed from the members who could see it (#235 R2-3).
 */
export function retainedAccountPredicate(actor: HouseholdContext) {
  return and(
    readableMembershipPredicate(actor),
    eq(accounts.householdId, actor.householdId),
    or(eq(accounts.isPrivate, false), eq(accounts.ownerUserId, actor.userId)),
  )!;
}

export function visibleAccountPredicate(actor: HouseholdContext) {
  return and(retainedAccountPredicate(actor), isNull(accounts.deletedAt))!;
}

/**
 * A transaction as retained history (a goal's activity row citing it): the
 * same privacy as a live one, but a soft-deleted row still counts as what it
 * was, so a deletion never turns its history into a hidden source.
 */
function transactionPrivacyPredicate(actor: HouseholdContext) {
  return and(
    readableMembershipPredicate(actor),
    eq(transactions.householdId, actor.householdId),
    or(eq(transactions.isPrivate, false), eq(transactions.ownerUserId, actor.userId)),
  )!;
}

export function retainedTransactionPredicate(actor: HouseholdContext) {
  return and(transactionPrivacyPredicate(actor), sql`exists (select 1 from ${accounts} where ${and(
    eq(accounts.id, transactions.accountId), retainedAccountPredicate(actor),
  )})`)!;
}

/** A retained transaction can establish audience only while its account is visible and live. */
export function retainedTransactionOnVisibleAccountPredicate(actor: HouseholdContext) {
  return and(transactionPrivacyPredicate(actor), sql`exists (select 1 from ${accounts} where ${and(
    eq(accounts.id, transactions.accountId), visibleAccountPredicate(actor),
  )})`)!;
}

export function visibleTransactionPredicate(actor: HouseholdContext) {
  return and(retainedTransactionOnVisibleAccountPredicate(actor), isNull(transactions.deletedAt))!;
}
