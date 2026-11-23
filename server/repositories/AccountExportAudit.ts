import { sql, type SQL } from "drizzle-orm";
import { auditLogs } from "@shared/schema";

/** This CTE shares the final authorized publication's statement snapshot.
 * Export counts/selectors belong only to the requesting actor. A failed insert
 * rejects the statement before any CSV buffer reaches the HTTP controller.
 */
export function accountExportAuditCte(userId: string, entityId: string, exportType: string,
  recordCount: SQL, allowed: SQL) {
  return sql`export_audit as (
    insert into ${auditLogs} (user_id,household_id,action,entity_type,entity_id,details)
    select ${userId}::uuid,null,'PROCESS','data_export',${entityId}::uuid,
      jsonb_build_object('exportType',${exportType}::text,'fileFormat','csv','recordCount',${recordCount})
    from publication where ${allowed} returning id
  )`;
}
