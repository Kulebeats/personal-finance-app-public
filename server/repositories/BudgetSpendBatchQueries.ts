import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { accounts, categories, categoryGroups, transactions, transactionSplits } from "@shared/schema";
import { isCurrencyCode } from "@shared/denomination";
import { db } from "../db";
import { readableMembershipPredicate, visibleTransactionPredicate } from "../core/authz/transaction-visibility";
import { ConflictError, ForbiddenError } from "../core/errors";
import { Money } from "../core/money";
import { BudgetDenominationUnavailable } from "../core/money/budget-denomination";
import { assertBudgetReadContext, type BudgetReadContext } from "./BudgetReadContext";
import { budgetFlowRates } from "./fx/budgetFlowRates";
import { BUDGET_GROUP_TYPES } from "./budgetGroupTypes";

export type BudgetSpendFlow = { categoryId: string; groupId: string | null; type: string; date: string; currency: string | null; amount: string; invalid: boolean };
export type BudgetSpendInputs = { allowed: boolean; flows: BudgetSpendFlow[]; invalidSplits: boolean;
  quotes: Array<{ from: string; date: string; rate: string }> };
export type BudgetSpentBatch = { byCategoryId: Map<string, Money>; byCategoryGroupId: Map<string, Money>; flexTotal: Money };

async function readInputs(householdId: string, from: string, to: string, currency: string, context: BudgetReadContext,
  categoryIds: string[], groupIds: string[], categoryTypes: Map<string, "income" | "expense">, groupTypes: Map<string, "income" | "expense">, includeFlex: boolean, splitOnly: boolean) {
  const permitted = context.kind === "actor" ? readableMembershipPredicate(context.actor) : sql`true`;
  const visible = context.kind === "actor" ? visibleTransactionPredicate(context.actor) : and(
    eq(transactions.householdId, householdId), isNull(transactions.deletedAt),
    context.sharedOnly ? eq(transactions.isPrivate, false) : sql`true`,
    sql`exists(select 1 from ${accounts} where ${accounts.id}=${transactions.accountId}
      and ${accounts.householdId}=${householdId}::uuid and ${accounts.deletedAt} is null
      and ${context.sharedOnly ? eq(accounts.isPrivate, false) : sql`true`})`,
  );
  const requested = or(...(["expense", "income"] as const).flatMap(type => [
    and(inArray(sql`c.id`, categoryIds.filter(id => (categoryTypes.get(id) ?? "expense") === type)), sql`a.type=${type}`),
    and(inArray(sql`c.group_id`, groupIds.filter(id => (groupTypes.get(id) ?? "expense") === type)), sql`a.type=${type}`),
  ]), includeFlex ? sql`c.group_id is not null and a.type='expense'` : sql`false`);
  // One statement observes membership, account/transaction privacy, allocation
  // state and the independently guarded provider store in the same MVCC cut.
  const result = await db.execute<BudgetSpendInputs>(sql`with eligible_categories as (
    select c.id,c.group_id,g.type from ${categories} c left join ${categoryGroups} g
      on g.id=c.group_id and g.household_id=${householdId}::uuid
    where c.household_id=${householdId}::uuid and c.deleted_at is null and c.is_archived=false and c.include_in_budget=true
      and (c.group_id is null or (g.id is not null and g.is_archived=false and g.type in ${BUDGET_GROUP_TYPES}))
  ), visible_parents as (
    select ${transactions.id} as id,${transactions.categoryId} as category_id,${transactions.amount} as amount,
      ${transactions.currency} as currency,${transactions.date} as date,${transactions.type} as type
    from ${transactions} where ${and(visible, permitted, eq(transactions.isPending, false),
      sql`${transactions.status} IS DISTINCT FROM 'pending'`, eq(transactions.isExcludedFromBudget, false),
      gte(transactions.date, from), lte(transactions.date, to))} and ${transactions.type} in ('expense','income')
  ), allocations as (
    select p.id as parent_id,p.category_id,p.amount,p.currency,p.date,p.type from visible_parents p
      where not exists(select 1 from ${transactionSplits} s where s.transaction_id=p.id) and ${!splitOnly}
    union all
    select p.id,s.category_id,s.amount,p.currency,p.date,p.type from visible_parents p
      inner join ${transactionSplits} s on s.transaction_id=p.id
  ), eligible_flows as (
    select a.*,c.group_id from allocations a inner join eligible_categories c on c.id=a.category_id
      and (c.group_id is null or a.type::text=case when c.type='income' then 'income' else 'expense' end)
    where ${requested}
  ), grouped_flows as (
    select category_id,group_id,type,date,currency,sum(amount) as amount,
      bool_or(amount<0 or amount::text !~ '^[0-9]+([.][0-9]+)?$') as invalid
    from eligible_flows group by category_id,group_id,type,date,currency
  ), invalid_splits as (
    select p.id from visible_parents p inner join ${transactionSplits} s on s.transaction_id=p.id
    where exists(select 1 from eligible_flows f where f.parent_id=p.id)
    group by p.id,p.amount having sum(s.amount) is distinct from p.amount
      or bool_or(s.amount<0 or s.amount::text !~ '^[0-9]+([.][0-9]+)?$')
  ), selected_quotes as (
    ${budgetFlowRates(householdId, currency)}
  ) select ${permitted} as allowed,
    coalesce((select jsonb_agg(jsonb_build_object('categoryId',category_id::text,'groupId',group_id::text,
      'type',type::text,'date',to_char(date,'YYYY-MM-DD'),'currency',currency,'amount',amount::text,'invalid',invalid)
      order by category_id,type,date,currency) from grouped_flows),'[]'::jsonb) as flows,
    coalesce((select jsonb_agg(jsonb_build_object('from',from_currency,'date',to_char(effective_date,'YYYY-MM-DD'),
      'rate',rate::text) order by from_currency,effective_date) from selected_quotes where rate is not null),'[]'::jsonb) as quotes,
    exists(select 1 from invalid_splits) as "invalidSplits"`);
  const row = result.rows[0];
  if (!row?.allowed) throw new ForbiddenError("Budget progress access denied");
  return row;
}

export function assembleBudgetSpentBatch(input: BudgetSpendInputs, categoryIds: string[], groupIds: string[], currency: string,
  categoryTypes: Map<string, "income" | "expense">, groupTypes: Map<string, "income" | "expense">, includeFlex: boolean): BudgetSpentBatch {
  if (input.invalidSplits) throw new BudgetDenominationUnavailable();
  const byCategoryId = new Map<string, Money>(), byCategoryGroupId = new Map<string, Money>();
  let flexTotal = Money.zero(currency);
  for (const flow of input.flows) {
    const category = categoryIds.includes(flow.categoryId) && flow.type === (categoryTypes.get(flow.categoryId) ?? "expense");
    const group = flow.groupId !== null && groupIds.includes(flow.groupId) && flow.type === (groupTypes.get(flow.groupId) ?? "expense");
    const flex = includeFlex && flow.groupId !== null && flow.type === "expense";
    if (!category && !group && !flex) continue;
    if (flow.invalid || !isCurrencyCode(flow.currency)) throw new BudgetDenominationUnavailable();
    let source: Money;
    try { source = new Money(flow.amount, flow.currency); } catch { throw new BudgetDenominationUnavailable(); }
    if (!source.amount.isFinite() || source.isNegative()) throw new BudgetDenominationUnavailable();
    if (source.isZero()) continue;
    let value: Money;
    if (source.currency === currency) value = source;
    else {
      const quote = input.quotes.find(row => row.from === source.currency && row.date === flow.date);
      let rate: Money;
      try { rate = new Money(quote?.rate ?? "NaN", source.currency); } catch { throw new BudgetDenominationUnavailable(); }
      if (!rate.amount.isFinite() || rate.isZero() || rate.isNegative()) throw new BudgetDenominationUnavailable();
      value = new Money(source.amount.times(rate.amount), currency);
    }
    if (category) byCategoryId.set(flow.categoryId, (byCategoryId.get(flow.categoryId) ?? Money.zero(currency)).add(value));
    if (group && flow.groupId) byCategoryGroupId.set(flow.groupId, (byCategoryGroupId.get(flow.groupId) ?? Money.zero(currency)).add(value));
    if (flex) flexTotal = flexTotal.add(value);
  }
  return { byCategoryId, byCategoryGroupId, flexTotal };
}

/** Validate a fresh audience cut before returning either totals or missing-rate
 * failures. A withdrawn private source cannot survive in a retry or FX oracle. */
export async function calculateBudgetSpentBatch(householdId: string, categoryIds: string[], groupIds: string[], from: string, to: string,
  currency: string, categoryTypes: Map<string, "income" | "expense">, groupTypes: Map<string, "income" | "expense">,
  context: BudgetReadContext, includeFlex = true, splitOnly = false): Promise<BudgetSpentBatch> {
  assertBudgetReadContext(householdId, context);
  if (!isCurrencyCode(currency)) throw new BudgetDenominationUnavailable();
  for (let attempt = 0; attempt < 3; attempt++) {
    const input = await readInputs(householdId, from, to, currency, context, categoryIds, groupIds, categoryTypes, groupTypes, includeFlex, splitOnly);
    let result: BudgetSpentBatch | undefined, failure: BudgetDenominationUnavailable | undefined;
    try { result = assembleBudgetSpentBatch(input, categoryIds, groupIds, currency, categoryTypes, groupTypes, includeFlex); }
    catch (error) { if (error instanceof BudgetDenominationUnavailable) failure = error; else throw error; }
    const current = await readInputs(householdId, from, to, currency, context, categoryIds, groupIds, categoryTypes, groupTypes, includeFlex, splitOnly);
    if (JSON.stringify(input) !== JSON.stringify(current)) continue;
    if (failure) throw failure;
    return result!;
  }
  throw new ConflictError("Budget progress inputs changed. Please try again.");
}

/** Legacy rule/recurring split reconciliation remains available with an
 * explicitly named reader and denomination; no missing-actor HTTP fallback. */
export async function calculateCategorySpentSplit(householdId: string, categoryIds: string[], from: string, to: string,
  context: BudgetReadContext, currency: string): Promise<Array<{ categoryId: string; type: string; total: string }>> {
  const rows: Array<{ categoryId: string; type: string; total: string }> = [];
  for (const direction of ["expense", "income"] as const) {
    const batch = await calculateBudgetSpentBatch(householdId, categoryIds, [], from, to, currency,
      new Map<string, "income" | "expense">(categoryIds.map(id => [id, direction])), new Map<string, "income" | "expense">(), context, false, true);
    for (const [categoryId, value] of Array.from(batch.byCategoryId.entries())) rows.push({ categoryId, type: direction, total: value.toString() });
  }
  return rows;
}
