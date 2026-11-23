import { createHash } from "node:crypto";
import type { ParsedImportRow } from "./types";
import type { Money } from "../../core/money";

/** Stable UUID shape for the existing uuid-typed operation-key column. */
function uuidFor(parts: unknown[]): string {
  const hash = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  const variant = (("0123456789abcdef".indexOf(hash[16]) & 3) | 8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Keep the original global row key byte-for-byte for its first occurrence. */
export function importOccurrenceKey(baseKey: string, occurrence: number): string {
  return occurrence === 0 ? baseKey : uuidFor(["csv-import-occurrence:v1", baseKey, occurrence]);
}

export function accountImportRowKey(householdId: string, accountId: string, row: {
  date: string; merchant: string; amount: string; category?: string;
  originalStatement?: string; notes?: string; tags?: string;
}): string {
  // Mode is deliberately absent: replaying history as a new cash posting must
  // conflict against the original row rather than mint another financial key.
  return uuidFor(["account-csv:v1", householdId.toLowerCase(), accountId.toLowerCase(),
    row.date, row.merchant, row.amount, row.category ?? null,
    row.originalStatement ?? null, row.notes ?? null, row.tags ?? null]);
}

export interface AccountStatementRow {
  date: string; merchant: string; amount: Money; category?: string;
  originalStatement?: string; notes?: string; tags?: string;
}

const trimmedOrNull = (text: string | undefined) => text?.trim() || null;

/**
 * Account-detail import statement (NEW-17 / D13 on the account path): each row's
 * calendar date, Money amount and currency, and trimmed text fields, in file
 * order. Raw spelling never feeds in.
 */
export function accountStatementFingerprint(rows: readonly AccountStatementRow[]): string {
  return sha256(["account-csv-statement:v1", rows.map(row => [row.date, row.amount.toString(), row.amount.currency,
    row.merchant.trim(), trimmedOrNull(row.category), trimmedOrNull(row.originalStatement), trimmedOrNull(row.notes),
    row.tags?.split(",").map(tag => tag.trim()).filter(Boolean).join(",") || null])]);
}

/** Account-detail import key v2: the statement plus the row ordinal, so the same file replays and another file never collides. */
export function accountStatementRowKey(householdId: string, accountId: string, statementFingerprint: string, ordinal: number): string {
  return uuidFor(["account-csv:v2", householdId.toLowerCase(), accountId.toLowerCase(), "row", statementFingerprint, ordinal]);
}

/**
 * NEW-17 / D13 global import identity, version 3.
 *
 * Key migration plan: rows imported before v2 keep their v1 keys
 * (`dedupe.ts` `buildImportIdempotencyKey`, frozen by its characterisation
 * test). Nothing is backfilled. A v1 key that matches an incoming row only
 * marks a duplicate CANDIDATE in the preview.
 *
 * v3 (#253 r6 P1-3) changes only the key of a row without a provider
 * reference: it is built from the statement's parsed values, not its raw
 * cells, so the same statement as CSV (12.50) and Excel (12.5) has one
 * identity. Reference keys are unchanged. A v3 import still computes each
 * row's v2 key and matches either, so rows stored under v2 replay exactly.
 */
export const GLOBAL_IMPORT_IDENTITY_VERSION = "csv-import:v3";
/** Scope of reference keys (all versions) and of v2 fallback keys. */
const REFERENCE_KEY_SCOPE = "csv-import:v2";
const FALLBACK_KEY_SCOPE = "csv-import:v3";

function sha256(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Key order of a parsed CSV object must not change its identity. */
function sortedEntries(record: Record<string, string | undefined>): Array<[string, string]> {
  return Object.entries(record)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Batch fingerprint: the submitted file rows plus the mapping version (columns
 * and date format). The Excel cell issues that refuse rows are included when
 * there are any (IMP-01 review r5), so preview and execute provably apply the
 * same refusals, and so are the Reference displays that change a row's
 * identity (review r6). A file with neither keeps its fingerprint unchanged.
 */
export function importBatchFingerprint(input: {
  rows: Record<string, string>[]; mapping: Record<string, string | undefined>; dateFormat: string;
  refusingCellIssues?: ReadonlyArray<{ row: number; column: string; issue: string; field?: string }>;
  referenceDisplays?: ReadonlyArray<{ row: number; column: string; text: string }>;
}): string {
  const issues = input.refusingCellIssues ?? [];
  const displays = [...(input.referenceDisplays ?? [])].sort((a, b) => a.row - b.row);
  return sha256([GLOBAL_IMPORT_IDENTITY_VERSION, sortedEntries(input.mapping), input.dateFormat,
    input.rows.map(row => sortedEntries(row)),
    ...(issues.length ? [["cell-issues:v1", issues.map(issue => [issue.row, issue.column, issue.issue, issue.field ?? null])]] : []),
    ...(displays.length ? [["reference-displays:v1", displays.map(display => [display.row, display.column, display.text])]] : [])]);
}

/** Fingerprint of everything that changes an import's effect; a replay under one batch id must match it. */
export function importRequestFingerprint(parts: unknown[]): string {
  return sha256(["csv-import-request:v1", ...parts]);
}

/**
 * v2 key: provider reference when the file supplies one, else the raw batch
 * fingerprint plus row ordinal. Both are scoped to household and account. Two
 * identical purchases in one file therefore differ by ordinal, and replaying
 * the same file reproduces the same keys. Kept to match rows stored under v2.
 */
export function globalImportRowKey(householdId: string, accountId: string, fingerprint: string,
  row: { ordinal: number; reference?: string }): string {
  const scope = [REFERENCE_KEY_SCOPE, householdId.toLowerCase(), accountId.toLowerCase()];
  return row.reference
    ? uuidFor([...scope, "reference", row.reference])
    : uuidFor([...scope, "row", fingerprint, row.ordinal]);
}

/**
 * The statement as it posts (#253 r6 P1-3): each parsed row's calendar date,
 * Money amount in its canonical spelling and currency, and its trimmed text
 * fields, plus the ordinals that failed. No raw cell spelling feeds in, so the
 * same statement from any file format has one fingerprint.
 */
export function importStatementFingerprint(rows: readonly ParsedImportRow[], failedOrdinals: readonly number[]): string {
  return sha256(["csv-import-statement:v1",
    rows.map(row => [row.rowIndex, row.dateString, row.signedAmount.toString(), row.signedAmount.currency,
      row.merchantName, row.categoryName ?? null, row.accountName ?? null, row.notes ?? null, row.reference ?? null]),
    [...failedOrdinals].sort((a, b) => a - b)]);
}

/** v3 key: the provider reference key unchanged, else the statement fingerprint plus row ordinal. */
export function statementRowKey(householdId: string, accountId: string, statementFingerprint: string,
  row: { ordinal: number; reference?: string }): string {
  if (row.reference) return globalImportRowKey(householdId, accountId, "", row);
  return uuidFor([FALLBACK_KEY_SCOPE, householdId.toLowerCase(), accountId.toLowerCase(), "row", statementFingerprint, row.ordinal]);
}
