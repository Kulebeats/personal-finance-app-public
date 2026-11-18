import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { dataExports } from "@shared/schema";
import { exportService } from "../../services/ExportService";
import { withTransaction } from "../../utils/withTransaction";
import { businessAuditService } from "../../services/BusinessAuditService";
import {
  cashflowReportRepository,
  cashflowBudgetComparisonRepository,
  spendingReportRepository,
  netWorthReportRepository,
  transactionReportRepository,
} from "../../repositories/reports";
import {
  validateDateRange,
  type ExportReportInput,
} from "./reports.validation";
import type { ReportScope } from "./reports.types";
import type { MoneyDto } from "@shared/money";
import type {
  ReportsExportItem,
  ReportsExportsResponse,
  ReportsCashflowResponse,
} from "@shared/reports";

const MAX_EXPORT_ROWS = 5000;
const TRANSACTION_EXPORT_BATCH = 1000;

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

const toNumber = (value?: MoneyDto) => (value ? Number(value.amount) || 0 : 0);

const toExportItem = (
  row: typeof dataExports.$inferSelect,
): ReportsExportItem => ({
  id: row.id,
  userId: row.userId,
  householdId: row.householdId,
  exportType: row.exportType,
  fileFormat: row.fileFormat,
  fileUrl: row.fileUrl ?? undefined,
  dateRangeStart: toIsoDate(row.dateRangeStart),
  dateRangeEnd: toIsoDate(row.dateRangeEnd),
  recordCount: row.recordCount ?? null,
  // FIX REPORTS-EXPORT-002: Include stored parameters for reproducible downloads
  parameters: row.parameters as Record<string, unknown> | null,
  status: row.status || "pending",
  createdAt: toIsoDateTime(row.createdAt),
});

export class ReportsExportService {
  async listExports(
    options: ExportListOptions,
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

    const rows = await db
      .select()
      .from(dataExports)
      .where(and(...conditions))
      .orderBy(desc(dataExports.createdAt))
      .limit(limit);

    return { exports: rows.map(toExportItem) };
  }

  async getExportById(
    exportId: string,
    householdId: string,
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
    return toExportItem(rows[0]);
  }

  async createExport(
    householdId: string,
    userId: string,
    scope: ReportScope,
    input: ExportReportInput,
    ipAddress?: string,
  ): Promise<ReportsExportItem> {
    validateDateRange(input.startDate, input.endDate);

    const created = await db
      .insert(dataExports)
      .values({
        userId,
        householdId,
        exportType: input.reportType,
        fileFormat: input.format,
        dateRangeStart: input.startDate,
        dateRangeEnd: input.endDate,
        // FIX REPORTS-EXPORT-002: Store export parameters for reproducible downloads
        parameters: { ...input, scope },
        status: "pending",
      })
      .returning();

    const exportRow = created[0];
    if (!exportRow) {
      throw new Error("Failed to create export");
    }

    try {
      // 30 second timeout for exports
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Export timed out (max 30s)")),
          30000,
        ),
      );

      const exportData = await Promise.race([
        this.buildExportData(householdId, userId, scope, input),
        timeoutPromise,
      ]);

      // DPA audit (SCP-336): a produced financial+PII export must never commit
      // unlogged. The initial insert above is left as "pending" so failed builds
      // are still recorded; here, at completion, recordCount is known, so the
      // completion write and the CREATE audit row are made atomic via one
      // transaction. If the audit insert fails it propagates, rolling back the
      // completion (the export stays pending → marked "failed" in catch) — so no
      // completed export can exist without its audit row. Metadata only: never
      // the exported rows (which carry merchant/account/category names + notes).
      await withTransaction(async (tx) => {
        await tx
          .update(dataExports)
          .set({
            status: "completed",
            recordCount: exportData.rows.length,
            fileUrl: `/api/reports/exports/${exportRow.id}?download=true`,
          })
          .where(eq(dataExports.id, exportRow.id));

        await businessAuditService.log({
          userId,
          householdId,
          action: "CREATE",
          entityType: "data_export",
          entityId: exportRow.id,
          details: {
            reportType: input.reportType,
            fileFormat: input.format,
            scope,
            dateRangeStart: input.startDate,
            dateRangeEnd: input.endDate,
            recordCount: exportData.rows.length,
            fileName: exportData.fileName,
          },
          ipAddress,
          tx,
        });
      });

      const updated = await this.getExportById(exportRow.id, householdId);
      if (!updated) throw new Error("Failed to load export record");
      return updated;
    } catch (error) {
      await db
        .update(dataExports)
        .set({ status: "failed" })
        .where(eq(dataExports.id, exportRow.id));

      // Update error status properly if timeout
      if (error instanceof Error && error.message.includes("timed out")) {
        // Log specifically or handle differently if needed, but 'failed' status is set above
      }
      throw error;
    }
  }

  async generateExportFile(
    householdId: string,
    userId: string,
    scope: ReportScope,
    input: ExportReportInput,
  ): Promise<{ content: string; fileName: string }> {
    validateDateRange(input.startDate, input.endDate);
    const exportData = await this.buildExportData(
      householdId,
      userId,
      scope,
      input,
    );

    if (input.format !== "csv") {
      throw new Error("Only CSV exports are supported");
    }

    const content = exportService.generateCsv(
      exportData.rows,
      exportData.columns,
    );
    return { content, fileName: exportData.fileName };
  }

  private async buildExportData(
    householdId: string,
    userId: string,
    scope: ReportScope,
    input: ExportReportInput,
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
          amount: toNumber(item.value),
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
            income: toNumber(item.income),
            expenses: toNumber(item.expenses),
            savings: toNumber(item.savings),
            debt: toNumber(item.debt),
            savingsRate: Number(item.savingsRate.toFixed(2)),
            currency: item.income.currency,
            dataType: item.isForecast ? "forecast" : "actual",
          };

          // Add confidence intervals if present
          if (item.confidence) {
            return {
              ...baseRow,
              incomeLow: toNumber(item.confidence.income?.low),
              incomeHigh: toNumber(item.confidence.income?.high),
              expensesLow: toNumber(item.confidence.expenses?.low),
              expensesHigh: toNumber(item.confidence.expenses?.high),
              savingsLow: toNumber(item.confidence.savings?.low),
              savingsHigh: toNumber(item.confidence.savings?.high),
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
          budgeted: toNumber(item.budgeted),
          actual: toNumber(item.actual),
          variance: toNumber(item.variance),
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
            netWorth?: number;
            assets?: number;
            liabilities?: number;
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
              existing.netWorth = toNumber(point.y);
            } else if (series.id === "Assets") {
              existing.assets = toNumber(point.y);
            } else if (series.id === "Liabilities") {
              existing.liabilities = toNumber(point.y);
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
        const rows: Record<string, unknown>[] = [];
        let cursor: string | undefined;
        const maxRows = Math.min(
          input.limit ?? MAX_EXPORT_ROWS,
          MAX_EXPORT_ROWS,
        );
        const includePending = input.includePending ?? false;
        const includeTransfers = input.includeTransfers ?? false;

        while (rows.length < maxRows) {
          const remaining = maxRows - rows.length;
          const limit = Math.min(TRANSACTION_EXPORT_BATCH, remaining);
          const result = await transactionReportRepository.getTransactions(
            householdId,
            {
              from,
              to,
              categoryId: input.categoryId,
              categoryGroupId: input.categoryGroupId,
              merchantId: input.merchantId,
              accountId: input.accountId,
              tagId: input.tagId,
              type: input.type,
              search: input.search,
              sort: input.sort,
              limit,
              cursor,
              scope,
              includePending,
              includeTransfers,
              userId,
            },
          );

          for (const item of result.items) {
            rows.push({
              date: item.date,
              name: item.name,
              merchant: item.merchant?.name ?? "",
              category: item.category?.name ?? "",
              account: item.account?.name ?? "",
              type: item.type,
              amount: toNumber(item.amount),
              currency: item.amount.currency,
              amountBase: toNumber(item.amountBase),
              baseCurrency: item.baseCurrency,
              isPending: item.isPending,
              notes: item.notes ?? "",
            });
          }

          cursor = result.page.nextCursor ?? undefined;
          if (!cursor || result.items.length === 0) break;
        }

        return {
          rows,
          columns: [
            "date",
            "name",
            "merchant",
            "category",
            "account",
            "type",
            "amount",
            "currency",
            "amountBase",
            "baseCurrency",
            "isPending",
            "notes",
          ],
          fileName: `transactions_${from}_${to}.csv`,
        };
      }
      default:
        throw new Error("Unsupported export type");
    }
  }
}

export const reportsExportService = new ReportsExportService();
