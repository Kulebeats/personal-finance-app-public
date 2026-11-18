/**
 * CSV Utilities
 *
 * TODO-008: Provides secure CSV field sanitization to prevent formula injection.
 *
 * @module core/csv
 */

const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Sanitize a CSV field value to prevent formula injection.
 * - Escapes quotes by doubling them
 * - Prepends single quote to neutralize formulas
 * - Wraps in quotes if contains special characters
 */
export function sanitizeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";

  let str = String(value);

  // Escape quotes by doubling them
  str = str.replaceAll('"', '""');

  // Neutralize formula injection by prepending single quote
  if (FORMULA_PREFIXES.some((p) => str.startsWith(p))) {
    str = "'" + str;
  }

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
