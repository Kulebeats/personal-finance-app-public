import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { dataExports } from "@shared/schema";
import { exportService } from "../../services/ExportService";
import { csvMoney, type CsvDecimal } from "../../core/csv";
import {
  cashflowReportRepository,
  cashflowBudgetComparisonRepository,
  spendingReportRepository,
  netWorthReportRepository,
} from "../../repositories/reports";
import {
  validateDateRange,
  type ExportReportInput,
} from "./reports.validation";
import type { ReportScope } from "./reports.types";
import type { TransactionType } from "../../utils/withTransaction";
import { buildTransactionCsvData } from "./transactionCsvData";
import type { MoneyDto } from "@shared/money";
import type {
  ReportsExportItem,
  ReportsExportsResponse,
  ReportsCashflowResponse,
} from "@shared/reports";

type ExportListOptions = {
  householdId: string;
  userId: string;
  includeHousehold: boolean;
  status?: "pending" | "completed" | "failed";
  limit?: number;
};

type ExportDataResult = {
  rows: Record<string, unknown>[];
  columns?: string[];
  fileName: string;
  transactionIds?: string[];
};

/**
 * A cashflow series point as consumed during export. The optional `confidence`
 * bounds are only present on forecast points (getCashflowWithForecast); they are
 * absent on plain actuals, hence the optional members.
 */
type CashflowExportPoint = ReportsCashflowResponse["series"][number] & {
  confidence?: {
    income?: { low?: MoneyDto; high?: MoneyDto };
    expenses?: { low?: MoneyDto; high?: MoneyDto };
    savings?: { low?: MoneyDto; high?: MoneyDto };
    level?: number;
  };
};

const toIsoDate = (value?: Date | string | null) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split("T")[0]!;
  return value;
};

const toIsoDateTime = (value?: Date | string | null) => {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return value;
};

export const toExportItem = (
  row: typeof dataExports.$inferSelect,
  requesterId?: string,
): ReportsExportItem => ({
  id: row.id,
  userId: row.userId,
  householdId: row.householdId,
  exportType: row.exportType,
  fileFormat: row.fileFormat,
  fileUrl: row.fileUrl ?? undefined,
  dateRangeStart: toIsoDate(row.dateRangeStart),
  dateRangeEnd: toIsoDate(row.dateRangeEnd),
  recordCount: row.exportType === "transactions" && requesterId !== undefined && requesterId !== row.userId ? null : row.recordCount ?? null,
  // FIX REPORTS-EXPORT-002: Include stored parameters for reproducible downloads
  parameters: row.exportType === "transactions" && requesterId !== undefined && requesterId !== row.userId ? null : row.parameters as Record<string, unknown> | null,
  status: row.status || "pending",
  createdAt: toIsoDateTime(row.createdAt),
});

export class ReportsExportService {
  async listExports(
    options: ExportListOptions,
    tx?: TransactionType,
  ): Promise<ReportsExportsResponse> {
    const {
      householdId,
      userId,
      includeHousehold,
      status,
      limit = 25,
    } = options;

    const conditions = [eq(dataExports.householdId, householdId)];
    if (!includeHousehold) conditions.push(eq(dataExports.userId, userId));
    if (status) conditions.push(eq(dataExports.status, status));

    const rows = await (tx ?? db)
      .select()
      .from(dataExports)
      .where(and(...conditions))
      .orderBy(desc(dataExports.createdAt))
      .limit(limit);

    return { exports: rows.map(row => toExportItem(row, userId)) };
  }

  async getExportById(
    exportId: string,
    householdId: string,
    requesterId?: string,
  ): Promise<ReportsExportItem | null> {
    const rows = await db
      .select()
      .from(dataExports)
      .where(
        and(
          eq(dataExports.id, exportId),
          eq(dataExports.householdId, householdId),
        ),
      )
      .limit(1);

    if (!rows[0]) return null;
    return toExportItem(rows[0], requesterId);
  }

  async generateExportFile(
    householdId: string,
    userId: string,
    scope: ReportScope,
    input: ExportReportInput,
    tx?: TransactionType,
  ): Promise<{ content: string; fileName: string; recordCount: number; transactionIds?: string[] }> {
    validateDateRange(input.startDate, input.endDate);
    const exportData = await this.buildExportData(
      householdId,
      userId,
      scope,
      input,
      tx,
    );

    if (input.format !== "csv") {
      throw new Error("Only CSV exports are supported");
    }

    const content = exportService.generateCsv(
      exportData.rows,
      exportData.columns,
    );
    return { content, fileName: exportData.fileName, recordCount: exportData.rows.length, transactionIds: exportData.transactionIds };
  }

  private async buildExportData(
    householdId: string,
    userId: string,
    scope: ReportScope,
    input: ExportReportInput,
    tx?: TransactionType,
  ): Promise<ExportDataResult> {
    const from = input.startDate;
    const to = input.endDate;

    switch (input.reportType) {
      case "spending": {
        const groupBy = input.groupBy ?? "categoryGroup";
        const breakdown = await spendingReportRepository.getSpendingBreakdown(
          householdId,
          {
            from,
            to,
            groupBy,
            limit: 200,
            includeOther: true,
            type: "expense",
            scope,
            userId,
            includePending: input.includePending,
            includeTransfers: input.includeTransfers,
            merchantId: input.merchantId,
            categoryGroupId: input.categoryGroupId,
          },
        );

        const rows = breakdown.items.map((item) => ({
          groupBy,
          label: item.label,
          amount: csvMoney(item.value),
          currency: item.value.currency,
          percent: Number(item.percent.toFixed(2)),
        }));

        return {
          rows,
          columns: ["groupBy", "label", "amount", "currency", "percent"],
          fileName: `spending_${from}_${to}.csv`,
        };
      }
      case "cashflow": {
        // Check if forecast is requested
        const includeForecast = input.includeForecast ?? false;
        const forecastMonths = input.forecastMonths ?? 3;

        // Use forecast endpoint if requested, otherwise standard cashflow
        let cashflowData;
        if (includeForecast && input.interval === "month") {
          cashflowData = await cashflowReportRepository.getCashflowWithForecast(
            householdId,
            {
              from,
              to,
              interval: "month",
              scope,
              userId,
              includePending: input.includePending,
              includeTransfers: input.includeTransfers,
              merchantId: input.merchantId,
              includeForecast,
              forecastMonths,
            },
          );
        } else {
          cashflowData = await cashflowReportRepository.getCashflow(
            householdId,
            {
              from,
              to,
              interval: input.interval ?? "month",
              scope,
              userId,
              includePending: input.includePending,
              includeTransfers: input.includeTransfers,
              merchantId: input.merchantId,
            },
          );
        }

        // Build rows with forecast indicator and confidence (if available)
        const rows = cashflowData.series.map((item: CashflowExportPoint) => {
          const baseRow = {
            periodStart: item.periodStart,
            periodEnd: item.periodEnd,
            income: csvMoney(item.income),
            expenses: csvMoney(item.expenses),
            savings: csvMoney(item.savings),
            debt: csvMoney(item.debt),
            savingsRate: Number(item.savingsRate.toFixed(2)),
            currency: item.income.currency,
            dataType: item.isForecast ? "forecast" : "actual",
          };

          // Add confidence intervals if present
          if (item.confidence) {
            return {
              ...baseRow,
              incomeLow: csvMoney(item.confidence.income?.low),
              incomeHigh: csvMoney(item.confidence.income?.high),
              expensesLow: csvMoney(item.confidence.expenses?.low),
              expensesHigh: csvMoney(item.confidence.expenses?.high),
              savingsLow: csvMoney(item.confidence.savings?.low),
              savingsHigh: csvMoney(item.confidence.savings?.high),
              confidenceLevel: item.confidence.level,
            };
          }

          return baseRow;
        });

        // Build columns - include confidence columns if forecast data has them
        const hasConfidence =
          includeForecast &&
          cashflowData.series.some((s: CashflowExportPoint) => s.confidence);
        const baseColumns = [
          "periodStart",
          "periodEnd",
          "income",
          "expenses",
          "savings",
          "debt",
          "savingsRate",
          "currency",
          "dataType",
        ];
        const confidenceColumns = hasConfidence
          ? [
              "incomeLow",
              "incomeHigh",
              "expensesLow",
              "expensesHigh",
              "savingsLow",
              "savingsHigh",
              "confidenceLevel",
            ]
          : [];

        const fileNameSuffix = includeForecast ? "_with_forecast" : "";
        return {
          rows,
          columns: [...baseColumns, ...confidenceColumns],
          fileName: `cashflow${fileNameSuffix}_${from}_${to}.csv`,
        };
      }
      case "budget": {
        const comparison =
          await cashflowBudgetComparisonRepository.getBudgetComparison(
            householdId,
            {
              from,
              to,
              interval: input.interval ?? "month",
              scope,
              userId,
            },
          );

        const rows = comparison.comparison.map((item) => ({
          period: item.period,
          category: item.categoryName,
          budgeted: csvMoney(item.budgeted),
          actual: csvMoney(item.actual),
          variance: csvMoney(item.variance),
          variancePercent: item.variancePercent,
          status: item.status,
          currency: item.budgeted.currency,
        }));

        return {
          rows,
          columns: [
            "period",
            "category",
            "budgeted",
            "actual",
            "variance",
            "variancePercent",
            "status",
            "currency",
          ],
          fileName: `budget_comparison_${from}_${to}.csv`,
        };
      }
      case "networth": {
        const netWorth = await netWorthReportRepository.getNetWorth(
          householdId,
          {
            from,
            to,
            interval: input.interval === "day" ? "day" : "month",
            scope,
            userId,
          },
        );

        const rowsByDate = new Map<
          string,
          {
            date: string;
            netWorth?: CsvDecimal;
            assets?: CsvDecimal;
            liabilities?: CsvDecimal;
            currency: string;
          }
        >();

        for (const series of netWorth.series) {
          for (const point of series.data) {
            const existing = rowsByDate.get(point.x) || {
              date: point.x,
              currency: netWorth.range.baseCurrency,
            };
            if (series.id === "Net Worth") {
              existing.netWorth = csvMoney(point.y);
            } else if (series.id === "Assets") {
              existing.assets = csvMoney(point.y);
            } else if (series.id === "Liabilities") {
              existing.liabilities = csvMoney(point.y);
            }
            rowsByDate.set(point.x, existing);
          }
        }

        const rows = Array.from(rowsByDate.values()).sort((a, b) =>
          a.date.localeCompare(b.date),
        );

        return {
          rows,
          columns: ["date", "netWorth", "assets", "liabilities", "currency"],
          fileName: `networth_${from}_${to}.csv`,
        };
      }
      case "transactions": {
        return buildTransactionCsvData(householdId, userId, scope, input, tx);
      }
      default:
        throw new Error("Unsupported export type");
    }
  }
}

export const reportsExportService = new ReportsExportService();
