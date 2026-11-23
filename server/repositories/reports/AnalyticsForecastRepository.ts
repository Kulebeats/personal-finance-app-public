import type { MoneyDto } from "@shared/money";
import {
  DEFAULT_CUSTOM_CHART_PERIOD, canUseCustomChartMetric, customChartComparison, customChartGroup,
  type CustomChartPeriod, type CustomChartQueryConfig, type ReportsCashflowResponse, type ReportsCustomResponse,
} from "@shared/reports";
import { ValidationError } from "../../core/errors";
import { Money } from "../../core/money";
import { moneyFromDto, percentOf } from "./moneyUtils";
import type { SpendingReportRepository } from "./SpendingReportRepository";
import type { CashflowReportRepository } from "./CashflowReportRepository";
import type { NetWorthReportRepository } from "./NetWorthReportRepository";
import type Decimal from "decimal.js";
import { chartAmount, chartPercent, chartPoints, chartTotals, type ChartRow } from "./customChartMoney";

const MAX_CHART_GROUPS = 25;

export type AnalyticsForecastContext = {
  getHouseholdCurrency: (householdId: string) => Promise<string>;
  spending: Pick<SpendingReportRepository, "getSpendingBreakdown">;
  cashflow: Pick<CashflowReportRepository, "getCashflow">;
  netWorth: Pick<NetWorthReportRepository, "getNetWorth">;
};

export async function getForecast(
  ctx: AnalyticsForecastContext,
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
  const {
    metric,
    projectionMonths,
    baselineMonths = 12,
    confidenceLevel = 0.95,
    scope = "household",
    userId,
  } = query;
  const currency = await ctx.getHouseholdCurrency(householdId);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - baselineMonths);

  const from = startDate.toISOString().split("T")[0]!;
  const to = endDate.toISOString().split("T")[0]!;

  let dataPoints: Array<{ x: number; y: number }> = [];
  const toNumber = (value?: MoneyDto) =>
    value ? moneyFromDto(value, currency).toNumber() : 0;

  if (metric === "net-worth") {
    const nwData = await ctx.netWorth.getNetWorth(householdId, {
      from,
      to,
      interval: "month",
      scope: scope as "household" | "mine",
      userId,
    });
    dataPoints = (nwData.series[0]?.data || []).map((d, i) => ({
      x: i,
      y: toNumber(d.y),
    }));
  } else if (
    metric === "expenses" ||
    metric === "income" ||
    metric === "net-savings"
  ) {
    const cashflowData = await ctx.cashflow.getCashflow(householdId, {
      from,
      to,
      interval: "month",
      scope: scope as "household" | "mine",
      userId,
    });

    dataPoints = cashflowData.series.map((s, i) => ({
      x: i,
      y:
        metric === "expenses"
          ? toNumber(s.expenses)
          : metric === "income"
          ? toNumber(s.income)
          : toNumber(s.savings),
    }));
  } else {
    const cashflowData = await ctx.cashflow.getCashflow(householdId, {
      from,
      to,
      interval: "month",
      scope: scope as "household" | "mine",
      userId,
    });
    dataPoints = cashflowData.series.map((s, i) => ({
      x: i,
      y: toNumber(s.savings),
    }));
  }

  const { generateForecast } = await import("../../utils/forecasting");
  const result = generateForecast(
    dataPoints,
    projectionMonths,
    confidenceLevel
  );

  return {
    metric,
    baseline: result.baseline,
    projection: result.projection,
    confidenceLevel,
  };
}

function chartPeriodLabel(date: string, period: CustomChartPeriod, monthlyLabel: string): string {
  if (period === "monthly") return monthlyLabel;
  const year = date.slice(0, 4);
  if (period === "annual") return year;
  const monthIndex = Number(date.slice(5, 7)) - 1;
  return period === "biannual" ? `H${Math.floor(monthIndex / 6) + 1} ${year}` : `Q${Math.floor(monthIndex / 3) + 1} ${year}`;
}

function bucketChartCashflow(series: ReportsCashflowResponse["series"], period: CustomChartPeriod, currency: string) {
  const buckets = new Map<string, { label: string; income: Money; expenses: Money; savings: Money }>();
  const money = (value: MoneyDto) => new Money(chartAmount(value, currency), currency);
  for (const entry of series) {
    const label = chartPeriodLabel(entry.periodStart, period, entry.label);
    const previous = buckets.get(label);
    const income = money(entry.income);
    const expenses = money(entry.expenses);
    const savings = money(entry.savings);
    buckets.set(label, {
      label,
      income: previous ? previous.income.add(income) : income,
      expenses: previous ? previous.expenses.add(expenses) : expenses,
      savings: previous ? previous.savings.add(savings) : savings,
    });
  }
  return [...buckets.values()];
}

export async function executeCustomChart(
  ctx: AnalyticsForecastContext,
  householdId: string,
  body: {
    config: CustomChartQueryConfig;
    from: string;
    to: string;
    scope?: string;
    userId?: string;
  }
): Promise<ReportsCustomResponse> {
  const { config, from, to, scope = "household", userId } = body;
  if (!canUseCustomChartMetric(config.primaryMetric)) throw new ValidationError("Unsupported custom chart metric");
  const groupBy = customChartGroup(config.primaryMetric, config.groupBy);
  if (config.groupBy && config.groupBy !== "none" && !groupBy) {
    throw new ValidationError("Only income and expenses can be grouped");
  }
  const secondaryMetric = customChartComparison(config.primaryMetric, groupBy, config.secondaryMetric);
  const period = config.period ?? DEFAULT_CUSTOM_CHART_PERIOD;
  const currency = await ctx.getHouseholdCurrency(householdId);
  // Every value is summed in Money; one in another currency is a missing rate.
  const amount = (value?: MoneyDto | null) => chartAmount(value, currency);

  // Validate time window (max 36 months)
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const monthsDiff =
    (toDate.getUTCFullYear() - fromDate.getUTCFullYear()) * 12 +
    (toDate.getUTCMonth() - fromDate.getUTCMonth());
  if (monthsDiff > 36) {
    throw new Error("Custom chart time window cannot exceed 36 months");
  }

  let rows: ChartRow[] = [];
  let breakdownTotal: Decimal | undefined;
  let savingsRateTotal: number | undefined;

  if (groupBy) {
    const type = config.primaryMetric === "income" ? "income" : "expense";

    const breakdown = await ctx.spending.getSpendingBreakdown(householdId, {
      from,
      to,
      groupBy,
      type,
      scope: scope as "household" | "mine",
      userId,
    });

    // Max 25 buckets
    rows = breakdown.items.slice(0, MAX_CHART_GROUPS).map((item) => ({
      label: item.label,
      primary: amount(item.value),
      groupKey: item.entityId,
    }));
    breakdownTotal = amount(breakdown.total);
  } else {
    let seriesData: ChartRow[] = [];

    if (config.primaryMetric === "netWorth") {
      const result = await ctx.netWorth.getNetWorth(householdId, {
        from,
        to,
        interval: "month",
        scope: scope as "household" | "mine",
        userId,
      });
      // Net worth is a balance. The source is ordered by date, so keep the
      // last observation in each period and skip periods without an observation.
      const balances = new Map<string, ChartRow>();
      for (const point of result.series[0]?.data ?? []) {
        const label = chartPeriodLabel(point.x, period, point.x);
        const key = period === "monthly" ? point.x.slice(0, 7) : label;
        balances.set(key, { label, primary: amount(point.y) });
      }
      seriesData = [...balances.values()];
    } else {
      const cashflowData = await ctx.cashflow.getCashflow(householdId, {
        from,
        to,
        interval: "month",
        scope: scope as "household" | "mine",
        userId,
      });
      if (config.primaryMetric === "savingsRate") {
        savingsRateTotal = cashflowData.totals.savingsRate;
      }

      seriesData = bucketChartCashflow(cashflowData.series, period, currency).map((s) => {
        let primary: Decimal;
        switch (config.primaryMetric) {
          case "income":
            primary = s.income.amount;
            break;
          case "expenses":
            primary = s.expenses.amount;
            break;
          case "netSavings":
          case "savings":
            primary = s.savings.amount;
            break;
          case "savingsRate":
            primary = chartPercent(percentOf(s.savings, s.income));
            break;
          default:
            throw new ValidationError("Unsupported custom chart metric");
        }

        let secondary: Decimal | undefined;
        switch (secondaryMetric) {
          case "income":
            secondary = s.income.amount;
            break;
          case "expenses":
            secondary = s.expenses.amount;
            break;
          case "savings":
            secondary = s.savings.amount;
            break;
        }

        return { label: s.label, primary, secondary };
      });
    }

    rows = seriesData;
  }

  return {
    chartId: config.name ? undefined : undefined,
    config: { ...config, secondaryMetric },
    data: chartPoints(rows),
    totals: savingsRateTotal === undefined
      ? chartTotals(rows, !!secondaryMetric, breakdownTotal)
      : { primary: savingsRateTotal },
  };
}
