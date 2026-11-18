/**
 * Analytics Report Repository
 *
 * Delegates analytics logic to focused modules:
 * - AnalyticsRatiosRepository for ratios, debt, goals
 * - AnalyticsForecastRepository for forecasts and custom charts
 *
 * @module repositories/reports/AnalyticsReportRepository
 */

import { BaseReportRepository } from "./BaseReportRepository";
import { SpendingReportRepository } from "./SpendingReportRepository";
import { CashflowReportRepository } from "./CashflowReportRepository";
import { NetWorthReportRepository } from "./NetWorthReportRepository";
import {
  getDebtAnalysis,
  getFinancialRatios,
  getGoalsProgress,
} from "./AnalyticsRatiosRepository";
import {
  executeCustomChart,
  getForecast,
} from "./AnalyticsForecastRepository";

export class AnalyticsReportRepository extends BaseReportRepository {
  constructor(
    private spending: SpendingReportRepository = new SpendingReportRepository(),
    private cashflow: CashflowReportRepository = new CashflowReportRepository(),
    private netWorth: NetWorthReportRepository = new NetWorthReportRepository()
  ) {
    super();
  }

  async getFinancialRatios(
    householdId: string,
    query: { from: string; to: string; scope?: string; userId?: string }
  ) {
    return getFinancialRatios(
      {
        getHouseholdCurrency: (id) => this.getHouseholdCurrency(id),
        cashflow: this.cashflow,
      },
      householdId,
      query
    );
  }

  async getDebtAnalysis(
    householdId: string,
    query: { from: string; to: string; scope?: string; userId?: string }
  ) {
    return getDebtAnalysis(
      {
        getHouseholdCurrency: (id) => this.getHouseholdCurrency(id),
        cashflow: this.cashflow,
      },
      householdId,
      query
    );
  }

  async getGoalsProgress(
    householdId: string,
    query: { year?: number; scope?: string; userId?: string }
  ) {
    return getGoalsProgress(
      {
        getHouseholdCurrency: (id) => this.getHouseholdCurrency(id),
        cashflow: this.cashflow,
      },
      householdId,
      query
    );
  }

  async getForecast(
    householdId: string,
    query: {
      metric: string;
      projectionMonths: number;
      baselineMonths?: number;
      confidenceLevel?: number;
      scope?: string;
      userId?: string;
    }
  ) {
    return getForecast(
      {
        getHouseholdCurrency: (id) => this.getHouseholdCurrency(id),
        spending: this.spending,
        cashflow: this.cashflow,
        netWorth: this.netWorth,
      },
      householdId,
      query
    );
  }

  async executeCustomChart(
    householdId: string,
    body: {
      config: {
        name: string;
        chartType: string;
        primaryMetric: string;
        secondaryMetric?: string;
        groupBy?: string;
        aggregation?: string;
      };
      from: string;
      to: string;
      scope?: string;
      userId?: string;
    }
  ) {
    return executeCustomChart(
      {
        getHouseholdCurrency: (id) => this.getHouseholdCurrency(id),
        spending: this.spending,
        cashflow: this.cashflow,
        netWorth: this.netWorth,
      },
      householdId,
      body
    );
  }
}

export const analyticsReportRepository = new AnalyticsReportRepository();
