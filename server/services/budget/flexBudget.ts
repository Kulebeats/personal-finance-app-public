import { and, eq } from "drizzle-orm";
import { budgets, householdPreferences, households, type Budget } from "@shared/schema";
import { isCurrencyCode } from "@shared/denomination";
import { ConflictError } from "../../utils/errorHandler";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";

/**
 * The one way a household's flex budget is created.
 *
 * Every caller locks the household's preferences row first, so two creators
 * (the settings switch and ensureFlexBudget, or two of either) run one after
 * the other: the second sees the first one's bucket and creates nothing. The
 * bucket and its CREATE audit row are written in the caller's transaction, so
 * a failed audit insert rolls the bucket back (Rule 9).
 */
export interface FlexBudgetActor {
  readonly householdId: string;
  readonly userId: string;
  readonly ipAddress?: string;
}

export type HouseholdPreferences = typeof householdPreferences.$inferSelect;

/** Creates the preferences row if it is missing, then locks it until the transaction ends. */
export async function lockHouseholdPreferences(tx: TransactionType, householdId: string): Promise<HouseholdPreferences> {
  await tx.insert(householdPreferences).values({ householdId }).onConflictDoNothing();
  const [row] = await tx.select().from(householdPreferences)
    .where(eq(householdPreferences.householdId, householdId)).for("update");
  return row;
}

/** Returns the household's flex budget, creating and auditing it if none exists. */
export async function ensureFlexBudgetInTx(tx: TransactionType, actor: FlexBudgetActor, source: string): Promise<Budget> {
  await lockHouseholdPreferences(tx, actor.householdId);
  const [existing] = await tx.select().from(budgets)
    .where(and(eq(budgets.householdId, actor.householdId), eq(budgets.isFlexBucket, true))).limit(1);
  if (existing) return existing;
  // The bucket is held in the household's own currency. The column default
  // (ZMW) would put a non-ZMW household's only flex budget out of progress,
  // and a budget's currency cannot be changed afterwards (A-13). A household
  // with no stored currency reads as ZMW everywhere, so it does here too.
  const [household] = await tx.select({ currency: households.currency }).from(households)
    .where(eq(households.id, actor.householdId));
  const currency = household?.currency || "ZMW";
  if (!isCurrencyCode(currency)) throw new ConflictError("Household currency is unavailable");
  const [created] = await tx.insert(budgets).values({
    householdId: actor.householdId, name: "Flexible Budget", amount: "0", currency, period: "monthly", isActive: true, isFlexBucket: true,
  }).returning();
  await businessAuditService.logCreate({
    tx, userId: actor.userId, householdId: actor.householdId, entityType: "budget", entityId: created.id,
    ipAddress: actor.ipAddress, newValue: { name: created.name, amount: created.amount, isFlexBucket: true },
    metadata: { source },
  });
  return created;
}

export function ensureFlexBudget(actor: FlexBudgetActor, source: string): Promise<Budget> {
  return withTransaction((tx) => ensureFlexBudgetInTx(tx, actor, source));
}
