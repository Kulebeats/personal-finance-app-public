import { createHash } from "node:crypto";
import { and, eq, getTableColumns, sql, type SQLWrapper } from "drizzle-orm";
import { recurringTransactionHistory, recurringTransactions, type RecurringTransaction } from "@shared/schema";
import { db } from "../../db";
import { Money } from "../../core/money";
import type { TransactionType } from "../../utils/withTransaction";
import { ValidationError } from "../../utils/errorHandler";

export const DENOMINATION_ACTION = "denomination_confirmed_v1";
export const DENOMINATION_INVALIDATED_ACTION = "denomination_invalidated_v1";
export const denominationConfirmationIssue = "Confirm the entered amount in ZMW when editing this recurring rule before processing. Its stored denomination is unproven.";
export type DenominationSource = "pattern" | "manual_creation" | "manual_confirmation" | "known_unit_edit" | "trusted_recovery";
export type VisibleRecurringRule = RecurringTransaction & { verifiedCurrency: "ZMW" | null; definitionToken: string };
/** Units of a link's amounts: the linked row's own currency and the rule's proven unit (null when unproven). */
export type RecurringLinkUnits = { actualCurrency: string | null; expectedCurrency: "ZMW" | null };

/** All stored definition fields, including revision and destination, are observed together. */
export function recurringDefinitionToken(rule: RecurringTransaction): string {
  const record = rule as unknown as Record<string, unknown>;
  const fields = Object.keys(getTableColumns(recurringTransactions)).sort();
  return createHash("sha256").update(JSON.stringify(fields.map(key => [key, record[key]]))).digest("hex");
}
export function withRecurringDefinitionMetadata(rule: RecurringTransaction, currency: "ZMW" | null): VisibleRecurringRule {
  return { ...rule, verifiedCurrency: currency, definitionToken: recurringDefinitionToken(rule) };
}

/** The rule as a DTO source: its proven unit (null when unproven) and definition token. */
export async function attachRecurringDefinition(rule: RecurringTransaction, householdId: string, tx?: TransactionType): Promise<VisibleRecurringRule> {
  return withRecurringDefinitionMetadata(rule, await getVerifiedRecurringRuleCurrency(rule.id, householdId, tx));
}

/** Once observed unproven, returning to an older matching amount cannot resurrect an old receipt. */
export async function invalidateRecurringDenomination(tx: TransactionType, ruleId: string, performedBy: string) {
  await tx.insert(recurringTransactionHistory).values({ recurringTransactionId: ruleId, action: DENOMINATION_INVALIDATED_ACTION,
    newState: { version: 1, reason: "unproven_definition_change" }, performedBy, createdAt: sql`clock_timestamp()` });
}

/** Call only with an explicitly supplied or already verified unit, while holding the definition lock. */
export async function recordRecurringDenomination(
  tx: TransactionType, rule: RecurringTransaction, currency: string, performedBy: string | null, source: DenominationSource,
) {
  if (currency !== "ZMW") throw new ValidationError("Recurring denomination is not supported. Confirm a ZMW amount or wait for multi-currency recurring support.");
  await tx.insert(recurringTransactionHistory).values({ recurringTransactionId: rule.id, action: DENOMINATION_ACTION,
    newState: { version: 1, currency, amount: new Money(rule.amount, currency).toString(), accountId: rule.accountId, source },
    performedBy, createdAt: sql`clock_timestamp()` });
}

/** Composable scalar evidence at the caller's SQL snapshot. Apply recipient audience independently, before limits/aggregation. */
export function verifiedRecurringCurrencySql(columns: { id: SQLWrapper; amount: SQLWrapper; accountId: SQLWrapper } = recurringTransactions) {
  const uuid = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
  // A single-table SELECT strips qualifiers from direct PgColumn chunks. Keep
  // these correlated references nested, or outer id silently binds receipt.id.
  const id = sql`${columns.id}`, amount = sql`${columns.amount}`, accountId = sql`${columns.accountId}`;
  return sql<"ZMW" | null>`(select case when
      receipt.action = ${DENOMINATION_ACTION}
      and jsonb_typeof(receipt.new_state) = 'object'
      and (select count(*) from jsonb_object_keys(case when jsonb_typeof(receipt.new_state) = 'object' then receipt.new_state else '{}'::jsonb end)) = 5
      and receipt.new_state->'version' = '1'::jsonb
      and receipt.new_state->>'currency' = 'ZMW'
      and receipt.new_state->>'source' in ('pattern', 'manual_creation', 'manual_confirmation', 'known_unit_edit', 'trusted_recovery')
      and jsonb_typeof(receipt.new_state->'amount') = 'string'
      and receipt.new_state->>'amount' = ${amount}::text
      and (case when (receipt.new_state->>'accountId') ~* ${uuid} then (receipt.new_state->>'accountId')::uuid end) = ${accountId}
    then 'ZMW' else null end
    from recurring_transaction_history receipt where receipt.recurring_transaction_id = ${id}
      and receipt.action in (${DENOMINATION_ACTION}, ${DENOMINATION_INVALIDATED_ACTION}) order by receipt.created_at desc, receipt.id desc limit 1)`;
}

/** Currency evidence does not itself confer access to the rule or its contributors. */
export async function getVerifiedRecurringRuleCurrency(id: string, householdId: string, tx?: TransactionType): Promise<"ZMW" | null> {
  const [row] = await (tx ?? db).select({ currency: verifiedRecurringCurrencySql() }).from(recurringTransactions)
    .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.householdId, householdId)));
  return row?.currency ?? null;
}
