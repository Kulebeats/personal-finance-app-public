import { and, eq } from "drizzle-orm";
import { dataExports } from "@shared/schema";
import { ForbiddenError, NotFoundError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { reportsExportService, toExportItem } from "./reports.export.service";
import type { ReportsExportsQuery } from "./reports.validation";
import { withReportExportAuthority, type TransactionCsvSession } from "./reportExportAuthority";

/** Export metadata is selected with the current grant, never an earlier role.
 * Mixed lists retain other report DTOs; transaction source intent/count stays
 * private to its creator through the shared mapper.
 */
export function listAuthorizedExportMetadata(actor: HouseholdContext, session: TransactionCsvSession, query: ReportsExportsQuery) {
  return withReportExportAuthority(actor, session, (tx, role) => reportsExportService.listExports({
    householdId: actor.householdId, userId: actor.userId, includeHousehold: role === "owner" || role === "admin",
    status: query.status, limit: query.limit,
  }, tx));
}

export function readAuthorizedExportMetadata(actor: HouseholdContext, session: TransactionCsvSession, id: string) {
  return withReportExportAuthority(actor, session, async (tx, role) => {
    const [row] = await tx.select().from(dataExports).where(and(eq(dataExports.id, id), eq(dataExports.householdId, actor.householdId)));
    if (!row) throw new NotFoundError("Export not found");
    if (row.userId !== actor.userId && role !== "owner" && role !== "admin") throw new ForbiddenError("Report access unavailable");
    return toExportItem(row, actor.userId);
  });
}
