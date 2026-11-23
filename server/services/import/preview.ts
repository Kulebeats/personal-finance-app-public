/**
 * NEW-17 read-only import preview: rows parsed with the CHOSEN date format, the
 * identity each row will carry, rows already imported, and duplicate candidates
 * for review. Writes nothing.
 */
import { accounts, transactions, type Account } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { NotFoundError } from "../../core/errors";
import type { TransactionType } from "../../utils/withTransaction";
import { assignStatementCandidates, type CandidateReason } from "./candidates";
import { GLOBAL_IMPORT_IDENTITY_VERSION } from "./identity";
import { classifyImportMatch } from "./ledger";
import { overwriteScopeOf, readOverwriteRange, selectOverwriteRemovals, toOverwriteRemoval, type OverwriteRemoval } from "./overwrite";
import { visibleImportAccount } from "./reviewVisibility";
import { buildStatement, failedOrdinals, matchKeys, repeatedIdentityConflicts, storedMatch } from "./statement";
import type { ImportOptions, ImportRowError } from "./types";

export type PreviewRowStatus = "new" | "duplicate" | "candidate" | "conflict";

export interface ImportPreviewRow {
  ordinal: number;
  date: string;
  type: "income" | "expense";
  amount: string;
  merchant: string;
  notes: string | null;
  reference: string | null;
  status: PreviewRowStatus;
  /** Conflict with an earlier row of the same file sharing this reference (NEW-17 review P1-1). */
  repeatsOrdinal?: number;
  candidate?: { id: string; name: string; date: string; amount: string; reason: CandidateReason };
}

export interface ImportPreview {
  identityVersion: string;
  fingerprint: string;
  dateFormat: string;
  strategy: ImportOptions["strategy"];
  rows: ImportPreviewRow[];
  errors: ImportRowError[];
  counts: Record<PreviewRowStatus | "failed", number>;
  /** A-02: the ledger rows a "CSV wins" import removes (always empty for the other strategy). Execute deletes only these. */
  removals: OverwriteRemoval[];
  /** R2 P2: the account currency the amounts were reviewed in; execute is bound to it. */
  accountCurrency: string;
}

type PreviewOptions = ImportOptions & { targetAccountId: string };

export async function previewImport(rows: Record<string, string>[], options: PreviewOptions): Promise<ImportPreview> {
  return db.transaction(async tx => {
    const [account] = await tx.select().from(accounts)
      .where(visibleImportAccount({ ...options, accountId: options.targetAccountId })).limit(1);
    if (!account) throw new NotFoundError("Target account not found");
    return readPreview(tx, rows, { ...options, accountCurrency: account.currency }, account);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

async function readPreview(tx: TransactionType, rows: Record<string, string>[], options: PreviewOptions, account: Account): Promise<ImportPreview> {
  const { targetAccountId: accountId, householdId, userId } = options;
  const { fingerprint, statement, errors } = buildStatement(rows, options, accountId);
  const keys = statement.flatMap(matchKeys);
  const matches = keys.length ? await tx.select().from(transactions)
    .where(and(eq(transactions.householdId, householdId), inArray(transactions.idempotencyKey, keys))) : [];
  const byKey = new Map(matches.map(row => [row.idempotencyKey, row]));
  const repeated = repeatedIdentityConflicts(statement);

  // Same verdicts as execute: a hidden match reads as a plain duplicate, changed history as a conflict.
  const seen = new Set<string>();
  const status = new Map<number, PreviewRowStatus>();
  for (const item of statement) {
    const { row, idempotencyKey } = item;
    const existing = storedMatch(byKey, item);
    const verdict = existing
      ? classifyImportMatch(existing, { account, actorUserId: userId, row, strategy: options.strategy })
      : undefined;
    status.set(row.rowIndex, verdict === "conflict" || repeated.has(row.rowIndex) ? "conflict"
      : verdict || seen.has(idempotencyKey) ? "duplicate" : "new");
    seen.add(idempotencyKey);
  }

  const open = statement.filter(item => status.get(item.row.rowIndex) === "new");
  // Execute recomputes these under its locks and refuses any it was not given a decision for (A-01).
  const assigned = options.strategy === "prioritize_coppercoin"
    ? await assignStatementCandidates(tx, { householdId, userId, accountId, open, ownedKeys: byKey })
    : new Map();

  const previewRows = statement.map(({ row }): ImportPreviewRow => {
    const match = assigned.get(row.rowIndex);
    return {
      ordinal: row.rowIndex, date: row.dateString, type: row.type, amount: row.amount.toString(),
      merchant: row.merchantName, notes: row.notes ?? null, reference: row.reference ?? null,
      status: match ? "candidate" : status.get(row.rowIndex) ?? "new",
      ...(repeated.has(row.rowIndex) && { repeatsOrdinal: repeated.get(row.rowIndex) }),
      ...(match && { candidate: { id: match.candidate.id, name: match.candidate.name, date: match.candidate.date,
        amount: match.candidate.amount, reason: match.reason } }),
    };
  });
  const counts = { new: 0, duplicate: 0, candidate: 0, conflict: 0, failed: failedOrdinals(errors).length };
  for (const row of previewRows) counts[row.status]++;
  return { identityVersion: GLOBAL_IMPORT_IDENTITY_VERSION, fingerprint, dateFormat: options.dateFormat ?? "auto",
    strategy: options.strategy, rows: previewRows, errors, counts, accountCurrency: account.currency,
    removals: await previewRemovals(tx, statement, options, account.currency) };
}

/** The same planner execute runs, read without locks. */
async function previewRemovals(tx: TransactionType, statement: Parameters<typeof overwriteScopeOf>[0],
  options: PreviewOptions, accountCurrency: string): Promise<OverwriteRemoval[]> {
  const scope = options.strategy === "prioritize_csv"
    ? overwriteScopeOf(statement, options.categoryMapping, options, options.targetAccountId) : undefined;
  if (!scope) return [];
  const rows = await selectOverwriteRemovals(tx, scope, await readOverwriteRange(tx, scope, false));
  return rows.map(row => toOverwriteRemoval(row, accountCurrency));
}
