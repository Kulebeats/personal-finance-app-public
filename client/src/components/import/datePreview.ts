import { normalizeImportDate, type ImportDateFormat } from "@shared/import-date";

export function previewImportDates(rows: Record<string, string>[], dateColumn: string,
  dateFormat: ImportDateFormat) {
  const dates = rows.map((row, index) => ({ rowIndex: index + 1,
    original: row[dateColumn], ...normalizeImportDate(row[dateColumn], dateFormat) }));
  return {
    dates,
    hasErrors: dates.some(date => !!date.error),
    // Preserve raw cells: Notes/Merchant/Category may map to the date column.
    // Submit this snapshot with the same format; the shared server parser
    // resolves the date without changing values read by other mappings.
    rows: rows.map(row => ({ ...row })),
  };
}
