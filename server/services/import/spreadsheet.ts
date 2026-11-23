/**
 * IMP-01 upload format detection and the .xlsx path into the import pipeline.
 * An Excel sheet becomes the same `{ headers, rows }` records a CSV parse
 * returns, so preview, dedupe, identity and execute are one path for both.
 */
import { ValidationError } from "../../core/errors";
import type { ImportCellIssue, ImportReferenceDisplay } from "./types";
import { readXlsxSheet, XlsxSheetError } from "./xlsx/workbook";

export const IMPORT_MAX_ROWS = 5000;
export const XLSX_MAX_BYTES = 5 * 1024 * 1024;
export const XLSX_MAX_COLUMNS = 100;
/** Characters a parsed sheet may return, header names counted once per row (review r1 P1). */
export const XLSX_MAX_TEXT_CHARS = 16 * 1024 * 1024;

/** JSON keys and punctuation of one serialized cell issue or Reference display. */
const ISSUE_OVERHEAD_CHARS = 64;

export type ImportFileFormat = "csv" | "xlsx";

export interface ParsedImportFile {
  format: ImportFileFormat;
  headers: string[];
  rows: Record<string, string>[];
  /** Excel only: every sheet name, the sheet read, and formula cells read by saved value. */
  sheets?: string[];
  /** Excel only: sheets hidden in Excel, labelled in the picker. */
  hiddenSheets?: string[];
  sheet?: string;
  formulaCells?: number;
  /** Excel only: cells that cannot be imported as shown, beside the rows (review r4). */
  cellIssues?: ImportCellIssue[];
  /** Excel only: number cells shown with leading zeros, read only by the Reference (review r6). */
  referenceDisplays?: ImportReferenceDisplay[];
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Decided by content first; the name only adds refusals. */
export function detectImportFormat(buffer: Buffer, fileName: string): ImportFileFormat {
  const lowerName = fileName.toLowerCase();
  if (/\.xl[st]m$/.test(lowerName)) {
    throw new ValidationError("Macro-enabled Excel files (.xlsm) are not accepted. Save the file as an .xlsx workbook.");
  }
  if (buffer.subarray(0, OLE_MAGIC.length).equals(OLE_MAGIC) || lowerName.endsWith(".xls")) {
    throw new ValidationError("Old Excel files (.xls) are not accepted. Save the file as an .xlsx workbook or CSV.");
  }
  if (buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) return "xlsx";
  if (lowerName.endsWith(".xlsx")) throw new ValidationError("This file is not a valid .xlsx workbook.");
  return "csv";
}

/**
 * Unique header names; a blank header becomes "Column N" (N is 1-based). A
 * repeated name takes the first free "Name (n)" that no other header uses,
 * so no column is ever overwritten in the row records (review r1 P2).
 */
function uniqueHeaders(cells: string[]): string[] {
  const bases = cells.map((cell, index) => cell.trim() || `Column ${index + 1}`);
  const reserved = new Set(bases);
  const taken = new Set<string>();
  const isFree = (name: string) => !taken.has(name) && !reserved.has(name);
  return bases.map(base => {
    let name = base;
    for (let copy = 2; taken.has(name); copy++) {
      if (isFree(`${base} (${copy})`)) name = `${base} (${copy})`;
    }
    taken.add(name);
    return name;
  });
}

export function parseXlsxImport(buffer: Buffer, sheet?: string): ParsedImportFile {
  if (buffer.length > XLSX_MAX_BYTES) {
    throw new ValidationError(`Excel files are limited to ${XLSX_MAX_BYTES / (1024 * 1024)} MB.`);
  }
  const table = readXlsxSheet(buffer, {
    sheet, maxRows: IMPORT_MAX_ROWS, maxColumns: XLSX_MAX_COLUMNS, maxTextChars: XLSX_MAX_TEXT_CHARS,
  });
  const sheetError = (message: string) => new XlsxSheetError(message, table.sheets, table.sheet, table.hiddenSheets);
  const [headerCells, ...dataRows] = table.rows;
  if (!headerCells || dataRows.length === 0) {
    throw sheetError(`The sheet "${table.sheet}" has no rows to import below its header row.`);
  }
  const width = Math.max(headerCells.length, ...dataRows.map(row => row.length));
  const headers = uniqueHeaders(Array.from({ length: width }, (_, index) => headerCells[index] ?? ""));
  // Sheet row 0 is the header, so sheet row r is data ordinal r; header-row issues do not affect any row.
  const cellIssues = table.issues.filter(({ row, column }) => row > 0 && column < headers.length)
    .map(({ row, column, issue, field }): ImportCellIssue => ({ row, column: headers[column], issue, ...(field ? { field } : {}) }));
  const referenceDisplays = table.referenceDisplays.filter(({ row, column }) => row > 0 && column < headers.length)
    .map(({ row, column, text }): ImportReferenceDisplay => ({ row, column: headers[column], text }));
  const headerChars = headers.reduce((sum, header) => sum + header.length, 0);
  const cellChars = dataRows.reduce((sum, row) => row.reduce((rowSum, cell) => rowSum + cell.length, sum), 0);
  // Each issue repeats its header in the response, so it is charged too (review r5 P1).
  const issueChars = cellIssues.reduce((sum, item) => sum + item.column.length + item.issue.length + ISSUE_OVERHEAD_CHARS, 0)
    + referenceDisplays.reduce((sum, item) => sum + item.column.length + item.text.length + ISSUE_OVERHEAD_CHARS, 0);
  if (headerChars * dataRows.length + cellChars + issueChars > XLSX_MAX_TEXT_CHARS) {
    throw sheetError(`The sheet "${table.sheet}" holds more text than an import can return; remove unused columns or rows.`);
  }
  const rows = dataRows.map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
  return { format: "xlsx", headers, rows, sheets: table.sheets, hiddenSheets: table.hiddenSheets, sheet: table.sheet,
    formulaCells: table.formulaCells, cellIssues, referenceDisplays };
}
