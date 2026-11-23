import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { accountBalanceSnapshots, accounts, householdMembers } from "@shared/schema";
import { z } from "zod";
import { db } from "../db";
import { ForbiddenError, NotFoundError, ValidationError } from "../core/errors";
import { Money } from "../core/money";
import { accountExportAuditCte } from "./AccountExportAudit";

/** History and the current-only fallback share their containing account's grant. */
export async function readAccountBalanceHistory(
  accountId: string, householdId: string, userId: string, from: string, to: string,
  capability: "financial.read" | "financial.export" = "financial.read",
  auditExport = false,
) {
  if (!z.string().uuid().safeParse(accountId).success) throw new ValidationError("Invalid account ID");
  const roles = capability === "financial.export" ? ["owner", "admin", "member"] as const
    : ["owner", "admin", "member", "view_only", "professional"] as const;
  type Result = { allowed: boolean; visible: boolean; balance: string | null; rows: Array<{ date: string; balance: string }> };
  // One statement gives the grant, account and all dated rows one MVCC snapshot.
  // The resource predicate is the shared account rule: household + not deleted
  // + public/own private. No preflight-to-history gap or second unbounded scan.
  const result = await db.execute<Result>(sql`with allowed_member as (
    select 1 from ${householdMembers} where ${and(eq(householdMembers.householdId, householdId),
      eq(householdMembers.userId, userId), inArray(householdMembers.role, Array.from(roles)))}
  ), target as (
    select ${accounts.id} as id, ${accounts.balance} as balance from ${accounts}
    where ${and(eq(accounts.id, accountId), eq(accounts.householdId, householdId), isNull(accounts.deletedAt),
      or(eq(accounts.isPrivate, false), eq(accounts.ownerUserId, userId)))} and exists(select 1 from allowed_member)
  ), publication as (select exists(select 1 from allowed_member) as allowed, exists(select 1 from target) as visible,
    (select balance::text from target) as balance,
    coalesce((select jsonb_agg(jsonb_build_object('date', to_char(${accountBalanceSnapshots.date}, 'YYYY-MM-DD'),
      'balance', ${accountBalanceSnapshots.balance}::text) order by ${accountBalanceSnapshots.date})
      from ${accountBalanceSnapshots} inner join target on ${accountBalanceSnapshots.accountId}=target.id
      where ${accountBalanceSnapshots.date}>=${from}::date and ${accountBalanceSnapshots.date}<=${to}::date), '[]'::jsonb) as rows)
    ${auditExport && capability === "financial.export" ? sql`, ${accountExportAuditCte(userId, accountId, "account_balance_history",
      sql`greatest(jsonb_array_length(publication.rows),1)`, sql`allowed and visible`)}` : sql``}
    select * from publication`);
  const current = result.rows[0];
  if (!current.allowed) throw new ForbiddenError("Account financial access denied");
  if (!current.visible) throw new NotFoundError("Account");
  return current.rows.length ? current.rows.map(row => ({ date: row.date, balance: new Money(row.balance).toNumber() }))
    : [{ date: to, balance: new Money(current.balance!).toNumber() }];
}
