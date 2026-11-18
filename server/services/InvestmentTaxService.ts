import { db } from "../db";
import {
  investmentTransactions,
  accounts,
  securities,
  taxLotDisposals,
} from "@shared/schema";
import { eq, and, sql, gte, lte, inArray } from "drizzle-orm";
import { startOfYear, endOfYear } from "date-fns";
import { Money } from "../core/money";

// ZRA (Zambia Revenue Authority) tax reporting is always denominated in ZMW,
// independent of the household's own display currency (Rule 1: this is a
// REGULATORY output, and mixing in the household currency here would be a
// semantic change out of scope for this packet).
const REPORTING_CURRENCY = "ZMW";

export interface TaxYearSummary {
  year: number;
  // Decimal strings (MoneyDto convention) - not JS numbers - so exact
  // regulatory amounts never pick up IEEE-754 float error on serialization.
  realizedGains: string;
  interestIncome: string;
  dividendIncome: string;
  grossIncome: string;
  totalWht: string;
  netIncome: string;
  currency: string;
}

export interface ZraExportRow {
  date: string;
  type: string;
  security: string;
  grossAmount: string;
  whtPaid: string;
  netAmount: string;
  institution: string;
}

export class InvestmentTaxService {
  /**
   * Get tax summary for a specific year
   */
  async getTaxSummary(
    householdId: string,
    year: number
  ): Promise<TaxYearSummary> {
    const startDate = startOfYear(new Date(year, 0, 1))
      .toISOString()
      .split("T")[0];
    const endDate = endOfYear(new Date(year, 0, 1))
      .toISOString()
      .split("T")[0];

    // 1. Get Investment Account IDs
    const userAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.householdId, householdId));

    const accountIds = userAccounts.map((a) => a.id);
    if (accountIds.length === 0) {
      return this.emptySummary(year);
    }

    // 2. Fetch Transactions
    const txs = await db
      .select({
        type: investmentTransactions.type,
        amount: investmentTransactions.amount,
        withholdingTax: investmentTransactions.withholdingTax,
      })
      .from(investmentTransactions)
      .where(
        and(
          inArray(investmentTransactions.accountId, accountIds),
          gte(investmentTransactions.transactionDate, startDate),
          lte(investmentTransactions.transactionDate, endDate)
        )
      );

    let interestIncome = Money.zero(REPORTING_CURRENCY);
    let dividendIncome = Money.zero(REPORTING_CURRENCY);
    let totalWht = Money.zero(REPORTING_CURRENCY);

    for (const tx of txs) {
      const amount = Money.from(tx.amount, REPORTING_CURRENCY);
      const wht = Money.from(tx.withholdingTax ?? "0", REPORTING_CURRENCY);

      // Accumulate WHT
      totalWht = totalWht.add(wht);

      // Classify Income
      // 'amount' in DB is usually the cashflow.
      // If it's income, cashflow is Net or Gross?
      // Assuming 'amount' is NET received in account.
      // Gross = Net + WHT.
      // Re-read schema: 'amount' decimal, 'withholdingTax' decimal.
      // Typically amount is "impact on balance". So Net.

      const gross = amount.add(wht);

      if (tx.type === "interest" || tx.type === "coupon") {
        interestIncome = interestIncome.add(gross);
      } else if (tx.type === "dividend") {
        dividendIncome = dividendIncome.add(gross);
      }
    }

    const disposals = await db
      .select({
        realizedGain: taxLotDisposals.realizedGain,
        realizedGainZmw: taxLotDisposals.realizedGainZmw,
      })
      .from(taxLotDisposals)
      .where(
        and(
          eq(taxLotDisposals.householdId, householdId),
          gte(taxLotDisposals.disposedDate, startDate),
          lte(taxLotDisposals.disposedDate, endDate)
        )
      );

    let realizedGains = Money.zero(REPORTING_CURRENCY);
    for (const disposal of disposals) {
      const gainZmw =
        disposal.realizedGainZmw !== null
          ? Money.from(disposal.realizedGainZmw, REPORTING_CURRENCY)
          : Money.from(disposal.realizedGain, REPORTING_CURRENCY);
      realizedGains = realizedGains.add(gainZmw);
    }

    const grossIncome = interestIncome
      .add(dividendIncome)
      .add(realizedGains);
    const netIncome = grossIncome.subtract(totalWht);

    return {
      year,
      realizedGains: realizedGains.toString(),
      interestIncome: interestIncome.toString(),
      dividendIncome: dividendIncome.toString(),
      grossIncome: grossIncome.toString(),
      totalWht: totalWht.toString(),
      netIncome: netIncome.toString(),
      currency: REPORTING_CURRENCY, // Reporting currency
    };
  }

  /**
   * Get ZRA Export Data
   */
  async getZraExport(
    householdId: string,
    year: number
  ): Promise<ZraExportRow[]> {
    const startDate = startOfYear(new Date(year, 0, 1))
      .toISOString()
      .split("T")[0];
    const endDate = endOfYear(new Date(year, 0, 1))
      .toISOString()
      .split("T")[0];

    const userAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.householdId, householdId));

    const accountIds = userAccounts.map((a) => a.id);
    if (accountIds.length === 0) return [];

    const results = await db
      .select({
        date: investmentTransactions.transactionDate,
        type: investmentTransactions.type,
        amount: investmentTransactions.amount,
        wht: investmentTransactions.withholdingTax,
        securityName: securities.name,
        securitySymbol: securities.symbol,
      })
      .from(investmentTransactions)
      .leftJoin(
        securities,
        eq(investmentTransactions.securityId, securities.id)
      )
      .where(
        and(
          inArray(investmentTransactions.accountId, accountIds),
          gte(investmentTransactions.transactionDate, startDate),
          lte(investmentTransactions.transactionDate, endDate),
          // Filter for income types only
          inArray(investmentTransactions.type, [
            "interest",
            "dividend",
            "coupon",
          ])
        )
      );

    return results.map((r) => {
      const net = Money.from(r.amount, REPORTING_CURRENCY);
      const wht = Money.from(r.wht ?? "0", REPORTING_CURRENCY);
      const gross = net.add(wht);

      return {
        date: r.date as string,
        type: r.type,
        security: r.securityName || r.securitySymbol || "Unknown",
        grossAmount: gross.toString(),
        whtPaid: wht.toString(),
        netAmount: net.toString(),
        institution: "Various", // Could fetch from account?
      };
    });
  }

  private emptySummary(year: number): TaxYearSummary {
    const zero = Money.zero(REPORTING_CURRENCY).toString();
    return {
      year,
      realizedGains: zero,
      interestIncome: zero,
      dividendIncome: zero,
      grossIncome: zero,
      totalWht: zero,
      netIncome: zero,
      currency: REPORTING_CURRENCY,
    };
  }
}

export const investmentTaxService = new InvestmentTaxService();
