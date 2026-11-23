import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { accounts, holdings, investmentTransactions, transactions } from "@shared/schema";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { readableMembershipPredicate, visibleAccountPredicate, visibleTransactionPredicate } from "./transaction-visibility";

function visibleAccountLink(accountId: AnyPgColumn, actor: HouseholdContext) {
  return sql`exists (select 1 from ${accounts} where ${and(
    eq(accounts.id, accountId), visibleAccountPredicate(actor),
  )})`;
}

/** An activity row can expose all three sources: its account, its holding and
 * its posted cash receipt. Authorize each before selection or pagination; a
 * shared investment account never promotes a private receipt into shared data. */
export function visibleInvestmentTransactionPredicate(actor: HouseholdContext) {
  if (!actor) return sql`false`;
  return and(
    readableMembershipPredicate(actor),
    eq(investmentTransactions.householdId, actor.householdId),
    visibleAccountLink(investmentTransactions.accountId, actor),
    or(isNull(investmentTransactions.holdingId), sql`exists (select 1 from ${holdings} where ${and(
      eq(holdings.id, investmentTransactions.holdingId),
      eq(holdings.householdId, actor.householdId),
      visibleAccountLink(holdings.accountId, actor),
    )})`),
    or(isNull(investmentTransactions.linkedTransactionId), sql`exists (select 1 from ${transactions} where ${and(
      eq(transactions.id, investmentTransactions.linkedTransactionId), visibleTransactionPredicate(actor),
    )})`),
  )!;
}

/** A holding this reader may see: their household, through a visible account. */
export function visibleHoldingPredicate(actor: HouseholdContext) {
  return and(
    readableMembershipPredicate(actor),
    eq(holdings.householdId, actor.householdId),
    visibleAccountLink(holdings.accountId, actor),
  )!;
}
