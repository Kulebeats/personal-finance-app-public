import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  securities,
  holdings,
  accounts,
  securityPrices,
  investmentTransactions,
  taxLots,
  taxLotDisposals,
  fxRates,
  type InsertHolding,
  type InsertInvestmentTransaction,
  type InsertTaxLot,
  type InsertTaxLotDisposal,
  type InsertFxRate,
} from "@shared/schema";
import {
  ListSecuritiesQuery,
  GetSecurityPricesQuery,
  CreateSecurityInput,
  UpdateSecurityPriceInput,
  ListHoldingsQuery,
  CreateHoldingInput,
  UpdateHoldingInput,
  CreateInvestmentTransactionInput,
  ListInvestmentTransactionsQuery,
  ListTaxLotsQuery,
  ListFxRatesQuery,
  CreateFxRateInput,
  FxHistoricalQuery,
} from "./investments.validation";
import { portfolioValuationService } from "../../services/PortfolioValuationService";
import { getLatestFxRates } from "../../core/calculations";
import { withTransaction } from "../../utils/withTransaction";
import { Money } from "../../core/money";
import { ConflictError, NotFoundError } from "../../core/errors";

export class InvestmentService {
  // =========================================================================
  // Private Helpers
  // =========================================================================

  /**
   * Validates that an account belongs to the specified household
   * @throws NotFoundError if account doesn't exist or doesn't belong to household
   */
  private async validateAccountOwnership(
    accountId: string,
    householdId: string
  ): Promise<void> {
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.householdId, householdId),
          isNull(accounts.deletedAt)
        )
      )
      .limit(1);

    if (!account) {
      throw new NotFoundError("Account not found");
    }
  }

  /**
   * Validates that a holding belongs to the specified household
   * @throws NotFoundError if holding doesn't exist or doesn't belong to household
   */
  private async validateHoldingOwnership(
    holdingId: string,
    householdId: string,
    accountId?: string,
    securityId?: string | null
  ): Promise<void> {
    const conditions = [
      eq(holdings.id, holdingId),
      eq(holdings.householdId, householdId),
    ];

    if (accountId) {
      conditions.push(eq(holdings.accountId, accountId));
    }
    if (securityId) {
      conditions.push(eq(holdings.securityId, securityId));
    }

    const [holding] = await db
      .select({ id: holdings.id })
      .from(holdings)
      .where(and(...conditions))
      .limit(1);

    if (!holding) {
      throw new NotFoundError("Holding not found");
    }
  }

  // =========================================================================
  // Securities
  // =========================================================================

  async listSecurities(filters: ListSecuritiesQuery) {
    let query = db.select().from(securities).$dynamic();

    // Note: Drizzle dynamic query filtering is basic, normally we'd build conditions
    // Since we are moving from in-memory filtering (current controller) to DB filtering where possible
    // we can implement basic DB filters.

    // For now, to match existing behavior exactly, we'll fetch all and filter in memory if complex,
    // or apply simple where clauses.

    // Existing controller implementation was: fetch all, then filter.
    // Let's improve it to use WHERE clauses where possible.

    const conditions = [];
    if (filters.type) conditions.push(eq(securities.type, filters.type));
    if (filters.exchange)
      conditions.push(eq(securities.exchange, filters.exchange));
    if (filters.currency)
      conditions.push(eq(securities.currency, filters.currency));

    let results = await db
      .select()
      .from(securities)
      .where(and(...conditions));

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      results = results.filter(
        (s) =>
          s.symbol?.toLowerCase().includes(searchLower) ||
          s.name.toLowerCase().includes(searchLower)
      );
    }

    return results;
  }

  async getSecurityById(id: string) {
    const [security] = await db
      .select()
      .from(securities)
      .where(eq(securities.id, id))
      .limit(1);
    return security;
  }

  async getSecurityPrices(id: string, options: GetSecurityPricesQuery) {
    // ISSUE-013: Implement date filtering
    const conditions = [eq(securityPrices.securityId, id)];

    if (options.startDate) {
      conditions.push(gte(securityPrices.date, options.startDate));
    }
    if (options.endDate) {
      conditions.push(lte(securityPrices.date, options.endDate));
    }

    return await db
      .select()
      .from(securityPrices)
      .where(and(...conditions))
      .orderBy(desc(securityPrices.date))
      .limit(options.limit || 365);
  }

  async createSecurity(data: CreateSecurityInput) {
    const [security] = await db
      .insert(securities)
      .values({
        symbol: data.symbol,
        name: data.name,
        type: data.type,
        currency: data.currency,
        exchange: data.exchange ?? null,
        isOffshore: data.isOffshore ?? false,
        sector: data.sector ?? null,
        cusipIsin: data.cusipIsin ?? null,
        currentPrice: data.currentPrice ?? null,
        withholdingTaxRate: data.withholdingTaxRate ?? null,
        lastPriceUpdate: data.currentPrice ? new Date() : null,
      })
      .returning();
    return security;
  }

  async updateSecurityPrice(id: string, data: UpdateSecurityPriceInput) {
    const priceDate = data.date || new Date().toISOString().split("T")[0];

    return await withTransaction(async (tx) => {
      // Update current price on security
      const [updated] = await tx
        .update(securities)
        .set({
          currentPrice: data.price,
          lastPriceUpdate: new Date(),
        })
        .where(eq(securities.id, id))
        .returning();

      if (!updated) {
        throw new NotFoundError("Security not found");
      }

      // Add to price history
      await tx.insert(securityPrices).values({
        securityId: id,
        price: data.price,
        date: priceDate,
        source: "manual",
      });

      return updated;
    });
  }

  // =========================================================================
  // FX Rates
  // =========================================================================

  async listFxRates(filters: ListFxRatesQuery) {
    const conditions = [];

    if (filters.from) {
      conditions.push(eq(fxRates.fromCurrency, filters.from));
    }
    if (filters.to) {
      conditions.push(eq(fxRates.toCurrency, filters.to));
    }

    return await db
      .select()
      .from(fxRates)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(fxRates.date));
  }

  async createFxRate(data: CreateFxRateInput) {
    const rateDate = data.date || new Date().toISOString().split("T")[0];

    const insertData: InsertFxRate = {
      fromCurrency: data.fromCurrency,
      toCurrency: data.toCurrency,
      rate: data.rate,
      date: rateDate,
      source: data.source || "manual",
    };

    const [rate] = await db.insert(fxRates).values(insertData).returning();
    return rate;
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

  async getHoldings(
    householdId: string,
    filters: ListHoldingsQuery,
    baseCurrencyRequest: string
  ) {
    const { accountId } = filters;

    let whereConditions = and(
      eq(accounts.householdId, householdId),
      isNull(accounts.deletedAt),
      ne(accounts.isHidden, true)
    );

    if (accountId) {
      whereConditions = and(whereConditions, eq(holdings.accountId, accountId));
    }

    const results = await db
      .select({ holding: holdings, security: securities })
      .from(holdings)
      .innerJoin(securities, eq(securities.id, holdings.securityId))
      .innerJoin(accounts, eq(accounts.id, holdings.accountId))
      .where(whereConditions);

    // Get FX rates
    const currencies = new Set(
      results
        .map((r) => r.security.currency)
        .filter((c): c is string => Boolean(c) && c !== baseCurrencyRequest)
    );

    const fxRatesByCurrency = await getLatestFxRates(
      Array.from(currencies),
      baseCurrencyRequest
    );

    // Calculate values
    return results.map(({ holding, security }) => {
      const metrics = portfolioValuationService.computeHoldingMetrics(
        holding,
        security,
        baseCurrencyRequest,
        fxRatesByCurrency
      );

      return {
        ...holding,
        security,
        currentValue: metrics.currentValueBase,
        costBasis: metrics.costBasisBase,
        fxRateUsed: metrics.fxRateUsed,
        gainLoss: metrics.gainLoss,
        gainLossPercent: metrics.gainLossPercent,
      };
    });
  }

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

  async createHolding(data: CreateHoldingInput, householdId: string) {
    // H1 FIX: Validate account belongs to household before creating holding
    await this.validateAccountOwnership(data.accountId, householdId);

    const insertData: InsertHolding = {
      householdId,
      accountId: data.accountId,
      securityId: data.securityId,
      quantity: data.quantity,
      costBasis: data.costBasis,
      costBasisZmw: data.costBasisZmw,
      acquiredDate: data.acquiredDate,
      acquisitionFxRate: data.acquisitionFxRate,
    };

    const [holding] = await db.insert(holdings).values(insertData).returning();
    return holding;
  }

  async updateHolding(id: string, data: UpdateHoldingInput, householdId: string) {
    // P0-3 FIX: Added householdId check to prevent cross-household modification
    const [updated] = await db
      .update(holdings)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(holdings.id, id),
          eq(holdings.householdId, householdId)
        )
      )
      .returning();
    return updated;
  }

  async deleteHolding(id: string, householdId: string): Promise<boolean> {
    // P0-4 FIX: Added householdId check to prevent cross-household deletion
    const result = await db
      .delete(holdings)
      .where(
        and(
          eq(holdings.id, id),
          eq(holdings.householdId, householdId)
        )
      )
      .returning({ id: holdings.id });

    return result.length > 0;
  }

  // =========================================================================
  // Transactions
  // =========================================================================

  async getTransactions(
    householdId: string,
    filters: ListInvestmentTransactionsQuery
  ) {
    const { limit } = filters;

    const results = await db
      .select()
      .from(investmentTransactions)
      .innerJoin(accounts, eq(accounts.id, investmentTransactions.accountId))
      .where(
        and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt))
      )
      .orderBy(desc(investmentTransactions.transactionDate))
      .limit(limit || 100);

    return results.map((r) => r.investment_transactions);
  }

  async getTaxLots(householdId: string, filters: ListTaxLotsQuery) {
    const conditions = [eq(taxLots.householdId, householdId)];
    if (filters.holdingId) {
      conditions.push(eq(taxLots.holdingId, filters.holdingId));
    }

    const lots = await db
      .select({
        lot: taxLots,
        holding: holdings,
        security: securities,
      })
      .from(taxLots)
      .innerJoin(holdings, eq(holdings.id, taxLots.holdingId))
      .innerJoin(securities, eq(securities.id, holdings.securityId))
      .where(and(...conditions))
      .limit(filters.limit);

    if (!filters.includeDisposals) {
      return lots.map(({ lot, holding, security }) => ({
        ...lot,
        holding,
        security,
      }));
    }

    const withDisposals = [];
    for (const { lot, holding, security } of lots) {
      const disposals = await db
        .select()
        .from(taxLotDisposals)
        .where(eq(taxLotDisposals.taxLotId, lot.id))
        .orderBy(desc(taxLotDisposals.disposedDate));

      withDisposals.push({
        ...lot,
        holding,
        security,
        disposals,
      });
    }

    return withDisposals;
  }

  async createTransaction(
    data: CreateInvestmentTransactionInput,
    householdId: string
  ) {
    // H1 FIX: Validate account and holding ownership BEFORE starting transaction
    await this.validateAccountOwnership(data.accountId, householdId);
    if (data.holdingId) {
      await this.validateHoldingOwnership(
        data.holdingId,
        householdId,
        data.accountId,
        data.securityId
      );
    }

    // P0-1 & P0-2 FIX: Use transaction for atomicity, update holdings, validate overdraft
    return await withTransaction(async (tx) => {
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
            `Insufficient shares to sell. Available: ${currentQuantity.toString()}, Requested: ${sellQuantity.toString()}`
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
        currency: data.currency,
        amountZmw: data.amountZmw ?? null,
        fxRate: data.fxRate ?? null,
        transactionDate: data.transactionDate,
      };

      const [transaction] = await tx
        .insert(investmentTransactions)
        .values(insertData)
        .returning();

      // Tax lot tracking for buy/sell transactions.
      if (data.holdingId && data.quantity && (data.type === "buy" || data.type === "sell")) {
        const quantity = new Money(String(data.quantity));
        const amount = new Money(String(data.amount));

        if (data.type === "buy") {
          const taxLotInsert: InsertTaxLot = {
            householdId,
            holdingId: data.holdingId,
            transactionId: transaction.id,
            quantity: this.toQtyString(data.quantity),
            costBasis: amount.toString(),
            costBasisZmw: data.amountZmw ? new Money(String(data.amountZmw)).toString() : null,
            acquiredDate: data.transactionDate,
            acquisitionFxRate: data.fxRate ? String(data.fxRate) : null,
            remainingQuantity: this.toQtyString(data.quantity),
          };
          await tx.insert(taxLots).values(taxLotInsert);
        } else {
          const lots = await tx
            .select()
            .from(taxLots)
            .where(
              and(
                eq(taxLots.householdId, householdId),
                eq(taxLots.holdingId, data.holdingId),
                sql`CAST(${taxLots.remainingQuantity} AS DECIMAL) > 0`
              )
            )
            .orderBy(asc(taxLots.acquiredDate), asc(taxLots.createdAt));

          const availableQuantity = lots.reduce(
            (sum, lot) => sum.add(lot.remainingQuantity ?? "0"),
            Money.zero()
          );

          if (availableQuantity.lt(quantity)) {
            throw new ConflictError(
              `Insufficient tax lot quantity. Available: ${availableQuantity.amount.toFixed(8)}, Requested: ${quantity.amount.toFixed(8)}`
            );
          }

          let remainingToDispose = Money.from(quantity);
          const proceedsPerShare = amount.divide(quantity.amount);
          const proceedsPerShareZmw = data.amountZmw
            ? new Money(String(data.amountZmw)).divide(quantity.amount)
            : null;

          for (const lot of lots) {
            if (remainingToDispose.isZero()) break;

            const lotRemaining = new Money(lot.remainingQuantity ?? "0");
            if (lotRemaining.isZero()) continue;

            const disposeQuantity = lotRemaining.lte(remainingToDispose)
              ? lotRemaining
              : remainingToDispose;

            const lotTotalQuantity = new Money(lot.quantity ?? "0");
            const lotCostBasis = new Money(lot.costBasis ?? "0");
            const disposalCostBasis = lotCostBasis
              .multiply(disposeQuantity.amount)
              .divide(lotTotalQuantity.amount);

            const disposalProceeds = proceedsPerShare.multiply(disposeQuantity.amount);
            const disposalProceedsZmw = proceedsPerShareZmw
              ? proceedsPerShareZmw.multiply(disposeQuantity.amount)
              : null;
            const disposalCostBasisZmw =
              lot.costBasisZmw !== null && lot.costBasisZmw !== undefined
                ? new Money(lot.costBasisZmw)
                    .multiply(disposeQuantity.amount)
                    .divide(lotTotalQuantity.amount)
                : null;

            const disposalInsert: InsertTaxLotDisposal = {
              householdId,
              holdingId: data.holdingId,
              taxLotId: lot.id,
              transactionId: transaction.id,
              quantity: disposeQuantity.amount.toFixed(8),
              proceeds: disposalProceeds.toString(),
              proceedsZmw: disposalProceedsZmw ? disposalProceedsZmw.toString() : null,
              costBasis: disposalCostBasis.toString(),
              costBasisZmw: disposalCostBasisZmw ? disposalCostBasisZmw.toString() : null,
              realizedGain: disposalProceeds.subtract(disposalCostBasis).toString(),
              realizedGainZmw:
                disposalProceedsZmw && disposalCostBasisZmw
                  ? disposalProceedsZmw.subtract(disposalCostBasisZmw).toString()
                  : null,
              disposedDate: data.transactionDate,
            };

            await tx.insert(taxLotDisposals).values(disposalInsert);

            const newRemaining = lotRemaining.subtract(disposeQuantity);
            await tx
              .update(taxLots)
              .set({
                remainingQuantity: newRemaining.amount.toFixed(8),
                updatedAt: new Date(),
              })
              .where(eq(taxLots.id, lot.id));

            remainingToDispose = remainingToDispose.subtract(disposeQuantity);
          }
        }
      }

      // P0-1 FIX: Update holding quantity for BUY/SELL transactions
      if (data.holdingId && data.quantity) {
        if (data.type === "buy") {
          await tx
            .update(holdings)
            .set({
              quantity: sql`CAST(${holdings.quantity} AS DECIMAL) + ${data.quantity}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(holdings.id, data.holdingId),
                eq(holdings.householdId, householdId)
              )
            );
        } else if (data.type === "sell") {
          await tx
            .update(holdings)
            .set({
              quantity: sql`CAST(${holdings.quantity} AS DECIMAL) - ${data.quantity}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(holdings.id, data.holdingId),
                eq(holdings.householdId, householdId)
              )
            );
        }
        // DIVIDEND and SPLIT transactions don't affect quantity directly
      }

      return transaction;
    });
  }

  private toQtyString(value: string | number): string {
    return new Money(String(value)).amount.toFixed(8);
  }
}

export const investmentService = new InvestmentService();
