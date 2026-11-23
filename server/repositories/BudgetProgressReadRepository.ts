import { and, eq, isNull, sql } from "drizzle-orm";
import { accounts, budgetPeriods, budgets, categories, categoryGroups, householdMembers, householdPreferences, households, providerFxQuotes, transactions, transactionSplits, type Budget } from "@shared/schema";
import { db } from "../db";
import { readableMembershipPredicate, visibleTransactionPredicate } from "../core/authz/transaction-visibility";
import { ForbiddenError } from "../core/errors";
import { assertBudgetReadContext, type BudgetReadContext } from "./BudgetReadContext";
import { BUDGET_GROUP_TYPES } from "./budgetGroupTypes";
import type { BudgetSpendInputs } from "./BudgetSpendBatchQueries";

export interface BudgetProgressInputs extends BudgetSpendInputs, Record<string, unknown> {
  currency: string | null;
  readerRole: string | null;
  preferences: { autoRolloverBudget: boolean; rolloverPercentage: number; warningThreshold: number; alertThreshold: number };
  budgets: Array<Omit<Budget, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string }>;
  categorySettings: Array<{ id: string; groupId: string | null; rolloverEnabled: boolean | null; rolloverStartBalance: string | null }>;
  groupSettings: Array<{ id: string; type: string; rolloverEnabled: boolean }>;
  periods: Array<{ id: string; budgetId: string; from: string; to: string; amount: string; currency: string | null; rolloverIn?: string | null; version: number }>;
  lockTargets?: { transactions: string[]; accounts: string[]; categories: string[]; groups: string[]; budgets: string[]; periods: string[]; quotes: string[] };
}

/** Limits, preferences, identity, both months, audience and provider evidence
 * are projected in one database statement; no earlier metadata read is mixed in. */
export function budgetProgressInputsQuery(householdId: string, year: number, month: number, context: BudgetReadContext) {
  assertBudgetReadContext(householdId, context);
  const permitted = context.kind === "actor" ? readableMembershipPredicate(context.actor) : sql`true`;
  const visible = context.kind === "actor" ? visibleTransactionPredicate(context.actor) : and(
    eq(transactions.householdId, householdId), isNull(transactions.deletedAt),
    context.sharedOnly ? eq(transactions.isPrivate, false) : sql`true`,
    sql`exists(select 1 from ${accounts} where ${accounts.id}=${transactions.accountId} and ${accounts.householdId}=${householdId}::uuid
      and ${accounts.deletedAt} is null and ${context.sharedOnly ? eq(accounts.isPrivate, false) : sql`true`})`,
  );
  return sql`with clock as (
    select make_date(${year}::int,${month}::int,1) as target
  ), base as (
    select h.currency,coalesce(p.auto_rollover_budget,false) as auto_rollover,
      coalesce(p.rollover_percentage,100) as rollover_percentage,coalesce(p.budget_warning_threshold,75) as warning_threshold,
      coalesce(p.budget_danger_threshold,90) as alert_threshold from ${households} h
    left join ${householdPreferences} p on p.household_id=h.id where h.id=${householdId}::uuid and ${permitted}
  ), eligible_categories as (
    select c.* from ${categories} c left join ${categoryGroups} g on g.id=c.group_id and g.household_id=${householdId}::uuid
    where c.household_id=${householdId}::uuid and c.deleted_at is null and c.is_archived=false and c.include_in_budget=true
      and (c.group_id is null or (g.id is not null and g.is_archived=false and g.type in ${BUDGET_GROUP_TYPES}))
  ), eligible_groups as (
    select g.* from ${categoryGroups} g where g.household_id=${householdId}::uuid and g.is_archived=false and g.type in ${BUDGET_GROUP_TYPES}
  ), current_budgets as (
    select b.* from ${budgets} b where b.household_id=${householdId}::uuid and b.is_active=true and exists(select 1 from base)
      and (b.is_flex_bucket=true or exists(select 1 from eligible_categories c left join eligible_groups g on g.id=c.group_id
        where c.id=b.category_id and (c.group_id is null or g.budget_mode='by_category'))
        or exists(select 1 from eligible_groups g where g.id=b.category_group_id and g.budget_mode='by_group'))
  ), relevant_periods as (
    select p.id,p.budget_id,p.start_date,p.end_date,p.budget_amount,p.currency,p.version from ${budgetPeriods} p
      inner join current_budgets b on b.id=p.budget_id cross join clock
    where p.start_date<((clock.target+interval '1 month')::date)
  ), source_start as (
    select least(clock.target,coalesce((select min(date_trunc('month',created_at)::date) from current_budgets),clock.target),
      coalesce((select min(start_date) from relevant_periods),clock.target)) as first from clock
  ), visible_parents as (
    select ${transactions.id} as id,${transactions.accountId} as account_id,${transactions.categoryId} as category_id,${transactions.amount} as amount,
      ${transactions.currency} as currency,${transactions.date} as date,${transactions.type} as type from ${transactions} cross join clock cross join source_start
    where ${and(visible, permitted, eq(transactions.isPending, false), eq(transactions.isExcludedFromBudget, false),
      sql`${transactions.status} IS DISTINCT FROM 'pending'`)} and ${transactions.type} in ('expense','income')
      and ${transactions.date}>=source_start.first and ${transactions.date}<((clock.target+interval '1 month')::date)
  ), allocations as (
    select p.id as parent_id,p.category_id,p.amount,p.currency,p.date,p.type from visible_parents p
      where not exists(select 1 from ${transactionSplits} s where s.transaction_id=p.id)
    union all select p.id,s.category_id,s.amount,p.currency,p.date,p.type from visible_parents p inner join ${transactionSplits} s on s.transaction_id=p.id
  ), eligible_flows as (
    select a.*,c.group_id from allocations a inner join eligible_categories c on c.id=a.category_id
    left join eligible_groups g on g.id=c.group_id
    where c.group_id is null or a.type::text=case when g.type='income' then 'income' else 'expense' end
  ), invalid_parents as (
    select p.id from visible_parents p inner join ${transactionSplits} s on s.transaction_id=p.id
    where exists(select 1 from eligible_flows f where f.parent_id=p.id)
    group by p.id,p.amount having sum(s.amount) is distinct from p.amount
      or bool_or(s.amount<0 or s.amount::text !~ '^[0-9]+([.][0-9]+)?$')
  ), grouped_flows as (
    select category_id,group_id,type,date,currency,sum(amount) as amount,
      bool_or(amount<0 or amount::text !~ '^[0-9]+([.][0-9]+)?$' or parent_id in(select id from invalid_parents)) as invalid
    from eligible_flows group by category_id,group_id,type,date,currency
  ), used_parents as (
    select distinct f.parent_id,p.account_id from eligible_flows f inner join visible_parents p on p.id=f.parent_id
    where exists(select 1 from current_budgets b where b.category_id=f.category_id or b.category_group_id=f.group_id
      or (b.is_flex_bucket=true and f.group_id is not null and f.type='expense'))
  ), selected_quotes as (
    select distinct on(q.from_currency,q.effective_date) q.* from ${providerFxQuotes} q cross join base
    where q.to_currency=base.currency and q.from_currency<>base.currency and q.provider in ('yahoo_finance','exchangerate_api')
      and q.quoted_at<=transaction_timestamp() and (q.quoted_at at time zone 'UTC')::date=q.effective_date and q.valid_through>=q.effective_date
      and exists(select 1 from grouped_flows f where f.currency=q.from_currency and f.date=q.effective_date and f.amount<>0)
    order by q.from_currency,q.effective_date,q.quoted_at desc,q.provider,q.id
  ) select ${permitted} as allowed,(select currency from base) as currency,
    ${context.kind === "actor" ? sql`(select role::text from ${householdMembers} where household_id=${householdId}::uuid and user_id=${context.actor.userId}::uuid)` : sql`null`} as "readerRole",
    jsonb_build_object('autoRolloverBudget',coalesce((select auto_rollover from base),false),'rolloverPercentage',coalesce((select rollover_percentage from base),100),
      'warningThreshold',coalesce((select warning_threshold from base),75),'alertThreshold',coalesce((select alert_threshold from base),90)) as preferences,
    coalesce((select jsonb_agg(jsonb_build_object('id',id,'householdId',household_id,'name',name,'categoryId',category_id,'categoryGroupId',category_group_id,
      'amount',amount::text,'currency',currency,'period',period,'rolloverEnabled',rollover_enabled,'rolloverAmount',rollover_amount::text,
      'warningThreshold',warning_threshold,'alertThreshold',alert_threshold,'isActive',is_active,'isFlexBucket',is_flex_bucket,
      'createdAt',to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by id) from current_budgets),'[]'::jsonb) as budgets,
    coalesce((select jsonb_agg(jsonb_build_object('id',id,'groupId',group_id,'rolloverEnabled',rollover_enabled,'rolloverStartBalance',rollover_start_balance::text)
      order by id) from eligible_categories),'[]'::jsonb) as "categorySettings",
    coalesce((select jsonb_agg(jsonb_build_object('id',id,'type',type,'rolloverEnabled',rollover_enabled) order by id) from eligible_groups),'[]'::jsonb) as "groupSettings",
    coalesce((select jsonb_agg(jsonb_build_object('id',id,'budgetId',budget_id,'from',to_char(start_date,'YYYY-MM-DD'),'to',to_char(end_date,'YYYY-MM-DD'),
      'amount',budget_amount::text,'currency',currency,'version',version) order by id) from relevant_periods),'[]'::jsonb) as periods,
    coalesce((select jsonb_agg(jsonb_build_object('categoryId',category_id,'groupId',group_id,'type',type::text,'date',to_char(date,'YYYY-MM-DD'),
      'currency',currency,'amount',amount::text,'invalid',invalid) order by category_id,type,date,currency) from grouped_flows),'[]'::jsonb) as flows,
    coalesce((select jsonb_agg(jsonb_build_object('from',from_currency,'date',to_char(effective_date,'YYYY-MM-DD'),'rate',rate::text,
      'id',id,'provider',provider,'quotedAt',to_char(quoted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'validThrough',to_char(valid_through,'YYYY-MM-DD'))
      order by from_currency,effective_date) from selected_quotes),'[]'::jsonb) as quotes,false as "invalidSplits",
    jsonb_build_object('transactions',coalesce((select jsonb_agg(parent_id order by parent_id) from used_parents),'[]'::jsonb),
      'accounts',coalesce((select jsonb_agg(id order by id) from(select distinct account_id as id from used_parents) s),'[]'::jsonb),
      'categories',coalesce((select jsonb_agg(id order by id) from(select category_id as id from eligible_flows where parent_id in(select parent_id from used_parents)
        union select category_id from current_budgets where category_id is not null) s),'[]'::jsonb),
      'groups',coalesce((select jsonb_agg(id order by id) from(select group_id as id from eligible_flows where group_id is not null and parent_id in(select parent_id from used_parents)
        union select category_group_id from current_budgets where category_group_id is not null
        union select c.group_id from eligible_categories c inner join current_budgets b on b.category_id=c.id where c.group_id is not null) s),'[]'::jsonb),
      'budgets',coalesce((select jsonb_agg(id order by id) from current_budgets),'[]'::jsonb),
      'periods',coalesce((select jsonb_agg(id order by id) from relevant_periods),'[]'::jsonb),
      'quotes',coalesce((select jsonb_agg(id order by id) from selected_quotes),'[]'::jsonb)) as "lockTargets"`;
}

export async function readBudgetProgressInputs(householdId: string, year: number, month: number, context: BudgetReadContext,
  runner: Pick<typeof db, "execute"> = db): Promise<BudgetProgressInputs> {
  const result = await runner.execute<BudgetProgressInputs>(budgetProgressInputsQuery(householdId, year, month, context));
  const row = result.rows[0];
  if (!row?.allowed) throw new ForbiddenError("Budget progress access denied");
  return row;
}
