import { and, eq, sql } from "drizzle-orm";
import { accounts, auditLogs, grzBonds, grzTBills, holdings, householdMembers, investmentTransactions, securities, taxLotDisposals, taxLots, users } from "@shared/schema";
import { db } from "../db";
import { ForbiddenError, ValidationError } from "../core/errors";
import { visibleInvestmentTransactionPredicate } from "../core/authz/investment-visibility";
import { visibleAccountPredicate } from "../core/authz/transaction-visibility";
import type { HouseholdContext } from "../middleware/householdGuard";
import { DECLARED_INVESTMENT_INCOME_POLICY, INVESTMENT_INCOME_CURRENCY_POLICY } from "../core/money/investment-income";
import { distinctManualTaxIncome, grzTaxCouponSources, verifiedGrzTaxCoupons, type GrzTaxCouponSource } from "./InvestmentTaxCouponSource";
import { datedFxProof } from "./InvestmentTaxFxProof";
import { householdToday } from "../services/householdCalendarToday";
import { visibleBondSalePredicate, visibleDueBillPredicate } from "../services/grz/holdingVisibility";
import { custodyVisible } from "../services/grz/instrumentIdentity";

export interface TaxActivity {
  id: string; type: string; amount: string; withholdingTax: string | null; date: string; currency: string;
  securityName: string | null; securitySymbol: string | null;
  securityCurrency: string | null; holdingCurrency: string | null;
  hasIncomeDeclaration: boolean; validIncomeDeclaration: boolean;
  /** Server-derived dated conversion (NEW-21); trusted only when fxProven. */
  amountZmw: string | null; fxRate: string | null; fxProven: boolean;
  /** A maturity row posted by the T-bill cron, with its bill and interest cash (NEW-22). */
  tbillCount: number; tbillName: string | null; tbillFaceValue: string | null; tbillPurchasePrice: string | null;
  tbillIncomeAmount: string | null; tbillIncomeCurrency: string | null;
}
export interface TaxDisposal {
  realizedGain: string; realizedGainZmw: string | null; currency: string | null; basisCurrency: string | null;
  saleFxProven: boolean; basisFxProven: boolean | null;
}
/** A sold GRZ bond's recorded ZMW gain or loss (GRZ-03); null only on a legacy unsettled sale. */
export interface TaxBondSale { id: string; realizedGain: string | null }
export interface InvestmentTaxInputs { activity: TaxActivity[]; disposals: TaxDisposal[]; bondSales: TaxBondSale[] }

/** One protected statement observes grant, all source audiences and both kinds
 * of financial input together. A tax year consists of date-only boundaries. */
export async function readInvestmentTaxInputs(actor: HouseholdContext, year: number,
  capability: "financial.read" | "financial.export"): Promise<InvestmentTaxInputs> {
  if (!actor?.householdId || !actor.userId) throw new ForbiddenError("Investment tax access denied");
  if (!Number.isInteger(year) || year < 1000 || year >= 9999) throw new ValidationError("A valid tax year is required");
  // The coupon proof's "not in the future" bound is the household's own date (NEW-22).
  const today = await householdToday(db, actor.householdId);
  const roles = capability === "financial.export" ? ["owner", "admin", "member"] : ["owner", "admin", "member", "view_only", "professional"];
  const visibilityActor = { ...actor, role: "member" as const };
  const visibleActivity = visibleInvestmentTransactionPredicate(visibilityActor);
  const visibleDisposalHolding = sql`exists(select 1 from ${holdings} where ${and(
    eq(holdings.id, taxLotDisposals.holdingId), eq(holdings.householdId, actor.householdId),
    sql`exists(select 1 from ${accounts} where ${and(eq(accounts.id, holdings.accountId), visibleAccountPredicate(visibilityActor))})`,
  )})`;
  const visibleBasis = sql`exists(select 1 from ${taxLots} where ${and(
    eq(taxLots.id, taxLotDisposals.taxLotId), eq(taxLots.householdId, actor.householdId), eq(taxLots.holdingId, taxLotDisposals.holdingId),
    sql`(${taxLots.transactionId} is null or exists(select 1 from ${investmentTransactions} where
      ${investmentTransactions.id}=${taxLots.transactionId} and ${visibleActivity}
      and (${investmentTransactions.holdingId} is null or ${investmentTransactions.holdingId}=${taxLots.holdingId})))`,
  )})`;
  const frame = await db.execute<{ allowed: boolean; activity: TaxActivity[]; disposals: TaxDisposal[]; bondSales: TaxBondSale[];
    coupons: GrzTaxCouponSource[] }>(sql`
    with allowed_member as (
      select 1 from ${householdMembers} m join ${users} u on u.id=m.user_id
      where m.household_id=${actor.householdId}::uuid and m.user_id=${actor.userId}::uuid
        and m.role in (${sql.join(roles.map(role => sql`${role}`), sql`,`)}) and u.erased_at is null and u.email_verified
    ), coupon_sources as (${grzTaxCouponSources(actor, today)}), activity as (
      select ${investmentTransactions.id}::text as id,${investmentTransactions.type} as type,
        ${investmentTransactions.amount}::text as amount,${investmentTransactions.withholdingTax}::text as "withholdingTax",
        ${investmentTransactions.currency} as currency,
        ${investmentTransactions.amountZmw}::text as "amountZmw",${investmentTransactions.fxRate}::text as "fxRate",
        ${datedFxProof("investment_transactions")} as "fxProven",
        ${securities.currency} as "securityCurrency",
        (select instrument.currency from ${holdings} holding join ${securities} instrument on instrument.id=holding.security_id
          where holding.id=${investmentTransactions.holdingId}) as "holdingCurrency",
        origin.declared as "hasIncomeDeclaration",(origin.total=1 and origin.matches=1) as "validIncomeDeclaration",
        ${investmentTransactions.transactionDate}::text as date,${securities.name} as "securityName",${securities.symbol} as "securitySymbol",
        bill.count as "tbillCount",bill.name as "tbillName",bill.face as "tbillFaceValue",bill.cost as "tbillPurchasePrice",
        bill.income as "tbillIncomeAmount",bill.income_currency as "tbillIncomeCurrency"
      from ${investmentTransactions} left join ${securities} on ${securities.id}=${investmentTransactions.securityId}
      left join lateral (
        select count(*)::integer as count,
          max(case when ${custodyVisible(sql.raw("tbill.account_id"), visibilityActor)} then tbill.tbill_name end) as name,
          max(tbill.face_value)::text as face,
          max(tbill.purchase_price)::text as cost,max(cash.amount)::text as income,max(cash.currency) as income_currency
        from public.grz_tbills tbill left join public.transactions cash on cash.id=tbill.maturity_income_tx_id
          and cash.household_id=tbill.household_id and cash.deleted_at is null
        where tbill.maturity_investment_tx_id=${investmentTransactions.id} and tbill.household_id=${actor.householdId}::uuid
          and tbill.status='matured'
      ) bill on true
      left join lateral (
        select count(*)::integer as total,
          coalesce(bool_or(history.details ? 'incomeAmountBasis' or history.details ? 'incomeCurrencyBasis'
            or history.details->'newValue' ? 'withholdingTax' or history.details->'newValue' ? 'withholdingTaxDeclared'),false) as declared,
          count(*) filter(where history.user_id is not null and history.details->>'incomeAmountBasis'=${DECLARED_INVESTMENT_INCOME_POLICY}
            and history.details->>'incomeCurrencyBasis'=${INVESTMENT_INCOME_CURRENCY_POLICY}
            and history.details->'newValue' @> jsonb_build_object('type',${investmentTransactions.type}::text,
              'accountId',${investmentTransactions.accountId}::text,'holdingId',${investmentTransactions.holdingId}::text,
              'securityId',${investmentTransactions.securityId}::text,'amount',${investmentTransactions.amount}::text,
              'withholdingTax',${investmentTransactions.withholdingTax}::text,'withholdingTaxDeclared',true,
              'currency',${investmentTransactions.currency},'sourceCurrency',${investmentTransactions.currency},
              'transactionDate',${investmentTransactions.transactionDate}::text))::integer as matches
        from ${auditLogs} history where history.entity_type='investment_transaction' and history.entity_id=${investmentTransactions.id} and history.action='CREATE'
      ) origin on true
      where exists(select 1 from allowed_member) and ${visibleActivity}
        and ${distinctManualTaxIncome(actor)}
        and ${investmentTransactions.transactionDate}>=${`${year}-01-01`}::date and ${investmentTransactions.transactionDate}<${`${year + 1}-01-01`}::date
    ), disposals as (
      select ${taxLotDisposals.id}::text as id,${taxLotDisposals.realizedGain}::text as "realizedGain",
        ${taxLotDisposals.realizedGainZmw}::text as "realizedGainZmw",${datedFxProof("investment_transactions")} as "saleFxProven",
        (select ${datedFxProof("acquisition")} from ${taxLots} lot join ${investmentTransactions} acquisition on acquisition.id=lot.transaction_id
          where lot.id=${taxLotDisposals.taxLotId}) as "basisFxProven",
        case when exists(select 1 from ${securities} instrument where instrument.id=${investmentTransactions.securityId}
            and instrument.currency is distinct from ${investmentTransactions.currency})
          or exists(select 1 from ${holdings} source_holding join ${securities} instrument on instrument.id=source_holding.security_id
            where source_holding.id=${taxLotDisposals.holdingId} and instrument.currency is distinct from ${investmentTransactions.currency})
          then null else ${investmentTransactions.currency} end as currency,
        (select case when exists(select 1 from ${securities} instrument where instrument.id=acquisition.security_id
            and instrument.currency is distinct from acquisition.currency)
          or exists(select 1 from ${holdings} source_holding join ${securities} instrument on instrument.id=source_holding.security_id
            where source_holding.id=lot.holding_id and instrument.currency is distinct from acquisition.currency)
          then null else acquisition.currency end from ${taxLots} lot
          join ${investmentTransactions} acquisition on acquisition.id=lot.transaction_id
          where lot.id=${taxLotDisposals.taxLotId}) as "basisCurrency"
      from ${taxLotDisposals} join ${investmentTransactions} on ${investmentTransactions.id}=${taxLotDisposals.transactionId}
      where exists(select 1 from allowed_member) and ${taxLotDisposals.householdId}=${actor.householdId}::uuid
        and ${visibleDisposalHolding} and ${visibleBasis} and ${visibleActivity}
        and (${investmentTransactions.holdingId} is null or ${investmentTransactions.holdingId}=${taxLotDisposals.holdingId})
        and ${taxLotDisposals.disposedDate}>=${`${year}-01-01`}::date and ${taxLotDisposals.disposedDate}<${`${year + 1}-01-01`}::date
    ), bond_sales as (
      select ${grzBonds.id}::text as id,${grzBonds.saleRealizedGain}::text as "realizedGain" from ${grzBonds}
      where exists(select 1 from allowed_member) and ${visibleBondSalePredicate(visibilityActor)} and ${grzBonds.status}='sold'
        and ${grzBonds.soldDate}>=${`${year}-01-01`}::date and ${grzBonds.soldDate}<${`${year + 1}-01-01`}::date
    ), due_bills as (
      -- A-36: a bill awaiting receipt reports its booked interest in its maturity
      -- year, shaped as the maturity row its confirmation will write.
      select ${grzTBills.id}::text as id,'maturity' as type,${grzTBills.maturityNetProceeds}::text as amount,
        ${grzTBills.maturityWithholdingTax}::text as "withholdingTax",'ZMW' as currency,null::text as "amountZmw",null::text as "fxRate",
        false as "fxProven",null::text as "securityCurrency",null::text as "holdingCurrency",
        false as "hasIncomeDeclaration",false as "validIncomeDeclaration",${grzTBills.maturityDate}::text as date,
        null::text as "securityName",null::text as "securitySymbol",1 as "tbillCount",${grzTBills.tbillName} as "tbillName",
        ${grzTBills.faceValue}::text as "tbillFaceValue",${grzTBills.purchasePrice}::text as "tbillPurchasePrice",
        case when ${grzTBills.maturityNetProceeds}>${grzTBills.purchasePrice}
          then (${grzTBills.maturityNetProceeds}-${grzTBills.purchasePrice})::text end as "tbillIncomeAmount",
        'ZMW' as "tbillIncomeCurrency"
      from ${grzTBills}
      where exists(select 1 from allowed_member) and ${visibleDueBillPredicate(visibilityActor)}
        and ${grzTBills.maturityDate}>=${`${year}-01-01`}::date and ${grzTBills.maturityDate}<${`${year + 1}-01-01`}::date
    ) select exists(select 1 from allowed_member) as allowed,
      coalesce((select jsonb_agg(to_jsonb(activity) order by id) from activity),'[]'::jsonb)
        || coalesce((select jsonb_agg(to_jsonb(due_bills) order by id) from due_bills),'[]'::jsonb) as activity,
      coalesce((select jsonb_agg(to_jsonb(coupon_sources) order by id) from coupon_sources
        where date>=${`${year}-01-01`} and date<${`${year + 1}-01-01`}), '[]'::jsonb) as coupons,
      coalesce((select jsonb_agg(to_jsonb(disposals) order by id) from disposals),'[]'::jsonb) as disposals,
      coalesce((select jsonb_agg(to_jsonb(bond_sales) order by id) from bond_sales),'[]'::jsonb) as "bondSales"`);
  const row = frame.rows[0];
  if (!row?.allowed) throw new ForbiddenError("Investment tax access denied");
  return { activity: [...row.activity, ...verifiedGrzTaxCoupons(row.coupons, actor)], disposals: row.disposals, bondSales: row.bondSales };
}
