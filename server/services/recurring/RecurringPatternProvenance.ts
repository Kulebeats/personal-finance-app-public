import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { accounts, categories, households, merchants, recurringTransactions, transactions } from "@shared/schema";
import { MAX_PATTERN_CONTRIBUTORS, patternSelectionSchema } from "@shared/recurring-pattern";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { visibleAccountPredicate, visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
export { getVerifiedRecurringRuleCurrency, verifiedRecurringCurrencySql } from "./RecurringDenomination";

export const PATTERN_ORIGIN_ACTION = "pattern_origin_v1";
export const patternOriginSchema = z.object({
  version: z.literal(1), currency: z.literal("ZMW"), selection: patternSelectionSchema,
  contributors: z.array(z.object({ transactionId: z.string().uuid(), accountId: z.string().uuid(),
    categoryId: z.string().uuid().nullable(), merchantId: z.string().uuid().nullable() }).strict()).min(2).max(MAX_PATTERN_CONTRIBUTORS),
}).strict().superRefine((marker, context) => {
  const ids = marker.contributors.map(source => source.transactionId);
  let group: unknown;
  try { group = JSON.parse(marker.selection.groupKey); } catch { group = null; }
  if (new Set(ids).size !== ids.length || JSON.stringify(ids) !== JSON.stringify(marker.selection.contributorIds) ||
      !Array.isArray(group) || group.length !== 3 || typeof group[0] !== "string" || !/^[a-z0-9-]*$/.test(group[0]) ||
      group[2] !== marker.currency || !["income", "expense"].includes(group[1])) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Inconsistent complete currency provenance" });
  }
});

/** An internal marker attests completeness, never the public sample or surviving links. */
export function visiblePatternOriginPredicate(actor: HouseholdContext) {
  const uuid = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
  const groupPattern = '^\\["[a-z0-9-]*","(income|expense)","ZMW"\\]$';
  const field = (name: string) => sql`entry->>${name}`;
  const reference = (name: string) => sql`case when (${field(name)}) ~* ${uuid} then (${field(name)})::uuid end`;
  const entries = sql`case when jsonb_typeof(origin.new_state->'contributors') = 'array' then origin.new_state->'contributors' else '[]'::jsonb end`;
  const selectedIds = sql`case when jsonb_typeof(origin.new_state->'selection'->'contributorIds') = 'array' then origin.new_state->'selection'->'contributorIds' else '[]'::jsonb end`;
  const validReference = (name: "categoryId" | "merchantId") => {
    const table = name === "categoryId" ? categories : merchants;
    return sql`(${field(name)} is null or exists (select 1 from ${table}
      where ${table.id} = (${reference(name)}) and ${eq(table.householdId, actor.householdId)}))`;
  };
  return sql`exists (
    select 1 from recurring_transaction_history origin
    where origin.recurring_transaction_id = ${recurringTransactions.id} and origin.action = ${PATTERN_ORIGIN_ACTION}
      and origin.new_state->>'version' = '1'
      and origin.new_state->>'currency' = 'ZMW'
      and jsonb_typeof(origin.new_state->'version') = 'number'
      and jsonb_typeof(origin.new_state) = 'object'
      and (select count(*) from jsonb_object_keys(case when jsonb_typeof(origin.new_state) = 'object' then origin.new_state else '{}'::jsonb end)) = 4
      and origin.new_state->'selection'->>'version' = '1'
      and jsonb_typeof(origin.new_state->'selection'->'version') = 'number'
      and jsonb_typeof(origin.new_state->'selection') = 'object'
      and (select count(*) from jsonb_object_keys(case when jsonb_typeof(origin.new_state->'selection') = 'object' then origin.new_state->'selection' else '{}'::jsonb end)) = 9
      and jsonb_typeof(origin.new_state->'selection'->'timezone') = 'string'
      and length(origin.new_state->'selection'->>'timezone') between 1 and 100
      and origin.new_state->'selection'->>'timezoneSource' in ('display', 'profile')
      and jsonb_typeof(origin.new_state->'selection'->'groupKey') = 'string'
      and length(origin.new_state->'selection'->>'groupKey') between 1 and 512
      and (origin.new_state->'selection'->>'groupKey') ~ ${groupPattern}
      and (origin.new_state->'selection'->>'startDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and (origin.new_state->'selection'->>'endDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and jsonb_typeof(origin.new_state->'selection'->'options') = 'object'
      and jsonb_typeof(origin.new_state->'selection'->'options'->'minOccurrences') = 'number'
      and jsonb_typeof(origin.new_state->'selection'->'options'->'lookbackMonths') = 'number'
      and not exists (select 1 from jsonb_object_keys(case when jsonb_typeof(origin.new_state->'selection'->'options') = 'object' then origin.new_state->'selection'->'options' else '{}'::jsonb end) key
        where key not in ('minOccurrences', 'lookbackMonths', 'confidenceThreshold', 'merchantId', 'categoryId'))
      and (not (origin.new_state->'selection'->'options' ? 'merchantId') or (origin.new_state->'selection'->'options'->>'merchantId') ~* ${uuid})
      and (not (origin.new_state->'selection'->'options' ? 'categoryId') or (origin.new_state->'selection'->'options'->>'categoryId') ~* ${uuid})
      and (origin.new_state->'selection'->'options'->>'minOccurrences') ~ '^(2|3|4|5|6|7|8|9|10|11|12)$'
      and (origin.new_state->'selection'->'options'->>'lookbackMonths') ~ '^([1-9]|1[0-9]|2[0-4])$'
      and case when jsonb_typeof(origin.new_state->'selection'->'options'->'confidenceThreshold') = 'number'
        then (origin.new_state->'selection'->'options'->>'confidenceThreshold')::numeric between 50 and 100 else false end
      and (origin.new_state->'selection'->>'fingerprint') ~ '^[0-9a-f]{64}$'
      and jsonb_array_length(${entries}) between 2 and ${MAX_PATTERN_CONTRIBUTORS}
      and jsonb_array_length(${selectedIds}) = jsonb_array_length(${entries})
      and ${selectedIds} = (select jsonb_agg(entry->'transactionId' order by ordinal) from jsonb_array_elements(${entries}) with ordinality as source(entry, ordinal))
      and (select count(distinct entry->>'transactionId') from jsonb_array_elements(${entries}) entry) = jsonb_array_length(${entries})
      and (select count(*) from recurring_transaction_history duplicate where duplicate.recurring_transaction_id = origin.recurring_transaction_id and duplicate.action = ${PATTERN_ORIGIN_ACTION}) = 1
      and exists (select 1 from ${households} where ${and(eq(households.id, actor.householdId), eq(households.currency, "ZMW"))})
      and not exists (
        select 1 from jsonb_array_elements(${entries}) entry
        where not (entry ? 'categoryId' and entry ? 'merchantId')
          or jsonb_typeof(entry) <> 'object'
          or (select count(*) from jsonb_object_keys(case when jsonb_typeof(entry) = 'object' then entry else '{}'::jsonb end)) <> 4
          or not (${selectedIds} @> jsonb_build_array(entry->>'transactionId'))
          or not exists (select 1 from ${transactions} where ${transactions.id} = (${reference("transactionId")})
            and ${visibleTransactionPredicate(actor)} and ${eq(transactions.currency, "ZMW")}
            and exists (select 1 from ${accounts} where ${accounts.id} = ${transactions.accountId} and ${eq(accounts.currency, "ZMW")})
            and (${transactions.categoryId} is null or exists (select 1 from ${categories} where ${categories.id} = ${transactions.categoryId} and ${eq(categories.householdId, actor.householdId)}))
            and (${transactions.merchantId} is null or exists (select 1 from ${merchants} where ${merchants.id} = ${transactions.merchantId} and ${eq(merchants.householdId, actor.householdId)})))
          or not exists (select 1 from ${accounts} where ${accounts.id} = (${reference("accountId")}) and ${visibleAccountPredicate(actor)} and ${eq(accounts.currency, "ZMW")})
          or not ${validReference("categoryId")} or not ${validReference("merchantId")}
      )
  )`;
}
