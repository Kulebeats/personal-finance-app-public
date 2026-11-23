/**
 * A-02: the ledger rows a "CSV wins" (prioritize_csv) import removes.
 *
 * Preview and execute call the same planner, so the preview lists exactly the
 * rows execute would delete. Execute deletes only rows the member reviewed:
 * each one must be in the reviewed set at the version the preview showed, or
 * the whole import is refused with a 409 and nothing is written.
 */
import { createHash } from "crypto";
import { accounts, auditLogs, transactions, type Transaction } from "@shared/schema";
import type { MoneyDto } from "@shared/money";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { ConflictError } from "../../core/errors";
import { Money } from "../../core/money";
import type { db } from "../../db";
import type { TransactionType } from "../../utils/withTransaction";
import { matchKeys, type StatementRow } from "./statement";
import { importTransactionScope, visibleImportAccount } from "./reviewVisibility";

type Reader = TransactionType | typeof db;

export interface OverwriteScope {
  householdId: string; userId: string; accountId: string; startDate: string; endDate: string;
  /** Each statement row's keys (v3, then v2): a stored row under any of them is kept. */
  keyGroups: string[][]; statementDigest: string; priorStatementDigest?: string;
}

/** A row a "CSV wins" import would remove, as the preview shows it. */
export interface OverwriteRemoval {
  id: string; date: string; name: string; type: string; amount: MoneyDto;
  /** Opaque: changes whenever the row's identity, amount, date, type, name or posting changes. */
  version: string;
}

export interface ReviewedRemoval { id: string; version: string }

/** The digests the statement's audit row records; equal digests mean the same statement and category choices. */
export function statementDigests(statement: StatementRow[], categoryMapping: Record<string, string>) {
  const digestOf = (keyOf: (item: StatementRow) => string) => createHash("sha256").update(JSON.stringify(statement.map(item =>
    [keyOf(item), item.row.categoryName ? categoryMapping[item.row.categoryName] ?? null : null]))).digest("hex");
  // The digest an import before v3 recorded for this statement, so its exact retry still replays.
  return { statementDigest: digestOf(item => item.idempotencyKey), priorStatementDigest: digestOf(item => item.priorKey ?? item.idempotencyKey) };
}

export function overwriteScopeOf(statement: StatementRow[], categoryMapping: Record<string, string>,
  actor: { householdId: string; userId: string }, accountId: string): OverwriteScope | undefined {
  if (!statement.length) return undefined;
  const dates = statement.map(({ row }) => row.dateString).sort();
  return { householdId: actor.householdId, userId: actor.userId, accountId, startDate: dates[0],
    endDate: dates[dates.length - 1], keyGroups: statement.map(matchKeys), ...statementDigests(statement, categoryMapping) };
}

/** Live rows in the statement's range the member can see; execute locks them before the account. */
export async function readOverwriteRange(reader: Reader, scope: OverwriteScope, lock: boolean): Promise<Transaction[]> {
  const query = reader.select().from(transactions).where(and(
    importTransactionScope(scope), gte(transactions.date, scope.startDate), lte(transactions.date, scope.endDate),
    // Execute locks and authorizes the account after these rows. Preview has no such lock.
    lock ? undefined : sql`exists (select 1 from ${accounts} where ${visibleImportAccount(scope)})`,
  )).orderBy(transactions.id);
  return lock ? query.for("update") : query;
}

/** The rows of `visible` the overwrite removes: none on an exact retry of the last overwrite, else every row not in the statement. */
export async function selectOverwriteRemovals(reader: Reader, scope: OverwriteScope, visible: Transaction[]): Promise<Transaction[]> {
  const keepKeySet = new Set(scope.keyGroups.flat());
  // Replay detection matches identities across ALL history, hidden rows included, so a hidden
  // match replays exactly like a visible one; deletion targets stay visibility-filtered (review r3 P1).
  const keepKeys = Array.from(keepKeySet);
  const known = keepKeys.length ? await reader.select({ key: transactions.idempotencyKey }).from(transactions).where(and(
    eq(transactions.householdId, scope.householdId), inArray(transactions.idempotencyKey, keepKeys),
  )) : [];
  const existingKeys = new Set(known.map(row => row.key));
  // A complete live retry must also leave purchases added since the first upload intact.
  // A private account's import audit row has no household (P2-2), so the actor's own null-household
  // rows for this account count too.
  const auditScope = or(eq(auditLogs.householdId, scope.householdId),
    and(isNull(auditLogs.householdId), eq(auditLogs.userId, scope.userId)));
  const [previous] = await reader.select({ digest: sql<string>`${auditLogs.details}->'newValue'->>'statementDigest'` }).from(auditLogs)
    .where(and(auditScope, eq(auditLogs.entityType, "transaction_import"),
      eq(auditLogs.entityId, scope.accountId), eq(auditLogs.action, "CREATE"),
      sql`${auditLogs.details}->'newValue'->>'strategy' = 'prioritize_csv'`))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(1);
  const sameStatement = previous !== undefined && [scope.statementDigest, scope.priorStatementDigest].includes(previous.digest);
  const exactReplay = sameStatement && scope.keyGroups.every(group => group.some(key => existingKeys.has(key)));
  return exactReplay ? [] : visible.filter(row => !row.idempotencyKey || !keepKeySet.has(row.idempotencyKey));
}

export function overwriteRemovalVersion(row: Transaction): string {
  return createHash("sha256").update(JSON.stringify([row.id, row.updatedAt.toISOString(), row.date, row.type,
    row.amount, row.currency, row.name, row.postingMode, row.postedBalanceDelta, row.idempotencyKey])).digest("hex");
}

/** `accountCurrency` stands in for a legacy row stored without its own currency. */
export function toOverwriteRemoval(row: Transaction, accountCurrency: string): OverwriteRemoval {
  const currency = row.currency ?? accountCurrency;
  return { id: row.id, date: row.date, name: row.name, type: row.type,
    amount: { amount: new Money(row.amount, currency).toString(), currency },
    version: overwriteRemovalVersion(row) };
}

/** The member's preview went stale: a row to remove was added or changed after it. Nothing was written. */
export class ImportOverwriteChangedError extends ConflictError {
  readonly removals: OverwriteRemoval[];

  constructor(removals: OverwriteRemoval[]) {
    super("The ledger rows this import would remove changed after the preview. Review the import again; nothing was imported.");
    this.removals = removals;
  }

  toJSON() {
    const response = super.toJSON();
    return { ...response, error: { ...response.error, code: "IMPORT_OVERWRITE_CHANGED", details: { removals: this.removals } } };
  }
}

/** Refuses unless every row to remove is in the reviewed set at the same version (a reviewed row now kept is fine). */
export function assertReviewedRemovals(rows: Transaction[], reviewed: readonly ReviewedRemoval[], accountCurrency: string): void {
  const reviewedVersion = new Map(reviewed.map(item => [item.id.toLowerCase(), item.version]));
  const unreviewed = rows.some(row => reviewedVersion.get(row.id.toLowerCase()) !== overwriteRemovalVersion(row));
  if (unreviewed) throw new ImportOverwriteChangedError(rows.map(row => toOverwriteRemoval(row, accountCurrency)));
}
