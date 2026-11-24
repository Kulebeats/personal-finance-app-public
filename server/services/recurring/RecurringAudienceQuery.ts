import { and, desc, eq, gte, lte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  accounts, categories, households, merchants, recurringTransactionHistory, recurringTransactionLinks,
  recurringTransactions, transactions,
  type RecurringTransactionHistory, type RecurringTransactionLink,
} from "@shared/schema";
import type { TransactionType } from "../../utils/withTransaction";
import { db } from "../../db";
import {
  readableMembershipPredicate, retainedTransactionOnVisibleAccountPredicate, visibleAccountPredicate, visibleTransactionPredicate,
} from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { NotFoundError } from "../../utils/errorHandler";
import { ruleNotEndedPredicate, upcomingDatePredicate } from "../../repositories/RecurringRepository";
import { householdToday } from "../householdCalendarToday";
import { recurringQueryRepository } from "../../repositories/RecurringQueryRepository";
import { PATTERN_ORIGIN_ACTION, visiblePatternOriginPredicate } from "./RecurringPatternProvenance";
import { DENOMINATION_ACTION, DENOMINATION_INVALIDATED_ACTION, verifiedRecurringCurrencySql, withRecurringDefinitionMetadata, type RecurringLinkUnits, type VisibleRecurringRule } from "./RecurringDenomination";

/** Audience filter for ordinary HTTP rule reads; scheduler queries keep their own scope.
 * Legacy rows without surviving source history still require durable origin provenance.
 */
export function visibleRulePredicate(actor: HouseholdContext) {
  const direct = alias(transactions, "recurring_direct_source");
  // Match the guarded JSON-to-UUID cast already used by session-store.ts.
  const uuidPattern = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
  const inaccessibleHistoryStates = [recurringTransactionHistory.previousState, recurringTransactionHistory.newState].map(state => {
    const referenceId = (field: string) => sql`case when (${state}->>${field}) ~* ${uuidPattern}
      then (${state}->>${field})::uuid end`;
    return or(
      and(sql`${state} ? 'accountId'`, sql`not exists (
        select 1 from ${accounts} where ${accounts.id} = (${referenceId("accountId")})
          and ${visibleAccountPredicate(actor)}
      )`),
      // Clearing optional references is valid; malformed non-null values fail closed.
      and(sql`${state}->>'categoryId' is not null`, sql`not exists (
        select 1 from ${categories} where ${categories.id} = (${referenceId("categoryId")})
          and ${eq(categories.householdId, actor.householdId)} and ${isNull(categories.deletedAt)}
      )`),
      and(sql`${state}->>'merchantId' is not null`, sql`not exists (
        select 1 from ${merchants} where ${merchants.id} = (${referenceId("merchantId")})
          and ${eq(merchants.householdId, actor.householdId)}
      )`),
    )!;
  });
  const visibleSource = sql`exists (
    select 1 from ${transactions} where ${eq(transactions.id, recurringTransactionLinks.transactionId)}
      and ${retainedTransactionOnVisibleAccountPredicate(actor)}
      and (${recurringTransactions.detectionMethod} <> 'suggested' or (${transactions.currency} = 'ZMW'
        and exists (select 1 from ${accounts} where ${accounts.id} = ${transactions.accountId} and ${accounts.currency} = 'ZMW')))
  )`;
  const visibleHistorySource = sql`exists (
    select 1 from ${transactions} where ${eq(transactions.id, recurringTransactionHistory.linkedTransactionId)}
      and ${retainedTransactionOnVisibleAccountPredicate(actor)}
      and (${recurringTransactions.detectionMethod} <> 'suggested' or (${transactions.currency} = 'ZMW'
        and exists (select 1 from ${accounts} where ${accounts.id} = ${transactions.accountId} and ${accounts.currency} = 'ZMW')))
  )`;

  return and(
    readableMembershipPredicate(actor),
    eq(recurringTransactions.householdId, actor.householdId),
    sql`exists (
      select 1 from ${accounts} where ${eq(accounts.id, recurringTransactions.accountId)}
        and ${visibleAccountPredicate(actor)}
    )`,
    or(isNull(recurringTransactions.categoryId), sql`exists (
      select 1 from ${categories} where ${eq(categories.id, recurringTransactions.categoryId)}
        and ${eq(categories.householdId, actor.householdId)} and ${isNull(categories.deletedAt)}
    )`),
    or(isNull(recurringTransactions.merchantId), sql`exists (
      select 1 from ${merchants} where ${eq(merchants.id, recurringTransactions.merchantId)}
        and ${eq(merchants.householdId, actor.householdId)}
    )`),
    or(eq(recurringTransactions.detectionMethod, "manual"), and(
      eq(recurringTransactions.detectionMethod, "suggested"), visiblePatternOriginPredicate(actor),
      sql`exists (select 1 from ${accounts} where ${eq(accounts.id, recurringTransactions.accountId)} and ${eq(accounts.currency, "ZMW")})`,
    )),
    // Normal signed creates can be pointer-only. A foreign household's reverse
    // UUID claim is not owned provenance and cannot block this household's rule.
    sql`not exists (select 1 from ${transactions} as ${direct} where ${direct.recurringTransactionId} = ${recurringTransactions.id}
      and ${eq(direct.householdId, actor.householdId)}
      and not exists (select 1 from ${transactions} where ${transactions.id} = ${direct.id}
        and ${retainedTransactionOnVisibleAccountPredicate(actor)}
        and (${transactions.categoryId} is null or exists (select 1 from ${categories} where ${categories.id} = ${transactions.categoryId} and ${eq(categories.householdId, actor.householdId)}))
        and (${transactions.merchantId} is null or exists (select 1 from ${merchants} where ${merchants.id} = ${transactions.merchantId} and ${eq(merchants.householdId, actor.householdId)}))
        and (${recurringTransactions.detectionMethod} <> 'suggested' or (${transactions.currency} = 'ZMW'
          and exists (select 1 from ${accounts} where ${accounts.id} = ${transactions.accountId} and ${accounts.currency} = 'ZMW')))))`,
    sql`not exists (
      select 1 from ${recurringTransactionLinks}
      where ${eq(recurringTransactionLinks.recurringTransactionId, recurringTransactions.id)}
        and not ${visibleSource}
    )`,
    sql`not exists (select 1 from ${recurringTransactionHistory} where ${eq(recurringTransactionHistory.recurringTransactionId, recurringTransactions.id)} and (
      (${inArray(recurringTransactionHistory.action, ["linked", "unlinked", "processed"])} and ${isNull(recurringTransactionHistory.linkedTransactionId)})
      or (${isNotNull(recurringTransactionHistory.linkedTransactionId)} and not ${visibleHistorySource})
      or ${or(...inaccessibleHistoryStates)}
    ))`,
  )!;
}

export async function listVisibleRecurringRules(
  actor: HouseholdContext,
  options?: { includeInactive?: boolean; includePaused?: boolean; withinDays?: number; from?: string; to?: string },
  tx?: TransactionType,
): Promise<VisibleRecurringRule[]> {
  const reader = tx ?? db;
  const includeInactive = options?.includeInactive;
  const withinDays = options?.withinDays;
  const today = !includeInactive || withinDays !== undefined ? await householdToday(reader, actor.householdId) : undefined;
  const rows = await reader.select({ rule: recurringTransactions, currency: verifiedRecurringCurrencySql() }).from(recurringTransactions).where(and(
    visibleRulePredicate(actor),
    // R14: a rule past its inclusive end date is ended, not active, even before processing marks it.
    !includeInactive && today ? and(eq(recurringTransactions.isActive, true), ruleNotEndedPredicate(today)) : undefined,
    options?.includePaused ? undefined : eq(recurringTransactions.isPaused, false),
    options?.from ? gte(recurringTransactions.nextDueDate, options.from) : undefined,
    options?.to ? lte(recurringTransactions.nextDueDate, options.to) : undefined,
    withinDays !== undefined && today ? upcomingDatePredicate(today, withinDays) : undefined,
  )).orderBy(recurringTransactions.nextDueDate);
  return rows.map(({ rule, currency }) => withRecurringDefinitionMetadata(rule, currency));
}

export async function getVisibleRecurringSummary(actor: HouseholdContext) {
  const today = await householdToday(db, actor.householdId);
  const rows = await db.select({
    rule: recurringTransactions,
    upcoming: sql<boolean>`${upcomingDatePredicate(today, 7)}`,
    currency: verifiedRecurringCurrencySql(),
  }).from(recurringTransactions).where(and(
    visibleRulePredicate(actor),
    eq(recurringTransactions.isActive, true),
    eq(recurringTransactions.isPaused, false),
  ));
  const [household] = await db.select({ currency: households.currency }).from(households)
    .where(eq(households.id, actor.householdId));
  if (!household?.currency) throw new NotFoundError("Household");
  return recurringQueryRepository.summarize(rows, household.currency);
}

export async function getVisibleRecurringRuleById(id: string, actor: HouseholdContext, tx?: TransactionType): Promise<VisibleRecurringRule> {
  const [row] = await (tx ?? db).select({ rule: recurringTransactions, currency: verifiedRecurringCurrencySql() }).from(recurringTransactions)
    .where(and(eq(recurringTransactions.id, id), visibleRulePredicate(actor)))
    .limit(1);
  if (!row) throw new NotFoundError("Recurring rule");
  return withRecurringDefinitionMetadata(row.rule, row.currency);
}

/** The parent and child rows share one statement snapshot, including empty rules. */
export async function getVisibleRecurringHistory(
  id: string, actor: HouseholdContext, limit: number,
): Promise<RecurringTransactionHistory[]> {
  const rows = await db.select({ ruleId: recurringTransactions.id, history: recurringTransactionHistory })
    .from(recurringTransactions)
    .leftJoin(recurringTransactionHistory, and(eq(recurringTransactionHistory.recurringTransactionId, recurringTransactions.id),
      sql`${recurringTransactionHistory.action} not in (${PATTERN_ORIGIN_ACTION}, ${DENOMINATION_ACTION}, ${DENOMINATION_INVALIDATED_ACTION})`))
    .where(and(eq(recurringTransactions.id, id), visibleRulePredicate(actor)))
    .orderBy(desc(recurringTransactionHistory.createdAt), desc(recurringTransactionHistory.id))
    .limit(limit);
  if (!rows.length) throw new NotFoundError("Recurring rule");
  return rows.flatMap(({ history }) => history ? [history] : []);
}

export async function getVisibleRecurringLinks(id: string, actor: HouseholdContext): Promise<Array<RecurringTransactionLink & RecurringLinkUnits>> {
  const rows = await db.select({ ruleId: recurringTransactions.id, link: recurringTransactionLinks,
    liveTransactionId: transactions.id, actualCurrency: transactions.currency, expectedCurrency: verifiedRecurringCurrencySql() })
    .from(recurringTransactions)
    .leftJoin(recurringTransactionLinks, eq(recurringTransactionLinks.recurringTransactionId, recurringTransactions.id))
    .leftJoin(transactions, and(eq(transactions.id, recurringTransactionLinks.transactionId),
      visibleTransactionPredicate(actor)))
    .where(and(eq(recurringTransactions.id, id), visibleRulePredicate(actor)))
    .orderBy(desc(recurringTransactionLinks.createdAt));
  if (!rows.length) throw new NotFoundError("Recurring rule");
  return rows.flatMap(({ link, liveTransactionId, actualCurrency, expectedCurrency }) =>
    link && liveTransactionId ? [{ ...link, actualCurrency: actualCurrency ?? null, expectedCurrency }] : []);
}
