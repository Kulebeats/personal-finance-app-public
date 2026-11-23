import { sql } from "drizzle-orm";
import { accounts, holdings, securities, type InvestmentTransaction } from "@shared/schema";
import type { TransactionType } from "../../utils/withTransaction";
import { ValidationError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { DATED_INVESTMENT_FX_POLICY, DECLARED_INVESTMENT_INCOME_POLICY, INVESTMENT_INCOME_CURRENCY_POLICY, isInvestmentIncome } from "../../core/money/investment-income";
import type { CreateInvestmentTransactionInput } from "./investments.validation";
import type { FxRateSource } from "./investmentDatedFx";

export interface IncomeAuditActor { userId: string; ipAddress?: string }

/** The amount uses the selected instrument's units. Resolve this inside the
 * writer's transaction; an omitted denomination never acquires a ZMW default. */
export async function resolveInvestmentTransactionCurrency(tx: TransactionType, data: CreateInvestmentTransactionInput, householdId: string) {
  const source = await tx.execute<{ currency: string | null }>(sql`
    select case when ${data.holdingId ?? null}::uuid is not null then hs.currency
      when ${data.securityId ?? null}::uuid is not null then s.currency else a.currency end as currency
    from ${accounts} a
    left join ${holdings} h on h.id=${data.holdingId ?? null}::uuid and h.household_id=a.household_id and h.account_id=a.id
    left join ${securities} hs on hs.id=h.security_id
    left join ${securities} s on s.id=${data.securityId ?? null}::uuid
    where a.id=${data.accountId}::uuid and a.household_id=${householdId}::uuid and a.deleted_at is null
      and (${data.holdingId ?? null}::uuid is null or (h.id is not null and (${data.securityId ?? null}::uuid is null or h.security_id=${data.securityId ?? null}::uuid)))`);
  const sourceCurrency = source.rows[0]?.currency;
  if (!sourceCurrency || !/^[A-Z]{3}$/.test(sourceCurrency) || (data.currency !== undefined && data.currency !== sourceCurrency)) {
    throw new ValidationError("Transaction denomination must match its investment source");
  }
  return sourceCurrency;
}

/** A foreign row's server-derived conversion, the policy that derived it and
 * the rate row it used (F4), committed with the row so tax reads can tell it
 * from a caller-typed value. */
export function datedConversionAudit(transaction: InvestmentTransaction, source?: FxRateSource): { value: Record<string, string>; metadata: Record<string, unknown> } {
  if (transaction.currency === "ZMW" || transaction.fxRate === null || transaction.amountZmw === null) return { value: {}, metadata: {} };
  return { value: { fxRate: transaction.fxRate, amountZmw: transaction.amountZmw },
    metadata: { fxRateBasis: DATED_INVESTMENT_FX_POLICY, ...(source && { fxRateSource: source }) } };
}

/** Commit the declared amount convention and its source with the actual row.
 * The proof stays actor-scoped even when its financial source is shared. */
export async function logDeclaredInvestmentIncome(tx: TransactionType, transaction: InvestmentTransaction,
  data: CreateInvestmentTransactionInput, sourceCurrency: string, actor?: IncomeAuditActor, fxRateSource?: FxRateSource) {
  if (!actor || !isInvestmentIncome(transaction.type)) return;
  const fx = datedConversionAudit(transaction, fxRateSource);
  await businessAuditService.logCreate({
    tx, userId: actor.userId, householdId: null, entityType: "investment_transaction", entityId: transaction.id,
    newValue: { type: transaction.type, accountId: transaction.accountId, holdingId: transaction.holdingId,
      securityId: transaction.securityId, quantity: transaction.quantity, amount: transaction.amount,
      withholdingTax: transaction.withholdingTax, withholdingTaxDeclared: data.withholdingTax !== undefined,
      currency: transaction.currency, sourceCurrency, transactionDate: transaction.transactionDate, ...fx.value },
    metadata: { incomeAmountBasis: DECLARED_INVESTMENT_INCOME_POLICY, incomeCurrencyBasis: INVESTMENT_INCOME_CURRENCY_POLICY, ...fx.metadata },
    ipAddress: actor.ipAddress,
  });
}

export async function logInvestmentTransactionCreate(tx: TransactionType, transaction: InvestmentTransaction,
  data: CreateInvestmentTransactionInput, sourceCurrency: string, actor: IncomeAuditActor, auditHouseholdId: string | null,
  fxRateSource?: FxRateSource) {
  if (isInvestmentIncome(transaction.type)) return logDeclaredInvestmentIncome(tx, transaction, data, sourceCurrency, actor, fxRateSource);
  const fx = datedConversionAudit(transaction, fxRateSource);
  await businessAuditService.logCreate({
    tx, userId: actor.userId, householdId: auditHouseholdId, entityType: "investment_transaction", entityId: transaction.id,
    newValue: { type: transaction.type, accountId: transaction.accountId, holdingId: transaction.holdingId,
      securityId: transaction.securityId, quantity: transaction.quantity, amount: transaction.amount,
      currency: transaction.currency, transactionDate: transaction.transactionDate,
      ...((transaction.type === "buy" || transaction.type === "sell") && { price: transaction.price,
        fees: transaction.fees, feesDeclared: data.fees !== undefined }), ...fx.value },
    metadata: fx.metadata, ipAddress: actor.ipAddress,
  });
}
