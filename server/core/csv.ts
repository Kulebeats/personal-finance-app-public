/**
 * CSV Utilities
 *
 * TODO-008: Provides secure CSV field sanitization to prevent formula injection.
 *
 * @module core/csv
 */

import type { MoneyDto } from "@shared/money";
import { needsCsvFormulaPrefix } from "@shared/csv-formula";
import { Money } from "./money";

const CSV_DECIMAL_PATTERN = /^-?\d+\.\d{2}$/;

/**
 * Prefix a text cell that a spreadsheet would evaluate as a formula with a
 * single quote, keeping the original text. Spreadsheets skip leading
 * whitespace, so " =1+1" is checked as "=1+1"; tab and CR are prefixes in
 * their own right. Apply to text only: numeric cells, negative amounts
 * included, stay numeric by being written as numbers or CsvDecimal.
 */
export function neutralizeCsvFormula(text: string): string {
  return needsCsvFormulaPrefix(text) ? `'${text}` : text;
}

/** A fixed two-decimal amount, written as a numeric CSV cell (never neutralized). */
export class CsvDecimal {
  readonly text: string;

  constructor(text: string) {
    if (!CSV_DECIMAL_PATTERN.test(text)) throw new Error("Invalid CSV decimal amount");
    this.text = text;
  }
}

/**
 * Exact fixed two-decimal CSV amount from a MoneyDto through the Money class.
 * An absent amount is written as 0.00 (the previous behaviour); a malformed
 * amount throws instead of silently becoming zero.
 */
export function csvMoney(value?: MoneyDto): CsvDecimal {
  if (!value) return new CsvDecimal("0.00");
  return new CsvDecimal(new Money(value.amount, value.currency).toString());
}

/**
 * Sanitize a CSV field value to prevent formula injection.
 * - Escapes quotes by doubling them
 * - Prepends single quote to neutralize formulas
 * - Wraps in quotes if contains special characters
 */
export function sanitizeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  // A validated two-decimal amount stays numeric: "-58.12" is not a formula.
  if (value instanceof CsvDecimal) return value.text;

  // Escape quotes by doubling them, then neutralize formula injection
  const str = neutralizeCsvFormula(String(value).replaceAll('"', '""'));

  // Wrap in quotes if contains special characters
  if (/[",\n\r]/.test(str)) {
    return `"${str}"`;
  }

  return str;
}

/**
 * Sanitize an array of values and join them as a CSV row.
 */
export function sanitizeCsvRow(values: unknown[]): string {
  return values.map(sanitizeCsvField).join(",");
}

/**
 * Creates a proper CSV from headers and rows with sanitization.
 */
export function createCsv(headers: string[], rows: unknown[][]): string {
  const lines: string[] = [];

  // Add header row
  lines.push(sanitizeCsvRow(headers));

  // Add data rows
  for (const row of rows) {
    lines.push(sanitizeCsvRow(row));
  }

  return lines.join("\n");
}
