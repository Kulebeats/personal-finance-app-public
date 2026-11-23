import { and, eq } from "drizzle-orm";
import { dataExports } from "@shared/schema";
import { db } from "../../db";
import { ForbiddenError, ValidationError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { businessAuditService } from "../../services/BusinessAuditService";
import { reportsExportService, toExportItem } from "./reports.export.service";
import { validateDateRange, type ExportReportInput } from "./reports.validation";
import type { ReportsExportItem } from "@shared/reports";
import type { ReportScope } from "./reports.types";
import { withReportExportAuthority, type TransactionCsvSession } from "./reportExportAuthority";
import { lockEmittedSources } from "./reportCsvPublication";

/** Every report type requires the current `financial.export` grant. A pending
 * job retains the failed-build lifecycle. Both reservation and completion
 * require current authority; completion metadata and its mandatory audit share
 * the final transaction, so a failed audit leaves no completed export.
 */
export async function createAuthorizedReportExport(actor: HouseholdContext, session: TransactionCsvSession,
  scope: ReportScope, input: ExportReportInput, ipAddress?: string): Promise<ReportsExportItem> {
  validateDateRange(input.startDate, input.endDate);
  if (input.format !== "csv") throw new ValidationError("Invalid report export");
  const isTransactions = input.reportType === "transactions";
  const assertScope = (role: string) => {
    if (scope === "household" && role !== "owner" && role !== "admin") throw new ForbiddenError("Report access unavailable");
  };
  const record = await withReportExportAuthority(actor, session, async (tx, role) => {
    assertScope(role);
    const [row] = await tx.insert(dataExports).values({ userId: actor.userId, householdId: actor.householdId,
      exportType: input.reportType, fileFormat: input.format, dateRangeStart: input.startDate, dateRangeEnd: input.endDate,
      parameters: { ...input, scope }, status: "pending" }).returning();
    if (!row) throw new Error("Failed to create export");
    return row;
  });
  try {
    // Non-transaction report repositories read through their own snapshot
    // transactions, so they build between the two authority cuts rather than
    // under the membership lock; completion re-checks the current grant.
    const prebuilt = isTransactions ? undefined
      : await reportsExportService.generateExportFile(actor.householdId, actor.userId, scope, input);
    return await withReportExportAuthority(actor, session, async (tx, role) => {
      assertScope(role);
      const [pending] = await tx.select({ id: dataExports.id }).from(dataExports).where(and(
        eq(dataExports.id, record.id), eq(dataExports.householdId, actor.householdId), eq(dataExports.userId, actor.userId),
      )).for("update");
      if (!pending) throw new ForbiddenError("Report access unavailable");
      const generated = prebuilt ?? await reportsExportService.generateExportFile(actor.householdId, actor.userId, scope, input, tx);
      if (isTransactions) await lockEmittedSources(tx, actor.householdId, generated.transactionIds ?? []);
      const recordCount = isTransactions ? generated.transactionIds?.length : generated.recordCount;
      if (recordCount === undefined) throw new Error("Missing export record count");
      const [completed] = await tx.update(dataExports).set({ status: "completed", recordCount,
        fileUrl: `/api/reports/exports/${record.id}?download=true` }).where(eq(dataExports.id, record.id)).returning();
      if (!completed) throw new Error("Failed to complete export");
      // Transaction exports keep their private (household-less) audit row.
      await businessAuditService.log({ tx, userId: actor.userId, householdId: isTransactions ? null : actor.householdId,
        action: "CREATE", entityType: "data_export", entityId: record.id,
        details: { reportType: input.reportType, fileFormat: input.format, scope, dateRangeStart: input.startDate,
          dateRangeEnd: input.endDate, recordCount, fileName: generated.fileName }, ipAddress });
      return toExportItem(completed, actor.userId);
    });
  } catch (error) {
    await db.update(dataExports).set({ status: "failed" }).where(and(eq(dataExports.id, record.id), eq(dataExports.status, "pending")));
    throw error;
  }
}
