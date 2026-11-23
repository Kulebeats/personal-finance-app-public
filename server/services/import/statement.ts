/**
 * NEW-17: one parsed statement with its row identities, shared by preview and execute.
 */
import { ConflictError } from "../../core/errors";
import { buildImportIdempotencyKey } from "./dedupe";
import { globalImportRowKey, importBatchFingerprint, importOccurrenceKey, importStatementFingerprint, statementRowKey } from "./identity";
import { applicableIssues } from "./cellIssues";
import { parseRows } from "./parse";
import type { ImportOptions, ImportRowError, ParsedImportRow } from "./types";

export interface StatementRow {
  row: ParsedImportRow;
  /** v3 identity written to `transactions.idempotency_key`. */
  idempotencyKey: string;
  /** The row's v2 key when it differs (no reference): a stored row under it is the same row. */
  priorKey?: string;
  /** Frozen v1 key, used only to recognise rows the old engine imported. */
  legacyKey: string;
}

export interface ParsedStatement {
  fingerprint: string;
  statement: StatementRow[];
  errors: ImportRowError[];
}

export function buildStatement(
  rows: Record<string, string>[], options: ImportOptions, targetAccountId: string,
): ParsedStatement {
  const dateFormat = options.dateFormat ?? "auto";
  const cellIssues = options.cellIssues ?? [];
  const referenceDisplays = options.referenceDisplays ?? [];
  const parsed = parseRows(rows, options.mapping, dateFormat, { accountCurrency: options.accountCurrency, cellIssues, referenceDisplays });
  const fingerprint = importBatchFingerprint({ rows, mapping: { ...options.mapping }, dateFormat,
    refusingCellIssues: applicableIssues(cellIssues, options.mapping), referenceDisplays });
  const statementFingerprint = importStatementFingerprint(parsed.rows, failedOrdinals(parsed.errors));
  const occurrences = new Map<string, number>();
  const statement = parsed.rows.map((row): StatementRow => {
    const base = buildImportIdempotencyKey(options, targetAccountId, row);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    const identity = { ordinal: row.rowIndex, reference: row.reference };
    const idempotencyKey = statementRowKey(options.householdId, targetAccountId, statementFingerprint, identity);
    const priorKey = globalImportRowKey(options.householdId, targetAccountId, fingerprint, identity);
    return {
      row,
      idempotencyKey,
      ...(priorKey !== idempotencyKey && { priorKey }),
      legacyKey: importOccurrenceKey(base, occurrence),
    };
  });
  return { fingerprint, statement, errors: parsed.errors };
}

/** Every key a stored row of this statement row may carry: the v3 key, then the v2 key. */
export function matchKeys(item: StatementRow): string[] {
  return item.priorKey ? [item.idempotencyKey, item.priorKey] : [item.idempotencyKey];
}

/** The stored row of a statement row, found under its v3 key first, else its v2 key. */
export function storedMatch<T>(byKey: ReadonlyMap<string | null, T>, item: StatementRow): T | undefined {
  return byKey.get(item.idempotencyKey) ?? (item.priorKey ? byKey.get(item.priorKey) : undefined);
}

/** Distinct row ordinals that failed validation (one row can carry two errors). */
export function failedOrdinals(errors: ImportRowError[]): number[] {
  return Array.from(new Set(errors.map(error => error.rowIndex))).sort((a, b) => a - b);
}

/** Field-order-independent text of a raw file row. */
function canonicalRow(raw: Record<string, string>): string {
  return JSON.stringify(Object.keys(raw).sort().map(key => [key, raw[key]]));
}

/**
 * NEW-17 review P1-1: rows that share an identity (the same provider
 * reference) inside one file. A byte-identical repeat is a duplicate; a
 * repeat with ANY different content is a conflict with its first occurrence,
 * because keeping either one would silently drop a financial row.
 * Returns repeated ordinal -> first ordinal, for conflicting repeats only.
 */
export function repeatedIdentityConflicts(statement: StatementRow[]): Map<number, number> {
  const first = new Map<string, StatementRow>();
  const conflicts = new Map<number, number>();
  for (const item of statement) {
    const prior = first.get(item.idempotencyKey);
    if (!prior) {
      first.set(item.idempotencyKey, item);
    } else if (canonicalRow(prior.row.raw) !== canonicalRow(item.row.raw)) {
      conflicts.set(item.row.rowIndex, prior.row.rowIndex);
    }
  }
  return conflicts;
}

/** The whole import is refused, naming every conflicting pair of rows. */
export class ImportRowConflictError extends ConflictError {
  readonly errors: ImportRowError[];

  constructor(statement: StatementRow[], conflicts: Map<number, number>) {
    const references = new Map(statement.map(item => [item.row.rowIndex, item.row.reference]));
    const errors = Array.from(conflicts, ([ordinal, firstOrdinal]): ImportRowError => ({
      rowIndex: ordinal, field: "row", value: references.get(ordinal),
      reason: `Row ${ordinal} repeats the reference of row ${firstOrdinal} with different content`,
    }));
    super(`${errors.map(error => error.reason).join("; ")}. No rows were imported.`);
    this.errors = errors;
  }

  toJSON() {
    const response = super.toJSON();
    return { ...response, error: { ...response.error, details: { errors: this.errors } } };
  }
}
