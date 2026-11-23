import { desc, getTableColumns } from "drizzle-orm";
import { investmentTransactions } from "@shared/schema";
import { db } from "../../db";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { visibleInvestmentTransactionPredicate } from "../../core/authz/investment-visibility";
import { investmentNotesProjection } from "../../services/grz/instrumentIdentity";
import type { ListInvestmentTransactionsQuery } from "./investments.validation";

export function listVisibleInvestmentTransactions(actor: HouseholdContext, filters: ListInvestmentTransactionsQuery) {
  // R1-05: a GRZ sale or maturity names its instrument only to a viewer who sees its custody.
  return db.select({ ...getTableColumns(investmentTransactions), notes: investmentNotesProjection(actor) }).from(investmentTransactions)
    .where(visibleInvestmentTransactionPredicate(actor))
    .orderBy(desc(investmentTransactions.transactionDate), desc(investmentTransactions.id))
    .limit(filters.limit ?? 100);
}
