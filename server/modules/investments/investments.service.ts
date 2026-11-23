import { readVisibleHoldings, valueVisibleHoldings, type HoldingReadSession } from "./investmentHoldingRead";
import { postInvestmentLotSale } from "./investmentLotSale";
import { checkRecordedDisposals, recordPurchaseLot } from "./investmentTradeHistory";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  securities,
  holdings,
  accounts,
  investmentTransactions,
  fxRates,
  type InsertInvestmentTransaction,

} from "@shared/schema";
import {
  ListSecuritiesQuery,
  GetSecurityPricesQuery,
  CreateSecurityInput,
  createSecuritySchema,
  UpdateSecurityPriceInput,
  ListHoldingsQuery,
  CreateHoldingInput,
  UpdateHoldingInput,
  CreateInvestmentTransactionInput,
  ListInvestmentTransactionsQuery,
  ListTaxLotsQuery,
  ListFxRatesQuery,
  FxHistoricalQuery,
} from "./investments.validation";
import { portfolioValuationService } from "../../services/PortfolioValuationService";
import { businessAuditService } from "../../services/BusinessAuditService";
import { getLatestFxRates } from "../../core/calculations";
import { withTransaction } from "../../utils/withTransaction";
import { Money, toMoneyDto } from "../../core/money";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { listVisibleInvestmentTransactions } from "./investmentTransactionRead";
import { isInvestmentIncome } from "../../core/money/investment-income";
import { logInvestmentTransactionCreate, resolveInvestmentTransactionCurrency } from "./investmentIncomeWrite";
import {
  lockInvestmentTransactionSources,
  lockInvestmentWriterIdentity,
  type InvestmentSourceSession,
} from "./investmentTransactionAccess";
import { listVisibleInvestmentTaxLots } from "./investmentTaxLotRead";
import { lockHoldingRemainingBasis } from "./investmentHoldingBasisSource";
import { createDeclaredOpeningHolding } from "./investmentHoldingOpening";
import { updateDeclaredHolding } from "./investmentHoldingUpdate";
import { deleteAuthorizedHolding } from "./investmentHoldingDeletion";
import { recordHouseholdSecurityPrice } from "./investmentSecurityPriceWrite";
import { listVisibleFxRates, recordHouseholdFxRate } from "./investmentFxRateWrite";
import { readHouseholdSecurities, readVisibleSecurityPriceHistory } from "./investmentSecurityRead";
import { insertCatalogueSecurity } from "./investmentSecurityCreate";
import type { InvestmentReadSession } from "./investmentReadAuthority";
import { convertInvestmentEventToZmw } from "./investmentDatedFx";

export class InvestmentService {
  // =========================================================================
  // Securities
  // =========================================================================

  async listSecurities(filters: ListSecuritiesQuery, caller: HouseholdContext, session: InvestmentReadSession) {
    return readHouseholdSecurities(caller, session, filters);
  }

  async getSecurityById(id: string, caller: HouseholdContext, session: InvestmentReadSession) {
    const [security] = await readHouseholdSecurities(caller, session, {}, id);
    return security;
  }

  async getSecurityPrices(id: string, options: GetSecurityPricesQuery, caller: HouseholdContext, session: InvestmentReadSession) {
    return readVisibleSecurityPriceHistory(caller, session, id, options);
  }

  async createSecurity(data: CreateSecurityInput, caller: HouseholdContext, ipAddress: string | undefined, session: InvestmentSourceSession) {
    const parsed = createSecuritySchema.safeParse(data);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }
    if (!session?.snapshot || !session.sessionId) {
      throw new UnauthorizedError("Authentication changed; sign in again");
    }
    return withTransaction(async (tx) => {
      const { userId, householdId } = await lockInvestmentWriterIdentity(tx, caller, session);
      // NEW-13: a member's security is that household's custom row; only an
      // operator adds to the curated list (POST /api/admin/securities).
      return insertCatalogueSecurity(tx, parsed.data, householdId, { userId, householdId, ipAddress });
    });
  }

  async updateSecurityPrice(id: string, data: UpdateSecurityPriceInput, caller: HouseholdContext,
    ipAddress: string | undefined, session: InvestmentSourceSession) {
    return recordHouseholdSecurityPrice(id, data, caller, ipAddress, session);
  }

  // =========================================================================
  // FX Rates
  // =========================================================================

  async listFxRates(householdId: string, filters: ListFxRatesQuery) {
    return listVisibleFxRates(householdId, filters);
  }

  async createFxRate(input: unknown, caller: HouseholdContext,
    ipAddress: string | undefined, session: InvestmentSourceSession) {
    return recordHouseholdFxRate(input, caller, ipAddress, session);
  }

  async getFxHistorical(options: FxHistoricalQuery) {
    const { from, to, limit } = options;

    const results = await db
      .select({
        date: fxRates.date,
        rate: fxRates.rate,
      })
      .from(fxRates)
      .where(
        and(eq(fxRates.fromCurrency, from), eq(fxRates.toCurrency, to))
      )
      .orderBy(desc(fxRates.date))
      .limit(limit);

    // Return in chronological order for charts
    return results.reverse().map((r) => ({
      date: r.date,
      rate: Number(r.rate),
    }));
  }

  // =========================================================================
  // Holdings
  // =========================================================================

  async getHoldings(caller: HouseholdContext, filters: ListHoldingsQuery, baseCurrencyRequest: string, session: HoldingReadSession) {
    return valueVisibleHoldings(caller, session, filters, async results => {
      // Only authorized custody contributes denominations to the FX request.
      const currencies = new Set(
        results
          .map((r) => r.security.currency)
          .filter((c): c is string => Boolean(c) && c !== baseCurrencyRequest)
      );

      const fxRatesByCurrency = await getLatestFxRates(
        Array.from(currencies),
        baseCurrencyRequest,
        caller.householdId
      );

      return results.map(({ holding, security, verifiedOpeningRate }) => {
        const metrics = portfolioValuationService.computeHoldingMetrics(
          { ...holding, verifiedOpeningRate },
          security,
          baseCurrencyRequest,
          fxRatesByCurrency
        );

        return {
          ...holding,
          security,
          // Base-currency MoneyDto; the stored local costBasis string is left as it is.
          currentValue: toMoneyDto(metrics.currentValueBase),
          costBasisBase: metrics.costBasisBase && toMoneyDto(metrics.costBasisBase),
          fxRateUsed: metrics.fxRateUsed,
          gainLoss: metrics.gainLoss && toMoneyDto(metrics.gainLoss),
          gainLossPercent: metrics.gainLossPercent,
        };
      });
    });
  }

  async getVisibleHoldingById(id: string, caller: HouseholdContext, session: HoldingReadSession) {
    const [row] = await readVisibleHoldings(caller, session, { holdingId: id });
    return row ? { ...row.holding, security: row.security } : null;
  }

  /** Mutation pre-read; HTTP GET uses the actor-scoped reader above. */
  async getHoldingById(id: string, householdId: string) {
    const [result] = await db
      .select({ holding: holdings, security: securities })
      .from(holdings)
      .innerJoin(securities, eq(securities.id, holdings.securityId))
      .innerJoin(accounts, eq(accounts.id, holdings.accountId))
      .where(
        and(
          eq(holdings.id, id),
          eq(accounts.householdId, householdId),
          isNull(accounts.deletedAt)
        )
      )
      .limit(1);

    if (result) {
      return { ...result.holding, security: result.security };
    }
    return null;
  }

  async createHolding(data: CreateHoldingInput, actor: HouseholdContext, ipAddress: string | undefined, session: InvestmentSourceSession) {
    return createDeclaredOpeningHolding(data, actor, ipAddress, session);
  }

  async updateHolding(id: string, data: UpdateHoldingInput, actor: HouseholdContext, ipAddress: string | undefined, session: InvestmentSourceSession) {
    return updateDeclaredHolding(id, data, actor, ipAddress, session);
  }

  async deleteHolding(id: string, actor: HouseholdContext, ipAddress: string | undefined, session: InvestmentSourceSession): Promise<boolean> {
    return deleteAuthorizedHolding(id, actor, ipAddress, session);
  }

  // =========================================================================
  // Transactions
  // =========================================================================

  async getTransactions(
    actor: HouseholdContext,
    filters: ListInvestmentTransactionsQuery
  ) {
    return listVisibleInvestmentTransactions(actor, filters);
  }

  getTaxLots(actor: HouseholdContext, filters: ListTaxLotsQuery) {
    return listVisibleInvestmentTaxLots(actor, filters);
  }

  async createTransaction(
    data: CreateInvestmentTransactionInput,
    caller: HouseholdContext,
    ipAddress?: string,
  ) {
    const householdId = caller.householdId;
    // P0-1 & P0-2 FIX: Use transaction for atomicity, update holdings, validate overdraft
    return await withTransaction(async (tx) => {
      const { actor, account, holding } = await lockInvestmentTransactionSources(tx, caller, data);
      const sourceCurrency = await resolveInvestmentTransactionCurrency(tx, data, householdId);
      // NEW-21: a foreign event stores the dated rate for its own date; a missing rate is a 422.
      const conversion = await convertInvestmentEventToZmw(tx, householdId, sourceCurrency, data.transactionDate, data.amount,
        { fxRate: data.fxRate, amountZmw: data.amountZmw });
      // F3: a ZMW row of any type carries its own amount and a unit rate, never a typed base.
      if (sourceCurrency === "ZMW" && ((data.amountZmw !== undefined && !new Money(data.amount).equals(data.amountZmw))
        || (data.fxRate !== undefined && !new Money(data.fxRate).equals("1")))) {
        throw new ValidationError("A ZMW investment event must use its native amount and a unit conversion rate");
      }
      if (data.type === "sell" || data.type === "buy") {
        if (data.type === "sell") await checkRecordedDisposals(tx, householdId, data);
        if (holding) await lockHoldingRemainingBasis(tx, holding, sourceCurrency);
      }
      // P0-2 FIX: Overdraft validation for SELL transactions
      if (data.type === "sell" && data.holdingId && data.quantity) {
        // Lock the holding row to prevent race conditions
        const holdingQueryBase = tx
          .select({ quantity: holdings.quantity, id: holdings.id })
          .from(holdings)
          .where(
            and(
              eq(holdings.id, data.holdingId),
              eq(holdings.householdId, householdId)
            )
          );
        const holdingQuery =
          typeof (holdingQueryBase as { for?: (mode: "update") => unknown }).for ===
          "function"
            ? (holdingQueryBase as { for: (mode: "update") => unknown }).for("update")
            : holdingQueryBase;
        const [holding] = await (holdingQuery as { limit: (n: number) => Promise<Array<{ quantity: string | null; id: string }>> }).limit(1);

        if (!holding) {
          throw new NotFoundError("Holding not found");
        }

        const currentQuantity = new Money(holding.quantity ?? "0");
        const sellQuantity = new Money(String(data.quantity));

        if (currentQuantity.lt(sellQuantity)) {
          throw new ConflictError(
            "Insufficient shares to sell"
          );
        }
      }

      // Insert the transaction record
      const insertData: InsertInvestmentTransaction = {
        householdId,
        accountId: data.accountId,
        securityId: data.securityId ?? null,
        holdingId: data.holdingId ?? null,
        type: data.type,
        quantity: data.quantity ? String(data.quantity) : null,
        price: data.price ? String(data.price) : null,
        amount: data.amount,
        currency: sourceCurrency,
        fees: data.fees,
        withholdingTax: isInvestmentIncome(data.type) ? data.withholdingTax ?? null : "0.00",
        amountZmw: conversion?.amountZmw ?? data.amountZmw ?? null,
        fxRate: conversion?.fxRate ?? data.fxRate ?? null,
        transactionDate: data.transactionDate,
      };

      const [transaction] = await tx
        .insert(investmentTransactions)
        .values(insertData)
        .returning();

      // Tax lot tracking for buy/sell transactions.
      if (data.holdingId && data.quantity && (data.type === "buy" || data.type === "sell")) {

        if (data.type === "buy") {
          await recordPurchaseLot(tx, transaction);
        } else {
          await postInvestmentLotSale(tx, transaction, actor);
        }
      }

      // Reconcile acquisition costs less actual booked FIFO allocations, then
      // commit quantity and basis together under the original holding lock.
      if (holding && data.quantity && (data.type === "buy" || data.type === "sell")) {
        const shares = new Money(holding.quantity);
        const quantity = (data.type === "buy" ? shares.add(data.quantity) : shares.subtract(data.quantity)).amount.toFixed(8);
        const basis = await lockHoldingRemainingBasis(tx, { ...holding, quantity }, sourceCurrency);
        await tx.update(holdings).set({ ...basis, updatedAt: new Date() })
          .where(and(eq(holdings.id, holding.id), eq(holdings.householdId, householdId)));
      }

      await logInvestmentTransactionCreate(tx, transaction, data, sourceCurrency, { userId: actor.userId, ipAddress }, account.isPrivate ? null : actor.householdId,
        conversion?.source);
      return transaction;
    });
  }


}

export const investmentService = new InvestmentService();
