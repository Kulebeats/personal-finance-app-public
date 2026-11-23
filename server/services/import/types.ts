/**
 * Shared types for the CSV import pipeline.
 *
 * Extracted from the former single-file `services/ImportService.ts` (759 LOC)
 * as part of the Rule 2 LOC burn-down. Behaviour is unchanged.
 */
import type { Money } from "../../core/money";
import type { ImportDateFormat } from "@shared/import-date";

export interface ImportMapping {
  date: string;
  /** Signed amount column; or map debit and/or credit instead (IMP-01). */
  amount?: string;
  /** Money out, positive (IMP-01). */
  debit?: string;
  /** Money in, positive (IMP-01). */
  credit?: string;
  /** Optional per-row currency, checked against the target account (IMP-01). */
  currency?: string;
  merchant?: string;
  category?: string;
  account?: string;
  description?: string;
  notes?: string;
  tags?: string;
  /** Provider/bank transaction reference; when mapped it is the row identity (D13). */
  reference?: string;
}

export interface ParsedImportRow {
  rowIndex: number;
  date: Date;
  dateString: string;
  signedAmount: Money;
  amount: Money;
  type: "income" | "expense";
  merchantName: string;
  categoryName?: string;
  accountName?: string;
  notes?: string;
  reference?: string;
  raw: Record<string, string>;
}

export interface ImportRowError {
  rowIndex: number;
  field: "amount" | "date" | "row";
  reason: string;
  value?: string;
}

export interface ImportOptions {
  userId: string;
  householdId: string;
  targetAccountId?: string;
  strategy: "prioritize_coppercoin" | "prioritize_csv";
  mapping: ImportMapping;
  dateFormat?: ImportDateFormat;
  categoryMapping: Record<string, string>;
  ipAddress?: string;
  /** Client batch id: same id + same content replays, changed content is a 409. */
  batchKey?: string;
  /** Row ordinals the user reviewed as duplicates of existing ledger rows. */
  skipRowOrdinals?: number[];
  /** A-02: the ledger rows (id and version) the preview showed a "CSV wins" import removing. */
  reviewedRemovals?: ReadonlyArray<{ id: string; version: string }>;
  /** A-01: candidates the user chose to import anyway, each naming the ledger row it was shown against. */
  postRows?: ReadonlyArray<{ ordinal: number; candidateId: string }>;
  /** R2-01: candidates the user chose to skip, each naming the ledger row it was shown against, like postRows. */
  skipRows?: ReadonlyArray<{ ordinal: number; candidateId: string }>;
  /** R2 P2: the account currency the preview showed; execute refuses when the account's currency differs. */
  previewCurrency?: string;
  fileName?: string;
  /** Target account currency; a mapped currency column must match it (IMP-01). */
  accountCurrency?: string;
  /** Excel cells whose text is not what Excel shows (IMP-01 review r4): a mapped one is a row error. */
  cellIssues?: ImportCellIssue[];
  /** Excel number cells Excel shows with leading zeros; used only when that column is the Reference (review r6). */
  referenceDisplays?: ImportReferenceDisplay[];
}

/**
 * IMP-01 review r6: a number cell Excel shows with leading zeros (000123).
 * The row keeps the stored decimal, so Amount and every other field read
 * exactly what CSV would. Only the Reference field reads this display, which
 * must be the stored value with leading zeros added.
 */
export interface ImportReferenceDisplay {
  /** 1-based data row ordinal. */
  row: number;
  /** Header of the column. */
  column: string;
  text: string;
}

/**
 * IMP-01 review r4: an Excel cell whose value cannot be imported as shown (an
 * error cell, a date Excel cannot show, a cell hidden inside a merged range).
 * Carried beside the rows, never inside them, so raw values, row identity and
 * dedupe are the same as for the equivalent CSV.
 */
export interface ImportCellIssue {
  /** 1-based data row ordinal, as ImportRowError.rowIndex. */
  row: number;
  /** Header of the column. */
  column: string;
  issue: string;
  /** Only refuses the row when the column is mapped as this field (a display Excel shows that cannot be reproduced). */
  field?: "reference";
}

/** Most cell issues one sheet may carry. */
export const MAX_IMPORT_CELL_ISSUES = 10000;

export type ImportRowOutcome = "imported" | "duplicate" | "skipped" | "failed";

export interface ImportRowOutcomeRecord {
  ordinal: number;
  outcome: ImportRowOutcome;
  transactionId?: string;
  /** Account-detail import (NEW-17): the existing row this imported row may repeat, for review. */
  possibleDuplicateOf?: string;
}

/**
 * imported: new ledger rows. duplicate: row identity already in the ledger.
 * skipped: duplicate candidates the user chose not to import. failed: rows
 * refused by validation (distinct rows, not error count).
 */
export interface ExecuteImportResult {
  importId: string;
  replayed: boolean;
  imported: number;
  duplicate: number;
  skipped: number;
  failed: number;
  deleted: number;
  errors: ImportRowError[];
}
