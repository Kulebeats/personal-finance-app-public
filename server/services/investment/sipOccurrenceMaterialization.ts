import { and, eq } from "drizzle-orm";
import { accounts, investmentSipOccurrenceFences, investmentSipOccurrences,
  recurringInvestments, securities } from "@shared/schema";
import type { TransactionType } from "../../utils/withTransaction";
import { sipExecutionPlan, type SipExecutionAuthority } from "./sipExecutionAuthorization";

/** A standing mandate supplies schedule facts only, never actual fill facts.
 * The caller holds its live author and original plan locks until commit. */
export async function materializeSipOccurrence(tx: TransactionType, authority: SipExecutionAuthority,
  scheduledDate: string, nextExecutionDate: string): Promise<boolean> {
  const plan = sipExecutionPlan(tx, authority);
  if (!plan.securityId || plan.nextExecutionDate !== scheduledDate) throw new Error("Invalid occurrence source");
  const [account] = await tx.select().from(accounts).where(and(
    eq(accounts.id, plan.accountId), eq(accounts.householdId, plan.householdId),
  )).for("share");
  if (!account || account.deletedAt || (account.isPrivate && account.ownerUserId !== authority.grant.authorUserId)) {
    throw new Error("Occurrence custody is unavailable");
  }
  const [security] = await tx.select().from(securities).where(eq(securities.id, plan.securityId)).for("share");
  if (!security || security.type === "tbill" || security.currency !== plan.currency) {
    throw new Error("Occurrence denomination is unavailable");
  }
  const [existing] = await tx.select().from(investmentSipOccurrenceFences).where(and(
    eq(investmentSipOccurrenceFences.planId, plan.id),
    eq(investmentSipOccurrenceFences.originalDueDate, scheduledDate),
  ));
  if (existing) return false;
  await tx.insert(investmentSipOccurrenceFences).values({
    planId: plan.id, originalDueDate: scheduledDate, terminal: false,
  });
  await tx.insert(investmentSipOccurrences).values({
    planId: plan.id, originalDueDate: scheduledDate, householdId: plan.householdId,
    accountId: plan.accountId, securityId: plan.securityId, plannedAmount: plan.amount,
    currency: plan.currency, authorizedFrequency: authority.terms.frequency,
    authorizedInitialDate: authority.terms.initialDate, occurrenceRevision: 0, state: "pending",
  });
  await tx.update(recurringInvestments).set({ nextExecutionDate, updatedAt: new Date() })
    .where(eq(recurringInvestments.id, plan.id));
  return true;
}
