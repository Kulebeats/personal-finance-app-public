/**
 * The account CSV exporter (server/core/csv.ts) puts one apostrophe before text a
 * spreadsheet would evaluate as a formula. The account importer removes exactly
 * that apostrophe (R2-03), so exported text round-trips byte for byte.
 */
const CSV_FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/** True when a spreadsheet would read the text as a formula; leading whitespace is skipped, as spreadsheets do. */
export function isCsvFormulaText(text: string): boolean {
  const trimmed = text.trimStart();
  return CSV_FORMULA_PREFIXES.some(prefix => text.startsWith(prefix) || trimmed.startsWith(prefix));
}

/**
 * True when the exporter must add its apostrophe: formula-like text, and the same text behind
 * apostrophes of its own (`'=x`), which the importer's single-apostrophe restore would otherwise strip.
 */
export function needsCsvFormulaPrefix(text: string): boolean {
  return isCsvFormulaText(text.replace(/^'+/, ""));
}

/** Remove the apostrophe the exporter added; any other cell is returned unchanged. */
export function restoreCsvFormulaText(cell: string): string {
  return cell.startsWith("'") && needsCsvFormulaPrefix(cell.slice(1)) ? cell.slice(1) : cell;
}
