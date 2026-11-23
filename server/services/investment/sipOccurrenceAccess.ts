import { and, eq } from "drizzle-orm";
import { accounts, investmentSipOccurrences, recurringInvestments, securities } from "@shared/schema";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { NotFoundError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { TransactionType } from "../../utils/withTransaction";
import { SipOccurrenceConflict } from "./sipOccurrenceErrors";

export type SipOccurrence = typeof investmentSipOccurrences.$inferSelect;
export type SipOccurrencePlan = typeof recurringInvestments.$inferSelect;

/** Fence custody is resolved only through its SQL-immutable original parent. */
export async function lockSipOccurrencePlan(tx: TransactionType, actor: HouseholdContext, planId: string,
  mode: "share" | "update") {
  const [plan] = await tx.select().from(recurringInvestments).where(and(
    eq(recurringInvestments.id, planId), eq(recurringInvestments.householdId, actor.householdId),
  )).for(mode);
  if (!plan) throw new NotFoundError("Investment occurrence");
  return plan;
}

/** Initial visibility is discovery only. Writers take their authoritative
 * custody lock after the holding, preserving existing first-purchase order. */
export async function visibleSipOccurrenceAccount(tx: TransactionType, actor: HouseholdContext,
  accountId: string, lock = false) {
  const query = tx.select().from(accounts).where(and(eq(accounts.id, accountId), visibleAccountPredicate(actor)));
  const [account] = lock ? await query.for("share") : await query;
  if (!account) throw new NotFoundError("Investment occurrence");
  return account;
}

export async function lockSipOccurrence(tx: TransactionType, actor: HouseholdContext,
  plan: SipOccurrencePlan, scheduledDate: string) {
  const [occurrence] = await tx.select().from(investmentSipOccurrences).where(and(
    eq(investmentSipOccurrences.planId, plan.id),
    eq(investmentSipOccurrences.originalDueDate, scheduledDate),
    eq(investmentSipOccurrences.householdId, actor.householdId),
  )).for("update");
  if (occurrence && occurrence.accountId !== plan.accountId) throw new NotFoundError("Investment occurrence");
  return occurrence;
}

export async function lockSipOccurrenceInstrument(tx: TransactionType, occurrence: SipOccurrence) {
  const [security] = await tx.select().from(securities).where(eq(securities.id, occurrence.securityId)).for("share");
  if (!security || security.type === "tbill" || security.currency !== occurrence.currency) {
    throw new SipOccurrenceConflict("SOURCE_CHANGED");
  }
  return security;
}
