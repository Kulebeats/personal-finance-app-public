import type { MoneyDto } from "@shared/money";
import { moneyFromDto } from "./moneyUtils";
import type { SpendingReportRepository } from "./SpendingReportRepository";
import type { CashflowReportRepository } from "./CashflowReportRepository";
import type { NetWorthReportRepository } from "./NetWorthReportRepository";

export type AnalyticsForecastContext = {
  getHouseholdCurrency: (householdId: string) => Promise<string>;
  spending: SpendingReportRepository;
  cashflow: CashflowReportRepository;
  netWorth: NetWorthReportRepository;
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

export async function executeCustomChart(
  ctx: AnalyticsForecastContext,
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
  const { config, from, to, scope = "household", userId } = body;
  const currency = await ctx.getHouseholdCurrency(householdId);
  const toNumber = (value?: MoneyDto) =>
    value ? moneyFromDto(value, currency).toNumber() : 0;

  // Validate time window (max 36 months)
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const monthsDiff =
    (toDate.getFullYear() - fromDate.getFullYear()) * 12 +
    (toDate.getMonth() - fromDate.getMonth());
  if (monthsDiff > 36) {
    throw new Error("Custom chart time window cannot exceed 36 months");
  }

  let data: Array<{
    label: string;
    primary: number;
    secondary?: number;
    groupKey?: string;
  }> = [];
  let totals = {
    primary: 0,
    secondary: undefined as number | undefined,
    average: undefined as number | undefined,
  };

  if (config.groupBy && config.groupBy !== "none") {
    const type = config.primaryMetric === "income" ? "income" : "expense";

    const breakdown = await ctx.spending.getSpendingBreakdown(householdId, {
      from,
      to,
      groupBy: config.groupBy as
        | "categoryGroup"
        | "category"
        | "merchant"
        | "merchantCategory"
        | "tag",
      type,
      scope: scope as "household" | "mine",
      userId,
    });

    // Max 25 buckets
    if (breakdown.items.length > 25) {
      data = breakdown.items.slice(0, 25).map((item) => ({
        label: item.label,
        primary: toNumber(item.value),
        groupKey: item.entityId,
      }));
    } else {
      data = breakdown.items.map((item) => ({
        label: item.label,
        primary: toNumber(item.value),
        groupKey: item.entityId,
      }));
    }

    totals.primary = toNumber(breakdown.total);
    totals.average = data.length > 0 ? totals.primary / data.length : 0;
  } else {
    let seriesData: typeof data = [];

    if (config.primaryMetric === "netWorth") {
      const result = await ctx.netWorth.getNetWorth(householdId, {
        from,
        to,
        interval: "month",
        scope: scope as "household" | "mine",
        userId,
      });
      seriesData =
        result.series[0]?.data.map((d) => ({
          label: d.x,
          primary: toNumber(d.y),
        })) || [];
    } else if (config.primaryMetric === "savingsRate") {
      const result = await ctx.cashflow.getSavingsRate(householdId, {
        from,
        to,
        interval: "month",
        scope: scope as "household" | "mine",
        userId,
      });
      seriesData = result.series.map((d) => ({
        label: d.label,
        primary: d.savingsRate,
      }));
    } else {
      const cashflowData = await ctx.cashflow.getCashflow(householdId, {
        from,
        to,
        interval: "month",
        scope: scope as "household" | "mine",
        userId,
      });

      seriesData = cashflowData.series.map((s) => {
        let primary = 0;
        switch (config.primaryMetric) {
          case "income":
            primary = toNumber(s.income);
            break;
          case "expenses":
            primary = toNumber(s.expenses);
            break;
          case "netSavings":
          case "savings":
          case "savingsContributions":
            primary = toNumber(s.savings);
            break;
          default:
            primary = toNumber(s.expenses);
        }

        let secondary = undefined;
        if (config.secondaryMetric) {
          switch (config.secondaryMetric) {
            case "income":
              secondary = toNumber(s.income);
              break;
            case "expenses":
              secondary = toNumber(s.expenses);
              break;
            case "savings":
              secondary = toNumber(s.savings);
              break;
          }
        }

        return { label: s.label, primary, secondary };
      });
    }

    data = seriesData;
    totals.primary = data.reduce((sum, d) => sum + d.primary, 0);
    if (config.secondaryMetric) {
      totals.secondary = data.reduce((sum, d) => sum + (d.secondary || 0), 0);
    }
    totals.average = data.length > 0 ? totals.primary / data.length : 0;
  }

  return {
    chartId: config.name ? undefined : undefined,
    config: {
      name: config.name,
      chartType: config.chartType,
      primaryMetric: config.primaryMetric,
      secondaryMetric: config.secondaryMetric,
      groupBy: config.groupBy,
      aggregation: config.aggregation,
    },
    data,
    totals,
  };
}
