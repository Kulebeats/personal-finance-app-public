import { and, eq, gte, lte, sql } from "drizzle-orm";
import { accounts, budgetPeriods, budgets, categories, categoryGroups, householdMembers, households, providerFxQuotes, transactions, transactionSplits } from "@shared/schema";
import type { db } from "../db";
import { visibleTransactionPredicate } from "../core/authz/transaction-visibility";
import { ForbiddenError } from "../core/errors";
import { BUDGET_GROUP_TYPES } from "./budgetGroupTypes";

type ReadTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type BudgetPreviewInputs = {
  allowed: boolean; observedAt: string; targetPeriod: string; periods: string[]; currency: string | null;
  categories: Array<{ id: string; groupId: string | null; mode: string; type: string | null }>;
  flows: Array<{ categoryId: string; date: string; currency: string | null; type: "expense" | "income"; amount: string; invalid: boolean }>;
  quotes: Array<{ id: string; from: string; to: string; rate: string; provider: string; quotedAt: string; date: string; validThrough: string }>;
  budgets: Array<{ id: string; categoryId: string | null; categoryGroupId: string | null; amount: string | null; currency: string | null }>;
  overrides: Array<{ id: string; budgetId: string; from: string; to: string; amount: string; currency: string | null; version: number }>;
  invalidSplits: boolean;
};

/** Each invocation is one MVCC statement. Return explicit financial projections
 * and grouped flows, never an unbounded payload of raw transactions or notes. */
export async function readBudgetPreviewInputs(tx: ReadTransaction, householdId: string, userId: string, months: number, sharedOnly = false) {
  const visible = visibleTransactionPredicate({ householdId, userId, role: "member" });
  const result = await tx.execute<BudgetPreviewInputs>(sql`with allowed_member as (
    select 1 from ${householdMembers} where household_id=${householdId}::uuid and user_id=${userId}::uuid
      and role in ('owner','admin','member')
  ), clock as (
    select date_trunc('month',transaction_timestamp() at time zone 'UTC')::date as target,
      date_trunc('month',transaction_timestamp() at time zone 'UTC')::date - make_interval(months=>${months}::int) as first,
      transaction_timestamp() as observed
  ), base as (
    select currency from ${households} where id=${householdId}::uuid and exists(select 1 from allowed_member)
  ), eligible_categories as (
    select c.id,c.group_id,case when c.group_id is null then 'by_category' else g.budget_mode end as mode,g.type
    from ${categories} c left join ${categoryGroups} g on g.id=c.group_id and g.household_id=${householdId}::uuid
    where c.household_id=${householdId}::uuid and c.deleted_at is null and c.is_archived=false and c.include_in_budget=true
      and (c.group_id is null or (g.id is not null and g.is_archived=false and g.type in ${BUDGET_GROUP_TYPES}))
      and exists(select 1 from allowed_member)
  ), visible_parents as (
    select ${transactions.id} as id,${transactions.categoryId} as category_id,${transactions.amount} as amount,
      ${transactions.date} as date,${transactions.currency} as currency,${transactions.type} as type
    from ${transactions} cross join clock where ${and(visible,
      eq(transactions.isPending, false), sql`${transactions.status} IS DISTINCT FROM 'pending'`,
      eq(transactions.isExcludedFromBudget, false), gte(transactions.date, sql`clock.first::date`),
      lte(transactions.date, sql`clock.target-1`))}
      and ${transactions.type} in ('expense','income') and exists(select 1 from allowed_member)
      and ${sharedOnly ? and(eq(transactions.isPrivate, false), sql`exists(select 1 from ${accounts} where
        ${accounts.id}=${transactions.accountId} and ${accounts.isPrivate}=false)`) : sql`true`}
  ), allocations as (
    select p.id as parent_id,p.category_id,p.amount,p.currency,p.date,p.type from visible_parents p
    where not exists(select 1 from ${transactionSplits} s where s.transaction_id=p.id)
    union all
    select p.id,s.category_id,s.amount,p.currency,p.date,p.type from ${transactionSplits} s
      inner join visible_parents p on p.id=s.transaction_id
  ), eligible_flows as (
    select a.* from allocations a inner join eligible_categories c on c.id=a.category_id
      and (c.group_id is null or a.type::text=case when c.type='income' then 'income' else 'expense' end)
  ), grouped_flows as (
    select category_id,date,currency,type,sum(amount) as amount,
      bool_or(amount<0 or amount::text !~ '^[0-9]+([.][0-9]+)?$') as invalid
    from eligible_flows group by category_id,date,currency,type
  ), split_checks as (
    select p.id from visible_parents p inner join ${transactionSplits} s on s.transaction_id=p.id
    where exists(select 1 from eligible_flows f where f.parent_id=p.id)
    group by p.id,p.amount having sum(s.amount) is distinct from p.amount
      or bool_or(s.amount<0 or s.amount::text !~ '^[0-9]+([.][0-9]+)?$')
  ), selected_quotes as (
    select distinct on(q.from_currency,q.effective_date) q.* from ${providerFxQuotes} q cross join base cross join clock
    where q.to_currency=base.currency and q.from_currency<>base.currency and q.quoted_at<=clock.observed
      and q.provider in ('yahoo_finance','exchangerate_api') and q.valid_through>=q.effective_date
      and exists(select 1 from grouped_flows f where f.currency=q.from_currency and f.date=q.effective_date and f.amount<>0)
    order by q.from_currency,q.effective_date,q.quoted_at desc,q.provider
  ), current_budgets as (
    select b.id,b.category_id,b.category_group_id,b.amount,b.currency from ${budgets} b
    where b.household_id=${householdId}::uuid and b.is_active=true and b.is_flex_bucket=false
      and exists(select 1 from eligible_categories c where
        (c.mode='by_category' and c.id=b.category_id and b.category_group_id is null)
        or (c.mode='by_group' and c.group_id=b.category_group_id and b.category_id is null))
      and exists(select 1 from allowed_member)
  ), current_overrides as (
    select p.* from ${budgetPeriods} p inner join current_budgets b on b.id=p.budget_id cross join clock
    where p.start_date<=((clock.target+interval '1 month')::date-1) and p.end_date>=clock.target
  ) select exists(select 1 from allowed_member) as allowed,
    to_char(clock.observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "observedAt",
    to_char(clock.target,'YYYY-MM') as "targetPeriod",(select currency from base) as currency,
    (select jsonb_agg(to_char(clock.first+make_interval(months=>n),'YYYY-MM') order by n)
      from generate_series(0,${months}::int-1) n) as periods,
    coalesce((select jsonb_agg(jsonb_build_object('id',id::text,'groupId',group_id::text,'mode',mode,'type',type) order by id)
      from eligible_categories),'[]'::jsonb) as categories,
    coalesce((select jsonb_agg(jsonb_build_object('categoryId',category_id::text,'date',to_char(date,'YYYY-MM-DD'),
      'currency',currency,'type',type::text,'amount',amount::text,'invalid',invalid) order by category_id,date,currency,type) from grouped_flows),'[]'::jsonb) as flows,
    coalesce((select jsonb_agg(jsonb_build_object('id',id::text,'from',from_currency,'to',to_currency,'rate',rate::text,'provider',provider,
      'quotedAt',to_char(quoted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'date',to_char(effective_date,'YYYY-MM-DD'),'validThrough',to_char(valid_through,'YYYY-MM-DD')) order by from_currency,effective_date)
      from selected_quotes),'[]'::jsonb) as quotes,
    coalesce((select jsonb_agg(jsonb_build_object('id',id::text,'categoryId',category_id::text,'categoryGroupId',category_group_id::text,
      'amount',amount::text,'currency',currency) order by id) from current_budgets),'[]'::jsonb) as budgets,
    coalesce((select jsonb_agg(jsonb_build_object('id',id::text,'budgetId',budget_id::text,'from',to_char(start_date,'YYYY-MM-DD'),
      'to',to_char(end_date,'YYYY-MM-DD'),'amount',budget_amount::text,'currency',currency,'version',version) order by id)
      from current_overrides),'[]'::jsonb) as overrides,
    exists(select 1 from split_checks) as "invalidSplits" from clock`);
  const row = result.rows[0];
  if (!row?.allowed) throw new ForbiddenError("Budget preview access denied");
  return row;
}

/** Ignore elapsed request milliseconds; compare only fields used in the result,
 * including the complete current audience, calendar, rate and limit projection. */
export function budgetPreviewCut(input: BudgetPreviewInputs) {
  const { observedAt: _observedAt, ...financial } = input;
  return JSON.stringify(financial);
}
