/**
 * CSV import parsing — pure functions, no database access.
 *
 * Extracted from `services/ImportService.ts` during the Rule 2 LOC burn-down.
 * FIN-15 replaces native-date parsing with the shared strict calendar contract.
 *
 * These parse money for real ledger writes, so the strictness below is
 * deliberate: reject rather than coerce.
 */
import { normalizeImportDate, type ImportDateFormat } from "@shared/import-date";
import { TEMPLATE_EXAMPLE_MARKERS } from "@shared/import-template";
import { Money } from "../../core/money";
import { applicableIssues, assertKnownColumns, indexIssues, mappedColumns, referenceDisplayIndex, type CellIssueIndex } from "./cellIssues";
import type { ImportCellIssue, ImportMapping, ImportReferenceDisplay, ImportRowError, ParsedImportRow } from "./types";

/**
 * Accepts a signed decimal with at most two fractional digits, optionally
 * written bare (".50"). More than 2dp is rejected rather than rounded —
 * silently rounding imported money would corrupt the ledger.
 */
const MONEY_PATTERN = /^[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/;

/** Currency symbols and separators stripped before validation. */
const MONEY_NOISE_PATTERN = /[$£€,\s]/g;

/** More than two decimal places: refused with its own reason, never rounded (IMP-01 review r1 P1). */
const EXTRA_DECIMALS_PATTERN = /^[+-]?\d*\.\d{3,}$/;

export function parseImportAmount(
  rawValue: string | undefined,
  rowIndex: number,
  { allowZero = false }: { allowZero?: boolean } = {},
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
        reason: EXTRA_DECIMALS_PATTERN.test(normalized)
          ? "Amount has more than 2 decimal places; round it in the file (for example with ROUND) and upload again"
          : "Invalid money amount",
        value: original,
      },
    };
  }

  const amount = new Money(normalized);
  if (amount.isZero() && !allowZero) {
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
 * Strict calendar validation shared with both import previews. Dates are UTC
 * midnight for sorting; dateString below is the timezone-independent writer value.
 */
export function parseImportDate(
  rawValue: string | undefined,
  rowIndex: number,
  dateFormat: ImportDateFormat = "auto",
): { date?: Date; error?: ImportRowError } {
  const original = rawValue?.trim() ?? "";
  const result = normalizeImportDate(rawValue, dateFormat);
  if (result.dateString === undefined) {
    return {
      error: {
        rowIndex,
        field: "date",
        reason: result.error,
        value: original || rawValue,
      },
    };
  }

  return { date: new Date(`${result.dateString}T00:00:00.000Z`) };
}

type AmountResult = { amount?: Money; error?: ImportRowError };

const cellOf = (row: Record<string, string>, column: string | undefined): string =>
  column ? row[column]?.trim() ?? "" : "";

const amountError = (rowIndex: number, reason: string, value?: string): AmountResult =>
  ({ error: { rowIndex, field: "amount", reason, value } });

/**
 * IMP-01: one signed amount per row. A filled Amount cell wins; otherwise
 * credit (money in) minus debit (money out), both written as positive numbers.
 * Amount together with Debit/Credit on one row is refused, never guessed.
 */
function resolveRowAmount(row: Record<string, string>, mapping: ImportMapping, rowIndex: number): AmountResult {
  const amountText = cellOf(row, mapping.amount);
  const debitText = cellOf(row, mapping.debit);
  const creditText = cellOf(row, mapping.credit);
  if (amountText && (debitText || creditText)) {
    return amountError(rowIndex, "Fill Amount, or Debit and Credit, not both", amountText);
  }
  if (amountText || (!mapping.debit && !mapping.credit)) return parseImportAmount(amountText, rowIndex);
  if (!debitText && !creditText) return amountError(rowIndex, "Amount is required (Debit or Credit)");

  const debit = parseImportAmount(debitText || "0", rowIndex, { allowZero: true });
  const credit = parseImportAmount(creditText || "0", rowIndex, { allowZero: true });
  if (debit.error || credit.error) return { error: debit.error ?? credit.error };
  if (!debit.amount || !credit.amount) return amountError(rowIndex, "Invalid money amount");
  if (debit.amount.isNegative() || credit.amount.isNegative()) {
    return amountError(rowIndex, "Debit and Credit must be positive numbers", debit.amount.isNegative() ? debitText : creditText);
  }
  const signed = credit.amount.subtract(debit.amount);
  if (signed.isZero()) return amountError(rowIndex, "Amount must be non-zero", `${debitText}/${creditText}`);
  return { amount: signed };
}

const EXAMPLE_MARKERS = new Set<string>(TEMPLATE_EXAMPLE_MARKERS);

/**
 * Excel error values. In a mapped column they are refused, never imported:
 * every #N/A reference would otherwise share one row identity (IMP-01 review r2 P2).
 */
const EXCEL_ERROR_VALUES = new Set(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A",
  "#GETTING_DATA", "#SPILL!", "#CALC!", "#FIELD!", "#BLOCKED!", "#CONNECT!", "#BUSY!", "#UNKNOWN!"]);

interface RowChecks {
  accountCurrency: string | undefined;
  cellIssues: CellIssueIndex;
}

/** Row-level refusals that apply before date and amount (IMP-01). */
function rowRefusal(
  row: Record<string, string>, mapping: ImportMapping, rowIndex: number, checks: RowChecks,
): ImportRowError | undefined {
  const marker = Object.values(row).find(value => EXAMPLE_MARKERS.has(value?.trim() ?? ""));
  if (marker !== undefined) {
    return { rowIndex, field: "row", reason: "This is the template's example row; delete it before importing", value: marker };
  }
  const columns = mappedColumns(mapping);
  // Typed Excel issues (error cells, invalid dates, hidden merged cells) first; only applicable ones are indexed (review r4).
  const rowIssues = checks.cellIssues.get(rowIndex);
  const issue = rowIssues && columns.map(column => rowIssues.get(column)).find(found => found !== undefined);
  if (issue) {
    return { rowIndex, field: "row", reason: `Column ${issue.column} holds ${issue.issue}; fix the cell and upload again`, value: cellOf(row, issue.column) };
  }
  // CSV has no cell types, so a literal Excel error text is refused as well.
  const errorColumn = columns.find(column => EXCEL_ERROR_VALUES.has(cellOf(row, column).toUpperCase()));
  if (errorColumn !== undefined) {
    const value = cellOf(row, errorColumn);
    return { rowIndex, field: "row", reason: `Column ${errorColumn} holds the Excel error ${value}; fix the cell and upload again`, value };
  }
  const currency = cellOf(row, mapping.currency);
  if (!currency) return undefined;
  // Fails closed: a currency is never accepted at face value (review r4 P1).
  if (!checks.accountCurrency) {
    return { rowIndex, field: "row", reason: `Currency ${currency} cannot be checked: the target account's currency is unknown`, value: currency };
  }
  if (currency.toUpperCase() !== checks.accountCurrency.toUpperCase()) {
    return { rowIndex, field: "row", reason: `Currency ${currency} does not match the account currency ${checks.accountCurrency}`, value: currency };
  }
  return undefined;
}

/**
 * Map raw CSV records to parsed rows, collecting per-row errors rather than
 * failing the whole import. A row missing a valid date OR amount is skipped.
 * A mapped header the rows lack, or a cell issue outside them, refuses the
 * whole request (review r5).
 */
export function parseRows(
  rows: Record<string, string>[],
  mapping: ImportMapping,
  dateFormat: ImportDateFormat = "auto",
  checks: { accountCurrency?: string; cellIssues?: ImportCellIssue[]; referenceDisplays?: ImportReferenceDisplay[] } = {},
): { rows: ParsedImportRow[]; errors: ImportRowError[] } {
  const parsedRows: ParsedImportRow[] = [];
  const errors: ImportRowError[] = [];
  assertKnownColumns(rows, mapping, checks.cellIssues ?? []);
  const rowChecks: RowChecks = {
    accountCurrency: checks.accountCurrency,
    cellIssues: indexIssues(applicableIssues(checks.cellIssues ?? [], mapping)),
  };
  // Excel leading-zero displays: only the Reference reads them; Amount and the rest read the stored value (review r6 P1).
  const referenceDisplays = referenceDisplayIndex(rows, mapping, checks.referenceDisplays ?? []);

  rows.forEach((row, index) => {
    const rowIndex = index + 1;
    const refusal = rowRefusal(row, mapping, rowIndex, rowChecks);
    if (refusal) {
      errors.push(refusal);
      return;
    }
    const dateResult = parseImportDate(row[mapping.date], rowIndex, dateFormat);
    const amountResult = resolveRowAmount(row, mapping, rowIndex);

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
      dateString: dateResult.date.toISOString().slice(0, 10),
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
      reference: mapping.reference ? referenceDisplays.get(rowIndex) ?? (row[mapping.reference]?.trim() || undefined) : undefined,
      raw: row,
    });
  });

  return { rows: parsedRows, errors };
}
