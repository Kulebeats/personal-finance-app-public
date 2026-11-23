/**
 * Test fixture: give directly seeded recurring rules the ZMW denomination
 * receipt that every supported creation path records (manual, pattern,
 * from-transaction). Audience tests seed rules straight into the table; without
 * a receipt the rule's unit is unproven, so its DTO amount is unlabelled and it
 * is left out of the summary totals (FIN-05).
 */
import { inArray, sql } from "drizzle-orm";
import { recurringTransactionHistory, recurringTransactions } from "@shared/schema";
import { db } from "../../../db";
import { Money } from "../../../core/money";
import { DENOMINATION_ACTION } from "../../../services/recurring/RecurringDenomination";

export async function proveZmwDenomination(ruleIds: readonly string[]): Promise<void> {
  if (ruleIds.length === 0) return;
  const rules = await db.select({ id: recurringTransactions.id, amount: recurringTransactions.amount, accountId: recurringTransactions.accountId })
    .from(recurringTransactions).where(inArray(recurringTransactions.id, [...ruleIds]));
  if (rules.length === 0) return;
  await db.insert(recurringTransactionHistory).values(rules.map(rule => ({
    recurringTransactionId: rule.id,
    action: DENOMINATION_ACTION,
    newState: { version: 1, currency: "ZMW", amount: new Money(rule.amount, "ZMW").toString(), accountId: rule.accountId, source: "manual_creation" },
    performedBy: null,
    createdAt: sql`clock_timestamp()`,
  })));
}
