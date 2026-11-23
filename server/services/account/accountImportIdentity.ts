/**
 * NEW-17 (D13) on the account-detail import: row identity and review flags.
 *
 * A row's key is the statement (its parsed rows) plus the row ordinal
 * (`account-csv:v2`), so the same file replays exactly and an identical
 * purchase in another statement is a new row. Imports before v2 keyed rows by
 * content and occurrence only (`account-csv:v1`). Those keys are used again
 * only when this account's import history shows the same file was imported
 * under them, so a retry of that file still replays. Nothing is backfilled.
 *
 * A new row that matches a visible ledger row by date, direction and amount
 * is held for review before any of the statement posts.
 */
import { and, eq, inArray } from "drizzle-orm";
import { dataImports } from "@shared/schema";
import { db } from "../../db";
import {
  accountImportRowKey, accountStatementFingerprint, accountStatementRowKey, importOccurrenceKey, importRequestFingerprint,
  type AccountStatementRow,
} from "../import/identity";
import { readLedgerCandidates, type LedgerCandidate } from "../import/candidates";
import { importDirection } from "./accountCsvSign";

export const ACCOUNT_IMPORT_LEGACY_VERSION = "account-csv:v1";
export const ACCOUNT_IMPORT_IDENTITY_VERSION = "account-csv:v2";
const POSTING_MODES = ["posted", "history_only"] as const;

export interface AccountImportKeys {
  version: string;
  keys: string[];
  /** The history fingerprint of this attempt. */
  fingerprint: string;
}

interface Scope { householdId: string; accountId: string }

function historyFingerprint(version: string, accountId: string, postingMode: string, keys: string[]): string {
  return importRequestFingerprint([version, accountId.toLowerCase(), postingMode, keys]);
}

function legacyKeys(scope: Scope, rows: readonly AccountStatementRow[]): string[] {
  const occurrences = new Map<string, number>();
  return rows.map(row => {
    const baseKey = accountImportRowKey(scope.householdId, scope.accountId, { ...row, amount: row.amount.toString() });
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    return importOccurrenceKey(baseKey, occurrence);
  });
}

/** v1 keys when this account's history holds the same file under them (either posting mode), else v2 keys. */
export async function planAccountImportKeys(scope: Scope, rows: readonly AccountStatementRow[], postingMode: string): Promise<AccountImportKeys> {
  const legacy = legacyKeys(scope, rows);
  const legacyPrints = POSTING_MODES.map(mode => historyFingerprint(ACCOUNT_IMPORT_LEGACY_VERSION, scope.accountId, mode, legacy));
  const [prior] = rows.length ? await db.select({ id: dataImports.id }).from(dataImports).where(and(
    eq(dataImports.householdId, scope.householdId), eq(dataImports.accountId, scope.accountId),
    eq(dataImports.source, "account_csv"), inArray(dataImports.fingerprint, legacyPrints),
  )).limit(1) : [];
  if (prior) {
    return { version: ACCOUNT_IMPORT_LEGACY_VERSION, keys: legacy,
      fingerprint: historyFingerprint(ACCOUNT_IMPORT_LEGACY_VERSION, scope.accountId, postingMode, legacy) };
  }
  const statement = accountStatementFingerprint(rows);
  const keys = rows.map((_, index) => accountStatementRowKey(scope.householdId, scope.accountId, statement, index + 1));
  return { version: ACCOUNT_IMPORT_IDENTITY_VERSION, keys,
    fingerprint: historyFingerprint(ACCOUNT_IMPORT_IDENTITY_VERSION, scope.accountId, postingMode, keys) };
}

const sameMerchant = (candidate: LedgerCandidate, merchant: string) =>
  candidate.name.trim().toLowerCase() === merchant.trim().toLowerCase();

/**
 * Visible ledger rows that new rows may repeat, one-to-one: the same merchant
 * first, then any row with the same date, direction and amount.
 * @param open the ordinals (1-based) of rows that do not replay by key
 * @returns ordinal -> visible snapshot of the existing row it may repeat
 */
export async function findPossibleDuplicates(params: Scope & {
  userId: string; rows: readonly AccountStatementRow[]; open: readonly number[]; ownedKeys: ReadonlySet<string>;
}): Promise<Map<number, LedgerCandidate>> {
  const flagged = new Map<number, LedgerCandidate>();
  const openRows = params.open.map(ordinal => ({ ordinal, row: params.rows[ordinal - 1] }));
  if (!openRows.length) return flagged;
  const dates = openRows.map(({ row }) => row.date).sort();
  const ledger = (await readLedgerCandidates(db, { householdId: params.householdId, userId: params.userId,
    accountId: params.accountId, startDate: dates[0], endDate: dates[dates.length - 1] }))
    .filter(candidate => !candidate.idempotencyKey || !params.ownedKeys.has(candidate.idempotencyKey));
  const taken = new Set<string>();
  const matches = (row: AccountStatementRow, candidate: LedgerCandidate) => !taken.has(candidate.id)
    && candidate.date === row.date && candidate.type === importDirection(row.amount)
    && row.amount.abs().equals(candidate.amount);
  for (const preferMerchant of [true, false]) {
    for (const { ordinal, row } of openRows) {
      if (flagged.has(ordinal)) continue;
      const match = ledger.find(candidate => matches(row, candidate) && (!preferMerchant || sameMerchant(candidate, row.merchant)));
      if (!match) continue;
      taken.add(match.id);
      flagged.set(ordinal, match);
    }
  }
  return flagged;
}
