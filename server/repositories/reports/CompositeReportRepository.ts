/**
 * Composite Report Repository
 *
 * Orchestrates complex reports that aggregate data from multiple domains:
 * - getAnnualReport: annual composite report
 * - getSankey: Sankey diagram data (with helper functions)
 *
 * For financial analytics and projections, see AnalyticsReportRepository:
 * - getFinancialRatios, getDebtAnalysis, getGoalsProgress
 * - getForecast, executeCustomChart
 *
 * MIGRATION STATUS: Split into CompositeReportRepository (orchestration) and
 *                   AnalyticsReportRepository (analytics/projections)
 *
 * @module repositories/reports/CompositeReportRepository
 */

import { BaseReportRepository } from "./BaseReportRepository";
import { SpendingReportRepository } from "./SpendingReportRepository";
import { CashflowReportRepository } from "./CashflowReportRepository";
import { NetWorthReportRepository } from "./NetWorthReportRepository";
import {
  buildIncomeToExpenseGroups,
  buildAccountToExpenseGroups,
  buildIncomeToCategories,
  type SankeyFilters,
  type SankeyNode,
  type SankeyLink,
} from "./SankeyHelpers";
import type {
  ReportsAnnualResponse,
  ReportsSankeyResponse,
} from "@shared/reports";
import type { MoneyDto } from "@shared/money";
import { Money, toMoneyDto } from "../../core/money";
import type {
  ReportsAnnualQuery,
  ReportsSankeyQuery,
} from "../../modules/reports/reports.validation";
import type { QueryWithUser } from "./types";
import {
  moneyFromDto,
  percentOf,
  toMoneyDtoSafe,
} from "./moneyUtils";

/**
 * Repository for composite/orchestration reports.
 * Uses dependency injection for sub-repositories.
 */
export class CompositeReportRepository extends BaseReportRepository {
  constructor(
    private spending: SpendingReportRepository = new SpendingReportRepository(),
    private cashflow: CashflowReportRepository = new CashflowReportRepository(),
    private netWorth: NetWorthReportRepository = new NetWorthReportRepository()
  ) {
    super();
  }

  // =====================================================================
  // Orchestration Methods
  // =====================================================================

  /**
   * Get annual report (composite)
   * Original: ReportRepository lines 1021-1252
   */
  async getAnnualReport(
    householdId: string,
    query: QueryWithUser<ReportsAnnualQuery>
  ): Promise<ReportsAnnualResponse> {
    const {
      year,
      compareYear,
      scope = "household",
      includePending = false,
      includeTransfers = false,
      userId,
      timezone,
    } = query;

    const baseCurrency = await this.getHouseholdCurrency(householdId);
    const toMoneyValue = (value: Money) => toMoneyDtoSafe(value, baseCurrency);

    const from = `${year}-01-01`;
    const to = `${year}-12-31`;

    const fromDate = new Date(from);
    const toDate = new Date(to);
    const today = new Date();
    const effectiveEnd = toDate > today ? today : toDate;
    const monthsInRange = Math.max(
      1,
      (effectiveEnd.getFullYear() - fromDate.getFullYear()) * 12 +
        (effectiveEnd.getMonth() - fromDate.getMonth()) +
        1
    );

    // Get cashflow data using injected repository
    const cashflowData = await this.cashflow.getCashflow(householdId, {
      from,
      to,
      interval: "month",
      scope,
      includePending,
      includeTransfers,
      userId,
      timezone,
    });

    // Get net worth for beginning and end of year
    const netWorthData = await this.netWorth.getNetWorth(householdId, {
      from,
      to,
      interval: "month",
      scope,
      userId,
    });

    const netWorthSeries = netWorthData.series[0]?.data || [];
    const beginningNetWorth = netWorthSeries[0]?.y
      ? moneyFromDto(netWorthSeries[0].y as MoneyDto, baseCurrency)
      : Money.zero(baseCurrency);
    const endingNetWorth =
      netWorthSeries[netWorthSeries.length - 1]?.y
        ? moneyFromDto(
            netWorthSeries[netWorthSeries.length - 1].y as MoneyDto,
            baseCurrency
          )
        : beginningNetWorth;
    const totalNetWorthChange = endingNetWorth.subtract(beginningNetWorth);
    const avgMonthlyNetWorthChange =
      monthsInRange > 0
        ? totalNetWorthChange.divide(monthsInRange)
        : Money.zero(baseCurrency);

    // Calculate totals
    const incomeTotal = moneyFromDto(cashflowData.totals.income, baseCurrency);
    const expensesTotal = moneyFromDto(
      cashflowData.totals.expenses,
      baseCurrency
    );
    const savingsTotal = moneyFromDto(
      cashflowData.totals.savings,
      baseCurrency
    );
    const debtTotal = moneyFromDto(cashflowData.totals.debt, baseCurrency);
    const netSavingsTotal = incomeTotal.subtract(expensesTotal);

    const totals = {
      income: toMoneyValue(incomeTotal),
      expenses: toMoneyValue(expensesTotal),
      savingsContributions: toMoneyValue(savingsTotal),
      netSavings: toMoneyValue(netSavingsTotal),
      debtPaid: toMoneyValue(debtTotal),
      netWorth: toMoneyValue(endingNetWorth),
      savingsRate: percentOf(savingsTotal, incomeTotal, 2),
      netSavingsRate: percentOf(netSavingsTotal, incomeTotal, 2),
      totalNetWorthChange: toMoneyValue(totalNetWorthChange),
      avgMonthlyNetWorthChange: toMoneyValue(avgMonthlyNetWorthChange),
    };

    // Build monthly data
    const monthly = cashflowData.series.map((s, idx) => {
      const prevNetWorth =
        idx > 0 && netWorthSeries[idx - 1]?.y
          ? moneyFromDto(netWorthSeries[idx - 1].y as MoneyDto, baseCurrency)
          : netWorthSeries[0]?.y
          ? moneyFromDto(netWorthSeries[0].y as MoneyDto, baseCurrency)
          : Money.zero(baseCurrency);
      const currNetWorth = netWorthSeries[idx]?.y
        ? moneyFromDto(netWorthSeries[idx].y as MoneyDto, baseCurrency)
        : prevNetWorth;
      const netWorthChange = currNetWorth.subtract(prevNetWorth);
      const income = moneyFromDto(s.income, baseCurrency);
      const expenses = moneyFromDto(s.expenses, baseCurrency);
      const netSavings = income.subtract(expenses);
      const netSavingsRate = percentOf(netSavings, income, 2);

      return {
        month: s.label, periodStart: s.periodStart,
        monthIndex: idx,
        income: s.income,
        expenses: s.expenses,
        savingsContributions: s.savings,
        netSavings: toMoneyValue(netSavings),
        savingsRate: s.savingsRate,
        netSavingsRate,
        debtPaid: s.debt,
        netWorthChange: toMoneyValue(netWorthChange),
      };
    });

    // Build cumulative series in the expected format
    let cumulativeIncome = Money.zero(baseCurrency);
    let cumulativeExpenses = Money.zero(baseCurrency);
    let cumulativeSavings = Money.zero(baseCurrency);
    let cumulativeDebt = Money.zero(baseCurrency);

    const monthLabels = cashflowData.series.map((s) => s.label);
    const incomeData: Array<{ x: string; y: MoneyDto }> = [];
    const expensesData: Array<{ x: string; y: MoneyDto }> = [];
    const savingsData: Array<{ x: string; y: MoneyDto }> = [];
    const debtData: Array<{ x: string; y: MoneyDto }> = [];
    const nwSeriesData: Array<{ x: string; y: MoneyDto }> = [];

    cashflowData.series.forEach((s, idx) => {
      cumulativeIncome = cumulativeIncome.add(
        moneyFromDto(s.income, baseCurrency)
      );
      cumulativeExpenses = cumulativeExpenses.add(
        moneyFromDto(s.expenses, baseCurrency)
      );
      cumulativeSavings = cumulativeSavings.add(
        moneyFromDto(s.savings, baseCurrency)
      );
      cumulativeDebt = cumulativeDebt.add(
        moneyFromDto(s.debt, baseCurrency)
      );

      incomeData.push({ x: s.label, y: toMoneyValue(cumulativeIncome) });
      expensesData.push({ x: s.label, y: toMoneyValue(cumulativeExpenses) });
      savingsData.push({ x: s.label, y: toMoneyValue(cumulativeSavings) });
      debtData.push({ x: s.label, y: toMoneyValue(cumulativeDebt) });
      nwSeriesData.push({
        x: s.label,
        y: netWorthSeries[idx]?.y
          ? toMoneyValue(
              moneyFromDto(netWorthSeries[idx].y as MoneyDto, baseCurrency)
            )
          : toMoneyValue(Money.zero(baseCurrency)),
      });
    });

    const cumulativeSeries: Array<{
      id:
        | "Income"
        | "Expenses"
        | "SavingsContributions"
        | "DebtPaid"
        | "NetWorth";
      color?: string;
      data: Array<{ x: string; y: MoneyDto }>;
    }> = [
      { id: "Income", data: incomeData },
      { id: "Expenses", data: expensesData },
      { id: "SavingsContributions", data: savingsData },
      { id: "DebtPaid", data: debtData },
      { id: "NetWorth", data: nwSeriesData },
    ];

    // Get breakdowns using spending repository
    const incomeBreakdown = await this.spending.getSpendingBreakdown(
      householdId,
      {
        from,
        to,
        groupBy: "category",
        type: "income",
        scope,
        userId,
      }
    );

    const expenseBreakdown = await this.spending.getSpendingBreakdown(
      householdId,
      {
        from,
        to,
        groupBy: "categoryGroup",
        type: "expense",
        scope,
        userId,
      }
    );

    // Handle comparison year (if provided)
    let comparison:
      | {
          incomeChangePct: number;
          expensesChangePct: number;
          savingsContributionsChangePct: number;
          netSavingsChangePct: number;
          debtPaidChangePct: number;
          netWorthChangePct: number;
        }
      | undefined;

    if (compareYear) {
      const prevFrom = `${compareYear}-01-01`;
      const prevTo = `${compareYear}-12-31`;

      const prevCashflow = await this.cashflow.getCashflow(householdId, {
        from: prevFrom,
        to: prevTo,
        interval: "month",
        scope,
        userId,
      });

      const prevNetWorth = await this.netWorth.getNetWorth(householdId, {
        from: prevFrom,
        to: prevTo,
        interval: "month",
        scope,
        userId,
      });

      const prevNwSeries = prevNetWorth.series[0]?.data || [];
      const prevEndingNetWorth =
        prevNwSeries[prevNwSeries.length - 1]?.y
          ? moneyFromDto(
              prevNwSeries[prevNwSeries.length - 1].y as MoneyDto,
              baseCurrency
            )
          : prevNwSeries[0]?.y
          ? moneyFromDto(prevNwSeries[0].y as MoneyDto, baseCurrency)
          : endingNetWorth;

      comparison = {
        incomeChangePct: percentOf(
          incomeTotal.subtract(
            moneyFromDto(prevCashflow.totals.income, baseCurrency)
          ),
          moneyFromDto(prevCashflow.totals.income, baseCurrency),
          2
        ),
        expensesChangePct: percentOf(
          expensesTotal.subtract(
            moneyFromDto(prevCashflow.totals.expenses, baseCurrency)
          ),
          moneyFromDto(prevCashflow.totals.expenses, baseCurrency),
          2
        ),
        savingsContributionsChangePct: percentOf(
          savingsTotal.subtract(
            moneyFromDto(prevCashflow.totals.savings, baseCurrency)
          ),
          moneyFromDto(prevCashflow.totals.savings, baseCurrency),
          2
        ),
        netSavingsChangePct: percentOf(
          netSavingsTotal.subtract(
            moneyFromDto(prevCashflow.totals.income, baseCurrency).subtract(
              moneyFromDto(prevCashflow.totals.expenses, baseCurrency)
            )
          ),
          moneyFromDto(prevCashflow.totals.income, baseCurrency).subtract(
            moneyFromDto(prevCashflow.totals.expenses, baseCurrency)
          ),
          2
        ),
        debtPaidChangePct: percentOf(
          debtTotal.subtract(
            moneyFromDto(prevCashflow.totals.debt, baseCurrency)
          ),
          moneyFromDto(prevCashflow.totals.debt, baseCurrency),
          2
        ),
        netWorthChangePct: percentOf(
          endingNetWorth.subtract(prevEndingNetWorth),
          prevEndingNetWorth,
          2
        ),
      };
    }

    return {
      year,
      compareYear,
      baseCurrency,
      monthsInRange,
      totals,
      monthly,
      cumulativeSeries,
      comparison,
      breakdown: {
        income: incomeBreakdown.items.map((i) => ({
          id: i.id,
          label: i.label,
          value: i.value,
          color: i.color,
          entityId: i.entityId,
        })),
        expenses: expenseBreakdown.items.map((i) => ({
          id: i.id,
          label: i.label,
          value: i.value,
          color: i.color,
          entityId: i.entityId,
        })),
        savingsContributions: [],
      },
    };
  }

  // =====================================================================
  // Sankey Diagram (uses helper functions)
  // =====================================================================

  /**
   * Get Sankey diagram data
   * Original: ReportRepository lines 1258-1822 (~560 LOC)
   * Now uses focused helper functions for better testability
   */
  async getSankey(
    householdId: string,
    query: QueryWithUser<ReportsSankeyQuery>
  ): Promise<ReportsSankeyResponse> {
    const {
      from,
      to,
      mode = "income_to_expense_groups",
      maxNodes = 10,
      includeSavingsNode = true,
      scope = "household",
      includePending = false,
      includeTransfers = false,
      userId,
    } = query;

    const baseCurrency = await this.getHouseholdCurrency(householdId);

    // SCP-321: fail closed — the builders' rate expression falls back to 1.
    await this.assertFxRatesAvailable(householdId, baseCurrency, {
      from, to, includePending, scope, userId,
    });

    const filters: SankeyFilters = {
      householdId,
      from,
      to,
      baseCurrency,
      scope,
      userId,
      includePending,
      includeTransfers,
    };

    let result: {
      nodes: SankeyNode[];
      links: SankeyLink[];
      totalIncome: Money;
      totalExpenses: Money;
    };

    switch (mode) {
      case "income_to_expense_groups":
        result = await buildIncomeToExpenseGroups(
          filters,
          maxNodes,
          includeSavingsNode
        );
        break;

      case "account_to_expense_groups":
        result = await buildAccountToExpenseGroups(filters, maxNodes);
        break;

      case "expense_groups_to_categories":
      default:
        result = await buildIncomeToCategories(filters, maxNodes);
        break;
    }

    return {
      range: { from, to, baseCurrency },
      mode,
      totals: {
        income: toMoneyDto(result.totalIncome, baseCurrency),
        expenses: toMoneyDto(result.totalExpenses, baseCurrency),
        savings: toMoneyDto(
          result.totalIncome.subtract(result.totalExpenses),
          baseCurrency
        ),
      },
      sankey: {
        nodes: result.nodes.map((n) => ({
          id: n.id,
          nodeColor: n.nodeColor,
          entityType: n.entityType as
            | "categoryGroup"
            | "category"
            | "merchant"
            | "account"
            | "synthetic",
          entityId: n.entityId,
        })),
        links: result.links.map((link) => ({
          ...link,
          value: toMoneyDto(link.value, baseCurrency),
        })),
      },
    };
  }
}

// Singleton instance
export const compositeReportRepository = new CompositeReportRepository();
