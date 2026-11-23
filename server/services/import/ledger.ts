import { accounts, transactions, type Account, type Transaction } from "@shared/schema";
import type { ImportOptions, ParsedImportRow } from "./types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Money } from "../../core/money";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { EventTypes, outboxEventService } from "../../core/events";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { readPostingEffect } from "../../repositories/TransactionPostingEffect";
import { ConflictError, NotFoundError } from "../../utils/errorHandler";
import type { TransactionType } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";
import { assertPrincipalCashDelete } from "../grz/principalCashGuard";
import {
  assertReviewedRemovals, readOverwriteRange, selectOverwriteRemovals, type OverwriteScope, type ReviewedRemoval,
} from "./overwrite";

/** A-48 / R2 P2: the statement was reviewed in one currency; a different account currency refuses it before any write. */
export function assertImportCurrency(expected: string | undefined, actual: string | undefined): void {
  if (expected !== undefined && actual !== undefined && actual !== expected) {
    throw new ConflictError("Target account currency changed. Review the statement against the current account currency and retry.");
  }
}

export async function lockImportAccount(
  tx: TransactionType, actor: HouseholdContext, accountId: string, expectedCurrency?: string,
) {
  const [account] = await tx.select().from(accounts).where(and(
    eq(accounts.id, accountId), visibleAccountPredicate(actor),
  )).limit(1).for("update");
  if (!account) throw new NotFoundError("Target account not found");
  assertImportCurrency(expectedCurrency, account.currency);
  return account;
}

/**
 * How a statement row relates to the ledger row already holding its identity.
 *
 * - duplicate: the same visible, live import posting; nothing is written.
 * - hidden: a row the importer cannot see (another member's private row, or a
 *   row since moved off the target account). Reported exactly like a
 *   duplicate and never written, so neither preview nor execute reveals that
 *   hidden history exists (NEW-17 review P1-2).
 * - conflict: visible history that differs (changed amount, date, type or
 *   statement description under the same provider reference, a deleted row, a
 *   non-import row). A 409. The description is compared with originalName, the
 *   text the statement posted, so a later rename or rule never makes a replay a
 *   conflict (A-22).
 */
export type ImportMatchVerdict = "duplicate" | "hidden" | "conflict";

/** The name and original name an imported row posts under. */
export const importedRowName = (row: ParsedImportRow): string => row.merchantName || "Imported Transaction";

export function classifyImportMatch(existing: Transaction, params: {
  account: Account; actorUserId: string; row: ParsedImportRow;
  strategy: ImportOptions["strategy"];
}): ImportMatchVerdict {
  const { account, row } = params;
  // Compare against the locked account row's own (canonical) id: the request id may differ in case (review r2 P2).
  if ((existing.isPrivate && existing.ownerUserId !== params.actorUserId) || existing.accountId !== account.id) {
    return "hidden";
  }
  if (existing.deletedAt || existing.source !== "csv_import" || existing.type !== row.type ||
      existing.date !== row.dateString || !row.amount.equals(new Money(existing.amount)) ||
      existing.originalName !== importedRowName(row) ||
      (params.strategy === "prioritize_csv" && readPostingEffect(account, existing).mode !== "posted")) {
    return "conflict";
  }
  return "duplicate";
}

/** Execute-time form: a conflict is a 409; duplicate and hidden both skip the row. */
export function assertReplayableImportRow(existing: Transaction, params: Parameters<typeof classifyImportMatch>[1]): Exclude<ImportMatchVerdict, "conflict"> {
  const verdict = classifyImportMatch(existing, params);
  if (verdict === "conflict") throw new ConflictError("An import row key refers to changed or unavailable history");
  return verdict;
}

/** Parent locks precede the account lock, matching ordinary edit/delete ordering. */
export async function reverseImportOverwrite(tx: TransactionType, params: {
  scope: OverwriteScope; actor: HouseholdContext; ipAddress?: string;
  expectedCurrency?: string;
  /** A-02: the rows (id and version) the member reviewed in the preview; any other removal is a 409. */
  reviewedRemovals: readonly ReviewedRemoval[];
}) {
  const { actor, scope } = params;
  const accountId = scope.accountId;
  const visible = await readOverwriteRange(tx, scope, true);
  const account = await lockImportAccount(tx, actor, accountId, params.expectedCurrency);
  const rows = await selectOverwriteRemovals(tx, scope, visible);
  if (!rows.length) return { account, deleted: 0 };
  if (rows.some(row => row.type === "transfer" || row.transferTransactionId || row.transferAccountId || row.isTransferIn)) {
    throw new ConflictError("Import overwrite intersects a transfer; choose a pair-preserving operation");
  }
  // A statement overwrite must preserve confirmed GRZ cash and interest.
  await assertPrincipalCashDelete(tx, actor.householdId, rows);
  // After the structural refusals, which no re-review can lift: every removal must be one the member reviewed.
  assertReviewedRemovals(rows, params.reviewedRemovals, account.currency);
  let totalDelta = Money.zero(account.currency);
  for (const row of rows) {
    // No amount/sign reconstruction and no adoption of unmarked legacy rows.
    // history_only contributes its actual zero effect, even in a mixed batch.
    totalDelta = totalDelta.add(readPostingEffect(account, row).delta);
  }
  const deletedAt = new Date();
  await tx.update(transactions).set({ deletedAt, updatedAt: deletedAt })
    .where(inArray(transactions.id, rows.map(row => row.id)));
  if (!totalDelta.isZero()) await tx.update(accounts).set({
    balance: sql`${accounts.balance} - ${totalDelta.toString()}::numeric`, updatedAt: new Date(),
  }).where(eq(accounts.id, accountId));
  for (const row of rows) {
    await businessAuditService.logDelete({ tx, userId: actor.userId, householdId: actor.householdId,
      entityId: row.id, entityType: "transaction", ipAddress: params.ipAddress,
      oldValue: { accountId: row.accountId, amount: row.amount, currency: row.currency, date: row.date,
        type: row.type, source: row.source, postedBalanceDelta: row.postedBalanceDelta,
        postingMode: row.postingMode, postedAccountIsAsset: row.postedAccountIsAsset },
      metadata: { source: "csv_import", importStrategy: "prioritize_csv" } });
    await outboxEventService.publish({ eventType: EventTypes.TRANSACTION_DELETED,
      aggregateType: "transaction", aggregateId: row.id, householdId: actor.householdId,
      payload: { id: row.id } }, tx);
  }
  return { account, deleted: rows.length };
}
