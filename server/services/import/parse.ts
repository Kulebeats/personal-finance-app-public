/**
 * CSV import parsing — pure functions, no database access.
 *
 * Extracted verbatim from `services/ImportService.ts` during the Rule 2 LOC
 * burn-down. Behaviour is pinned by
 * `services/__tests__/import.parse.characterization.test.ts`, which was written
 * against the pre-split implementation and passes unchanged here — that
 * equivalence is the proof this move changed nothing.
 *
 * These parse money for real ledger writes, so the strictness below is
 * deliberate: reject rather than coerce.
 */
import { format, parse as parseDateFns, isValid } from "date-fns";
import { Money } from "../../core/money";
import type { ImportMapping, ImportRowError, ParsedImportRow } from "./types";

/**
 * Accepts a signed decimal with at most two fractional digits, optionally
 * written bare (".50"). More than 2dp is rejected rather than rounded —
 * silently rounding imported money would corrupt the ledger.
 */
const MONEY_PATTERN = /^[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/;

/** Currency symbols and separators stripped before validation. */
const MONEY_NOISE_PATTERN = /[$£€,\s]/g;

export function parseImportAmount(
  rawValue: string | undefined,
  rowIndex: number,
): { amount?: Money; error?: ImportRowError } {
  const original = rawValue?.trim() ?? "";
  if (!original) {
    return {
      error: {
        rowIndex,
        field: "amount",
        reason: "Amount is required",
        value: rawValue,
      },
    };
  }

  let normalized = original;
  // Accounting notation: (50.00) means -50.00.
  const parenthesized = /^\(.+\)$/.test(normalized);
  if (parenthesized) {
    normalized = normalized.slice(1, -1);
  }

  normalized = normalized.replace(MONEY_NOISE_PATTERN, "");
  if (parenthesized) {
    normalized = `-${normalized}`;
  }

  if (!MONEY_PATTERN.test(normalized)) {
    return {
      error: {
        rowIndex,
        field: "amount",
        reason: "Invalid money amount",
        value: original,
      },
    };
  }

  const amount = new Money(normalized);
  if (amount.isZero()) {
    return {
      error: {
        rowIndex,
        field: "amount",
        reason: "Amount must be non-zero",
        value: original,
      },
    };
  }

  return { amount };
}

/**
 * Native `Date` parsing wins when it succeeds, so an ambiguous slash date like
 * "01/02/2026" resolves US-style (2 January). The dd/MM then MM/dd fallbacks
 * only run when the native parse fails outright (e.g. "25/12/2026").
 */
export function parseImportDate(
  rawValue: string | undefined,
  rowIndex: number,
): { date?: Date; error?: ImportRowError } {
  const original = rawValue?.trim() ?? "";
  if (!original) {
    return {
      error: {
        rowIndex,
        field: "date",
        reason: "Date is required",
        value: rawValue,
      },
    };
  }

  let date = new Date(original);
  if (!isValid(date)) {
    const dmy = parseDateFns(original, "dd/MM/yyyy", new Date());
    if (isValid(dmy)) {
      date = dmy;
    } else {
      const mdy = parseDateFns(original, "MM/dd/yyyy", new Date());
      if (isValid(mdy)) {
        date = mdy;
      }
    }
  }

  if (!isValid(date)) {
    return {
      error: {
        rowIndex,
        field: "date",
        reason: "Invalid date",
        value: original,
      },
    };
  }

  return { date };
}

/**
 * Map raw CSV records to parsed rows, collecting per-row errors rather than
 * failing the whole import. A row missing a valid date OR amount is skipped.
 */
export function parseRows(
  rows: Record<string, string>[],
  mapping: ImportMapping,
): { rows: ParsedImportRow[]; errors: ImportRowError[] } {
  const parsedRows: ParsedImportRow[] = [];
  const errors: ImportRowError[] = [];

  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const dateResult = parseImportDate(row[mapping.date], rowIndex);
    const amountResult = parseImportAmount(row[mapping.amount], rowIndex);

    if (dateResult.error) {
      errors.push(dateResult.error);
    }
    if (amountResult.error) {
      errors.push(amountResult.error);
    }
    if (!dateResult.date || !amountResult.amount) {
      return;
    }

    const signedAmount = amountResult.amount;
    const type = signedAmount.lt(0) ? "expense" : "income";
    const notesField = mapping.notes ?? mapping.description;

    parsedRows.push({
      rowIndex,
      date: dateResult.date,
      dateString: format(dateResult.date, "yyyy-MM-dd"),
      signedAmount,
      amount: signedAmount.abs(),
      type,
      merchantName: mapping.merchant ? row[mapping.merchant]?.trim() ?? "" : "",
      categoryName: mapping.category
        ? row[mapping.category]?.trim() || undefined
        : undefined,
      accountName: mapping.account
        ? row[mapping.account]?.trim() || undefined
        : undefined,
      notes: notesField ? row[notesField]?.trim() || undefined : undefined,
      raw: row,
    });
  });

  return { rows: parsedRows, errors };
}
