import { accounts, householdMembers, householdRoleEnum, transactions } from "@shared/schema";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { can } from "../../core/authz/capabilities";

interface ImportTargetScope { householdId: string; userId: string; accountId: string }

const importWriterRoles = householdRoleEnum.enumValues.filter(role => can(role, "financial.write"));

/** The importer's current write grant and the live custody of the target account. */
export function visibleImportAccount(scope: ImportTargetScope) {
  return and(
    eq(accounts.id, scope.accountId), eq(accounts.householdId, scope.householdId), isNull(accounts.deletedAt),
    or(eq(accounts.isPrivate, false), eq(accounts.ownerUserId, scope.userId)),
    sql`exists (select 1 from ${householdMembers} where ${and(
      eq(householdMembers.householdId, scope.householdId), eq(householdMembers.userId, scope.userId),
      inArray(householdMembers.role, importWriterRoles),
    )})`,
  );
}

/** Ledger row privacy, used with the target account check or its write lock. */
export function importTransactionScope(scope: ImportTargetScope) {
  return and(
    eq(transactions.householdId, scope.householdId), eq(transactions.accountId, scope.accountId),
    isNull(transactions.deletedAt), or(eq(transactions.isPrivate, false), eq(transactions.ownerUserId, scope.userId)),
  );
}
