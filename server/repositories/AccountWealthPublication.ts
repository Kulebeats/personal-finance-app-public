import { sql } from "drizzle-orm";
import { accounts, grzBonds, grzTBills, holdings, householdMembers, households, pensionHoldings, providerFxQuotes, securities } from "@shared/schema";
import { db } from "../db";
import { visibleAccountPredicate } from "../core/authz/transaction-visibility";
import { ForbiddenError } from "../core/errors";
import { accountCaptureCutSql, accountCaptureCutValues, type AccountHistoryWindow } from "./AccountCaptureCutSql";
import type { CaptureSource, CaptureVersion } from "./AccountCapturedHistory";
import { accountListFromJson, accountListJsonSql, type AccountListJson } from "./AccountListProjection";
import { bondCouponStateSql, bondMarketEvidenceSql } from "../services/grz/bondValuationEvidence";
import { accountExportAuditCte } from "./AccountExportAudit";
import { householdSecurityPriceProjection } from "../services/investment/householdSecurityPriceRead";

/** One final statement rechecks grant, audience, monetary inputs, dated FX and
 * the complete in-range capture cut. No earlier RR query fixes this snapshot. */
export async function readAccountWealthPublication(
  householdId: string, userId: string, capability: "financial.read" | "financial.export", asOf: Date,
  financialProof: unknown, history?: AccountHistoryWindow, previous: CaptureVersion[] = [],
  auditExport = false,
) {
  const roles = capability === "financial.export" ? ["owner", "admin", "member"] : ["owner", "admin", "member", "view_only", "professional"];
  const date = asOf.toISOString().slice(0, 10);
  const priceEvidence = householdSecurityPriceProjection({
    householdId,
    securityId: sql`s.id`,
    currency: sql`s.currency`,
    globalReferencePrice: sql`s.current_price`,
    valuationDate: sql`${date}::date`,
  });
  const visible = visibleAccountPredicate({ householdId, userId, role: "member" });
  const includeAccounts = !history || history.includeAccounts === true;
  type Result = { allowed: boolean; financialsMatch: boolean; cut: CaptureVersion[]; changed: CaptureSource[]; accounts: AccountListJson[] };
  const result = await db.execute<Result>(sql`with allowed_member as (
    select 1 from ${householdMembers} where household_id=${householdId}::uuid and user_id=${userId}::uuid
      and role in (${sql.join(roles.map(role => sql`${role}`), sql`,`)})
      and (${history?.scope !== "household"}::boolean or role in ('owner','admin'))
  ), visible_accounts as (
    select * from ${accounts} where ${visible} and exists(select 1 from allowed_member)
  ), base as (
    select currency from ${households} where id=${householdId}::uuid and exists(select 1 from allowed_member)
  ), visible_positions as (
    select h.id,h.household_id,h.account_id,s.id as security_id,h.quantity::text as quantity,
      (${priceEvidence})->>'currentPrice' as price,s.currency,${priceEvidence} as price_evidence
    from ${holdings} h inner join visible_accounts a on h.account_id=a.id and a.is_hidden=false
      inner join ${securities} s on s.id=h.security_id where h.household_id=${householdId}::uuid
  ), visible_bills as (
    -- A-36: a bill awaiting receipt is still held, at face less withholding.
    select b.id,b.household_id,b.account_id,b.status,
      (case when b.status='awaiting_receipt' then b.maturity_net_proceeds else b.face_value end)::text as face_value
    from ${grzTBills} b inner join visible_accounts a on b.account_id=a.id
    where b.household_id=${householdId}::uuid and b.status in ('active','awaiting_receipt')
  ), visible_pensions as (
    select p.id,p.household_id,p.account_id,p.current_balance::text as balance
    from ${pensionHoldings} p inner join visible_accounts a on p.account_id=a.id where p.household_id=${householdId}::uuid
  ), visible_bonds as (
    select b.id,b.household_id,b.account_id,b.status,b.isin,b.face_value::text as face_value,b.purchase_date::text as purchase_date,
      b.maturity_date::text as maturity_date,${bondCouponStateSql(sql`b.id`)} as coupon_state,${bondMarketEvidenceSql(sql`b.id`, date)} as evidence
    from ${grzBonds} b inner join visible_accounts a on b.account_id=a.id
    where b.household_id=${householdId}::uuid and b.status='active' and a.is_hidden=false and a.is_archived=false and a.exclude_from_net_worth=false
  ), required_currencies as (
    select currency from visible_accounts where is_hidden=false and is_archived=false and exclude_from_net_worth=false
    union select currency from visible_positions
    union select 'ZMW' where exists(select 1 from visible_bills) or exists(select 1 from visible_pensions) or exists(select 1 from visible_bonds)
  ), selected_quotes as (
    select distinct on(q.from_currency) q.* from ${providerFxQuotes} q cross join base
    where base.currency ~ '^[A-Z]{3}$' and q.to_currency=base.currency and q.from_currency<>base.currency
      and q.from_currency in (select currency from required_currencies where currency ~ '^[A-Z]{3}$')
      and q.effective_date=${date}::date and q.valid_through>=${date}::date and q.quoted_at<=${asOf.toISOString()}::timestamptz
    order by q.from_currency,q.quoted_at desc,q.provider
  ), financial_state as (select jsonb_build_object(
    'currency',(select currency from base),
    'quotes',coalesce((select jsonb_agg(jsonb_build_object('id',id::text,'from',from_currency,'to',to_currency,'provider',provider,
      'rate',rate::text,'quotedAt',to_char(quoted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'effectiveDate',to_char(effective_date,'YYYY-MM-DD'),'validThrough',to_char(valid_through,'YYYY-MM-DD')) order by from_currency) from selected_quotes),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id::text,'householdId',household_id::text,'ownerUserId',owner_user_id::text,
      'isPrivate',is_private,'deletedAt',null,'type',type,'isAsset',is_asset,'isHidden',is_hidden,'isArchived',is_archived,
      'excluded',exclude_from_net_worth,'balance',balance::text,'estimatedValue',estimated_value::text,'currency',currency) order by id) from visible_accounts),'[]'::jsonb),
    'positions',coalesce((select jsonb_agg(jsonb_build_object('id',id::text,'householdId',household_id::text,'accountId',account_id::text,
      'securityId',security_id::text,'quantity',quantity,'price',price,'currency',currency,'priceEvidence',price_evidence) order by id) from visible_positions),'[]'::jsonb),
    'bills',coalesce((select jsonb_agg(jsonb_build_object('id',id::text,'householdId',household_id::text,'accountId',account_id::text,
      'status',status,'faceValue',face_value) order by id) from visible_bills),'[]'::jsonb),
    'pensions',coalesce((select jsonb_agg(jsonb_build_object('id',id::text,'householdId',household_id::text,'accountId',account_id::text,
      'balance',balance) order by id) from visible_pensions),'[]'::jsonb),
    'bonds',coalesce((select jsonb_agg(jsonb_build_object('id',id::text,'householdId',household_id::text,'accountId',account_id::text,
      'status',status,'isin',isin,'faceValue',face_value,'purchaseDate',purchase_date,'maturityDate',maturity_date,
      'couponState',coupon_state,'evidence',evidence) order by id) from visible_bonds),'[]'::jsonb)
    ) as proof
  ), ${accountCaptureCutSql(householdId, history, previous)}
  , publication as (select exists(select 1 from allowed_member) as allowed,
    (select proof=${JSON.stringify(financialProof)}::jsonb from financial_state) as "financialsMatch",
    ${includeAccounts ? sql`coalesce((select jsonb_agg(${accountListJsonSql("visible_accounts")} order by display_order,id)
      from visible_accounts where is_archived=false and is_hidden=false),'[]'::jsonb)` : sql`'[]'::jsonb`} as accounts,
    ${accountCaptureCutValues})
  ${auditExport ? sql`, ${accountExportAuditCte(userId, householdId, "account_summary",
    sql`jsonb_array_length(publication.accounts)`, sql`allowed and "financialsMatch"`)}` : sql``}
  select * from publication`);
  const current = result.rows[0];
  if (!current?.allowed) throw new ForbiddenError("Account financial access denied");
  return { ...current, accounts: current.accounts.map(accountListFromJson) };
}
