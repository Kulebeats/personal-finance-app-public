import { and, notInArray, or, sql, type SQL } from "drizzle-orm";
import { accounts, goalActivityLog, investmentTransactions, transactions } from "@shared/schema";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { retainedAccountPredicate, retainedTransactionPredicate } from "./transaction-visibility";
import { visibleInvestmentTransactionPredicate } from "./investment-visibility";

function visibleReference(key: string, requiredTypes: string[], visibleSource: SQL) {
  const reference = sql`${goalActivityLog.metadata}->>${key}`;
  const optional = requiredTypes.length
    ? notInArray(goalActivityLog.activityType, requiredTypes)
    : sql`true`;
  return or(
    and(sql`${reference} is null`, optional),
    and(sql`jsonb_typeof(${goalActivityLog.metadata}->${key}) = 'string'`, visibleSource),
  )!;
}

function visibleOptionalAccount(actor: HouseholdContext, parent: SQL, key: string) {
  const reference = sql`${parent}->>${key}`;
  return or(
    sql`${reference} is null`,
    and(sql`jsonb_typeof(${parent}->${key}) = 'string'`, sql`
      exists (select 1 from ${accounts} where ${accounts.id}::text = lower(${reference})
        and ${retainedAccountPredicate(actor)})`),
  )!;
}

/** Relinking keeps the old account in previousValues after the live pointer changes. */
function visibleRetainedAccounts(actor: HouseholdContext) {
  const metadata = sql`${goalActivityLog.metadata}`;
  const previous = sql`${metadata}->'previousValues'`;
  const fields = sql`${metadata}->'fields'`;
  return and(
    sql`(${previous} is null or jsonb_typeof(${previous}) in ('object', 'null'))`,
    sql`(${fields} is null or jsonb_typeof(${fields}) in ('array', 'null'))`,
    ...["linkedAccountId", "debtAccountId"].flatMap(key => [
      visibleOptionalAccount(actor, metadata, key),
      visibleOptionalAccount(actor, previous, key),
      // A recorded account change with no old value cannot establish its prior source.
      sql`(not coalesce(${fields} @> ${JSON.stringify([key])}::jsonb, false)
        or (jsonb_typeof(${previous}) = 'object' and ${previous} ? ${key}))`,
    ]),
  )!;
}

/**
 * A source-edit `balance_synced` row written before #235 names no account
 * (R2-4). Old data is not backfilled: such a row stands only on the
 * transaction it cites, which the transactionId check above judges with its
 * account. A row that cites no transaction still fails closed.
 */
function legacySourceEdit() {
  const metadata = sql`${goalActivityLog.metadata}`;
  return and(
    sql`${goalActivityLog.activityType} = 'balance_synced'`,
    sql`${metadata}->'accountId' is null`,
    sql`${metadata}->>'trigger' = 'source_edited'`,
    sql`jsonb_typeof(${metadata}->'transactionId') = 'string'`,
  )!;
}

/** Resolve retained source IDs independently of a link that may have been removed. */
export function visibleGoalActivitySources(actor: HouseholdContext) {
  return and(
    sql`(${goalActivityLog.metadata} is null or jsonb_typeof(${goalActivityLog.metadata}) = 'object')`,
    visibleRetainedAccounts(actor),
    visibleReference("transactionId", ["transaction_linked", "transaction_unlinked"], sql`
      exists (select 1 from ${transactions} where ${transactions.id}::text =
        lower(${goalActivityLog.metadata}->>'transactionId') and ${retainedTransactionPredicate(actor)})`),
    or(
      visibleReference("accountId", ["account_assigned", "account_unassigned", "balance_synced"], sql`
        exists (select 1 from ${accounts} where ${accounts.id}::text =
          lower(${goalActivityLog.metadata}->>'accountId') and ${retainedAccountPredicate(actor)})`),
      legacySourceEdit(),
    ),
    visibleReference("investmentTransactionId", [], sql`
      exists (select 1 from ${investmentTransactions} where ${investmentTransactions.id}::text =
        lower(${goalActivityLog.metadata}->>'investmentTransactionId') and ${visibleInvestmentTransactionPredicate(actor)})`),
  )!;
}
