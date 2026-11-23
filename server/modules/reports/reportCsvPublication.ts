import { and, eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, dataExports, grzBondPayments, grzBonds, transactions } from "@shared/schema";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { businessAuditService } from "../../services/BusinessAuditService";
import { ForbiddenError, NotFoundError, ValidationError } from "../../utils/errorHandler";
import type { TransactionType } from "../../utils/withTransaction";
import { reportsExportService } from "./reports.export.service";
import { exportReportSchema, type ExportReportInput } from "./reports.validation";
import type { ReportScope } from "./reports.types";
import { withReportExportAuthority, type TransactionCsvSession } from "./reportExportAuthority";
import { transactionCsvColumns } from "./transactionCsvData";

/** Lock the emitted sources after reading the candidate. Repeatable-read row
 * locks reject a source changed since that cut; the caller retries from fresh
 * authority. Bond/payment -> cash -> sorted accounts matches coupon settlement.
 */
export async function lockEmittedSources(tx: TransactionType, householdId: string, transactionIds: string[]) {
  const ids = Array.from(new Set(transactionIds)).sort();
  if (!ids.length) return;
  const sourceBonds = tx.select({ id: grzBondPayments.bondId }).from(grzBondPayments)
    .where(inArray(grzBondPayments.incomeTransactionId, ids));
  const bonds = await tx.select({ id: grzBonds.id, accountId: grzBonds.accountId }).from(grzBonds)
    .where(and(eq(grzBonds.householdId, householdId), inArray(grzBonds.id, sourceBonds))).orderBy(grzBonds.id).for("share");
  if (bonds.length) await tx.select({ id: grzBondPayments.id }).from(grzBondPayments)
    .where(and(inArray(grzBondPayments.bondId, bonds.map(row => row.id)), inArray(grzBondPayments.incomeTransactionId, ids)))
    .orderBy(grzBondPayments.id).for("share");
  const cash = await tx.select({ id: transactions.id, accountId: transactions.accountId }).from(transactions)
    .where(and(eq(transactions.householdId, householdId), inArray(transactions.id, ids))).orderBy(transactions.id).for("share");
  if (cash.length !== ids.length) throw new Error("Transaction export sources changed");
  const accountIds = Array.from(new Set([...cash.map(row => row.accountId), ...bonds.flatMap(row => row.accountId ? [row.accountId] : [])])).sort();
  const lockedAccounts = accountIds.length ? await tx.select({ id: accounts.id, deletedAt: accounts.deletedAt }).from(accounts)
    .where(and(eq(accounts.householdId, householdId), inArray(accounts.id, accountIds))).orderBy(accounts.id).for("share")
    : [];
  if (cash.some(row => !lockedAccounts.some(account => account.id === row.accountId && !account.deletedAt))) throw new ForbiddenError("Report sources unavailable");
  await tx.select({ id: auditLogs.id }).from(auditLogs).where(and(
    inArray(auditLogs.entityId, ids), eq(auditLogs.entityType, "transaction"), eq(auditLogs.action, "CREATE"),
  )).orderBy(auditLogs.id).for("share");
}

type StoredExport = typeof dataExports.$inferSelect;
type GeneratedCsv = { content: string; fileName: string; transactionIds?: string[] };

/** Rebuild the creator's stored intent (or a legacy null one) for the current
 * grant. Enum errors include received values, so a malformed stored intent
 * yields one generic error without echoing any stored content.
 */
function storedExportInput(record: StoredExport, householdAllowed: boolean): { scope: ReportScope; input: ExportReportInput } {
  if (record.parameters !== null && (typeof record.parameters !== "object" || Array.isArray(record.parameters))) throw new ValidationError("Invalid stored export");
  const parameters = (record.parameters ?? {}) as Record<string, unknown>;
  const parsed = exportReportSchema.safeParse({ ...parameters,
    reportType: parameters.reportType ?? record.exportType, format: parameters.format ?? record.fileFormat,
    startDate: parameters.startDate ?? record.dateRangeStart, endDate: parameters.endDate ?? record.dateRangeEnd });
  if (!parsed.success) throw new ValidationError("Invalid stored export");
  const { scope: storedScope, ...input } = parsed.data;
  if (input.reportType !== record.exportType || input.format !== "csv") throw new ValidationError("Invalid report export");
  const scope = storedScope ?? (householdAllowed ? "household" : "mine");
  if (scope === "household" && !householdAllowed) throw new ForbiddenError("Report access unavailable");
  return { scope, input };
}

function logProcess(tx: TransactionType, actor: HouseholdContext, record: StoredExport, generated: GeneratedCsv, ipAddress?: string) {
  const isTransactions = record.exportType === "transactions";
  // Transaction exports keep their private (household-less) audit row.
  return businessAuditService.log({ tx, userId: actor.userId, householdId: isTransactions ? null : actor.householdId,
    action: "PROCESS", entityType: "data_export", entityId: record.id,
    details: { exportType: record.exportType, fileFormat: record.fileFormat,
      recordCount: isTransactions ? generated.transactionIds?.length ?? 0 : record.recordCount,
      dateRangeStart: record.dateRangeStart, dateRangeEnd: record.dateRangeEnd, fileName: generated.fileName }, ipAddress });
}

/** Lock the export row and apply the current grant's visibility to it. */
async function lockPublishableExport(tx: TransactionType, actor: HouseholdContext, role: string, exportId: string) {
  const [record] = await tx.select().from(dataExports).where(and(eq(dataExports.id, exportId), eq(dataExports.householdId, actor.householdId))).for("share");
  if (!record) throw new NotFoundError("Export not found");
  const householdAllowed = role === "owner" || role === "admin";
  if (record.userId !== actor.userId && !householdAllowed) throw new ForbiddenError("Report access unavailable");
  if (record.status !== "completed") throw new ValidationError("Export is not completed");
  if (record.fileFormat !== "csv") throw new ValidationError("Invalid report export");
  return { record, householdAllowed };
}

type DownloadPlan =
  | { published: { content: string; fileName: string } }
  | { record: StoredExport; scope: ReportScope; input: ExportReportInput };

/** Every report type is published under the current `financial.export` grant,
 * and only after its mandatory PROCESS audit has committed: a failed audit or
 * a withdrawn grant releases no bytes. Transaction CSV reads, source locks and
 * the audit share one authority cut. The other report repositories read
 * through their own snapshot transactions, so they run between two authority
 * cuts rather than under the membership lock (a membership writer must not
 * wait on a report read); the second cut re-checks the grant, the export's
 * visibility and its household scope, and writes the audit in the same
 * transaction.
 */
export async function generateAuthorizedReportCsv(actor: HouseholdContext, exportId: string, session: TransactionCsvSession, ipAddress?: string) {
  const plan = await withReportExportAuthority(actor, session, async (tx, role): Promise<DownloadPlan> => {
    const { record, householdAllowed } = await lockPublishableExport(tx, actor, role, exportId);
    if (record.exportType !== "transactions") return { record, ...storedExportInput(record, householdAllowed) };
    let generated: GeneratedCsv;
    if (record.userId !== actor.userId) {
      // A shared household grants no authority over another signer's saved
      // selection intent. No existing job has explicit shared provenance.
      // Do not evaluate (or validate/echo) its selectors against the caller's
      // cash: even a matching subset would reveal the creator's private query.
      generated = { content: transactionCsvColumns.join(",") + "\n", fileName: "transactions.csv", transactionIds: [] };
    } else {
      const { scope, input } = storedExportInput(record, householdAllowed);
      generated = await reportsExportService.generateExportFile(actor.householdId, actor.userId, scope, input, tx);
      await lockEmittedSources(tx, actor.householdId, generated.transactionIds ?? []);
    }
    await logProcess(tx, actor, record, generated, ipAddress);
    return { published: { content: generated.content, fileName: generated.fileName } };
  });
  if ("published" in plan) return plan.published;
  const generated = await reportsExportService.generateExportFile(actor.householdId, actor.userId, plan.scope, plan.input);
  await withReportExportAuthority(actor, session, async (tx, role) => {
    const { record, householdAllowed } = await lockPublishableExport(tx, actor, role, exportId);
    if (plan.scope === "household" && !householdAllowed) throw new ForbiddenError("Report access unavailable");
    await logProcess(tx, actor, record, generated, ipAddress);
  });
  return { content: generated.content, fileName: generated.fileName };
}
