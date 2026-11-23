/**
 * IMP-01 .xlsx reader: one worksheet as rows of cell text, on SheetJS CE
 * (owner decision N2).
 *
 * Layers, in order:
 * 1. zipPrecheck.ts checks and inflates the archive (bounded, CRC-checked);
 *    SheetJS reads an archive rebuilt from those verified parts, never the upload.
 * 2. xmlParts.ts validates every XML part on fast-xml-parser.
 * 3. workbookParts.ts and strictSheet.ts check the structure SheetJS would
 *    accept silently.
 * 4. SheetJS reads the sheet: strings, formats and rendered text, merged
 *    ranges, sheet names and visibility.
 * 5. This file joins steps 3 and 4. Each cell is matched by address, so
 *    neither side can add or drop a cell unnoticed, and our own rules sit on
 *    top: typed dates and serials (cells.ts), the reference display check
 *    (numberFormat.ts), typed errors, merges (merges.ts) and the budgets.
 *
 * Formulas are never evaluated: a formula cell yields the value Excel last
 * saved, and a formula with no saved value refuses the file.
 */
import * as XLSX from "xlsx";
import { ValidationError } from "../../../core/errors";
import { MAX_IMPORT_CELL_ISSUES } from "../types";
import { isoCellToCalendarDate, isSameStoredNumber, numberCellText, serialToCalendarDate } from "./cells";
import { mergedCellIssues, toMergedRange, type NumberedRow, type SheetCellIssue, type ZeroBasedRange } from "./merges";
import { numberDisplay } from "./numberFormat";
import { readStrictSheet, type StrictCell, type StrictSheet } from "./strictSheet";
import { resolveWorkbookParts } from "./workbookParts";
import { assertWellFormedParts, decodePart, refuse } from "./xmlParts";
import { precheckZip, rebuildZip } from "./zipPrecheck";

export interface XlsxReadOptions {
  sheet?: string;
  maxRows: number;
  maxColumns: number;
  /** Total characters of resolved cell text, so repeated shared strings cannot fan out (review r1 P1). */
  maxTextChars: number;
}

/**
 * A refusal while reading the chosen sheet (not the workbook): it carries the
 * sheet list so the client can still offer the picker (review r1 P2).
 */
export class XlsxSheetError extends ValidationError {
  constructor(message: string, readonly sheets: string[], readonly sheet: string, readonly hiddenSheets: string[] = []) {
    super(message);
  }

  toJSON() {
    const json = super.toJSON();
    return { ...json, error: { ...json.error, details: { sheets: this.sheets, sheet: this.sheet, hiddenSheets: this.hiddenSheets } } };
  }
}

export interface XlsxSheetTable {
  sheets: string[];
  /** Sheets Excel hides (state hidden or veryHidden), labelled in the picker. */
  hiddenSheets: string[];
  sheet: string;
  /** Non-empty rows in sheet order; each is cell text by column index. */
  rows: string[][];
  /** Formula cells read by their saved value. */
  formulaCells: number;
  /** Cells that cannot be imported as Excel shows them; the cell text keeps the stored value (review r4). */
  issues: SheetCellIssue[];
  /** Number cells Excel shows with leading zeros: the Reference reads this text, every other field the stored value (review r6). */
  referenceDisplays: SheetReferenceDisplay[];
}

/** A row-indexed (sheet row 0 is the header) leading-zero display. */
export interface SheetReferenceDisplay {
  row: number;
  column: number;
  text: string;
}

/** A cell's text and, when Excel would not show that text, why. */
interface CellRead {
  text: string;
  issue?: string;
  /** The issue only matters when the column is mapped as this field. */
  field?: "reference";
  /** The Reference display, when Excel shows the stored number with leading zeros. */
  display?: string;
}

/** The part of a SheetJS cell this reader uses. */
interface SheetJsCell {
  t: string;
  v?: unknown;
  w?: string;
  z?: string;
}

/**
 * SheetJS read options, set explicitly. Only cached values are read: SheetJS
 * has no formula engine, and formula text is not even kept. Macro packages
 * are refused before this point and VBA is never extracted. No option makes
 * SheetJS fetch anything: it does not follow external links or data
 * connections when reading.
 */
const SHEETJS_OPTIONS: XLSX.ParsingOptions = {
  type: "buffer",
  cellFormula: false,
  cellHTML: false,
  cellNF: true, // the format code (z): dates, and the reference display check
  cellText: true, // the rendered text (w)
  cellDates: false, // raw serials; cells.ts converts them by integer arithmetic
  cellStyles: false,
  sheetStubs: true, // every <c>, so the address sets of both passes can be matched
  bookVBA: false,
  bookDeps: false,
  bookFiles: false,
  bookProps: false,
  nodim: true,
  WTF: false,
};

const isDateFormat = (XLSX.SSF as { is_date(format: string): boolean }).is_date;
const TOO_MANY_ISSUES = `more than ${MAX_IMPORT_CELL_ISSUES} cells hold Excel errors, unreadable dates or merged cells`;
const INCONSISTENT = "its cells could not be read consistently; open the file in Excel and save it again";

function readWithSheetJs(buffer: Buffer, extra: XLSX.ParsingOptions): XLSX.WorkBook {
  try {
    return XLSX.read(buffer, { ...SHEETJS_OPTIONS, ...extra });
  } catch (error) {
    // Everything SheetJS reads has passed the strict checks; any failure left is still the file's, so a 400.
    return refuse(`it could not be read (${String(error instanceof Error ? error.message : error).slice(0, 80)})`);
  }
}

function sheetJsCell(value: unknown): SheetJsCell | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const t: unknown = Reflect.get(value, "t");
  if (typeof t !== "string") return undefined;
  const w: unknown = Reflect.get(value, "w");
  const z: unknown = Reflect.get(value, "z");
  return { t, v: Reflect.get(value, "v"), w: typeof w === "string" ? w : undefined, z: typeof z === "string" ? z : undefined };
}

function numberText(cell: StrictCell, read: SheetJsCell, date1904: boolean): CellRead {
  const plain = numberCellText(cell.raw) ?? refuse(`cell ${cell.address} holds a number that cannot be read exactly`);
  if (read.t !== "n" || !isSameStoredNumber(plain, read.v)) refuse(INCONSISTENT);
  if (read.z !== undefined && isDateFormat(read.z)) {
    const day = serialToCalendarDate(plain, date1904);
    // An invalid serial is never read back as a plain number (review r4 P2).
    return day ? { text: day } : { text: plain, issue: `a date Excel cannot show (serial ${plain.slice(0, 40)})` };
  }
  const display = numberDisplay(plain, read.z, read.w);
  // The row keeps the stored decimal, so Amount is validated exactly as CSV (review r6 P1); only the Reference
  // reads a leading-zero display, and any other display is never a silently different reference (review r5 P1).
  if (display.kind === "stored") return { text: plain };
  if (display.kind === "padded") return { text: plain, display: display.text };
  return { text: plain, field: "reference",
    issue: `a number shown as "${(read.w ?? "").slice(0, 40)}" by the format "${(read.z ?? "").slice(0, 40)}", not as its stored value` };
}

function cellText(cell: StrictCell, value: unknown, date1904: boolean): CellRead {
  const read = sheetJsCell(value) ?? refuse(INCONSISTENT);
  switch (cell.type) {
    case "s":
    case "inlineStr":
    case "str":
      if (read.t === "z" && cell.raw === "") return { text: "" };
      if (read.t !== "s" || typeof read.v !== "string") return refuse(`cell ${cell.address} points at a missing shared string`);
      return { text: read.v };
    case "b":
      if (read.t !== "b") refuse(INCONSISTENT);
      return { text: read.v === true ? "TRUE" : "FALSE" };
    case "d": {
      // The raw text, not SheetJS's value: SheetJS rolls 2026-02-30 over to 2 March.
      const day = isoCellToCalendarDate(cell.raw);
      return day ? { text: day } : { text: cell.raw, issue: `a date that cannot be read (${cell.raw.trim().slice(0, 40)})` };
    }
    case "e":
      // Kept typed: a mapped Excel error is a row error whatever its text (review r4 P2).
      return { text: cell.raw, issue: `the Excel error ${cell.raw.trim().slice(0, 40) || "(unknown)"}` };
    default:
      return cell.raw ? numberText(cell, read, date1904) : { text: "" };
  }
}

/** SheetJS read exactly the cells the strict pass read: no cell added, dropped or moved. */
function assertSameCells(strict: StrictSheet, sheet: XLSX.WorkSheet): void {
  const keys = Object.keys(sheet).filter(key => !key.startsWith("!"));
  const allPresent = strict.rows.every(row => row.cells.every(cell => Object.hasOwn(sheet, cell.address)));
  if (keys.length !== strict.cellCount || !allPresent) refuse(INCONSISTENT);
}

function mergeRanges(sheet: XLSX.WorkSheet, strict: StrictSheet) {
  const raw: unknown = sheet["!merges"];
  const ranges: ZeroBasedRange[] = Array.isArray(raw) ? raw : [];
  if (ranges.length !== strict.mergedRanges) refuse(INCONSISTENT);
  return ranges.map(range => toMergedRange(range, XLSX.utils.encode_range(range)));
}

function joinSheet(strict: StrictSheet, sheet: XLSX.WorkSheet, date1904: boolean, options: XlsxReadOptions):
  Pick<XlsxSheetTable, "rows" | "formulaCells" | "issues" | "referenceDisplays"> {
  assertSameCells(strict, sheet);
  const rows: NumberedRow[] = [];
  const issues: SheetCellIssue[] = [];
  const referenceDisplays: SheetReferenceDisplay[] = [];
  let textChars = 0;
  for (const row of strict.rows) {
    const cells: string[] = [];
    const rowIssues: Array<{ column: number; issue: string; field?: "reference" }> = [];
    const rowDisplays: Array<{ column: number; text: string }> = [];
    for (const cell of row.cells) {
      const read = cellText(cell, sheet[cell.address], date1904);
      // Charge the untrimmed length before anything else touches the text.
      textChars += read.text.length + (read.display?.length ?? 0);
      if (textChars > options.maxTextChars) refuse(`it holds more than ${options.maxTextChars} characters of cell text`);
      const text = read.text.trim();
      if (text) cells[cell.column] = text;
      if (read.issue !== undefined) rowIssues.push({ column: cell.column, issue: read.issue, field: read.field });
      if (read.display !== undefined) rowDisplays.push({ column: cell.column, text: read.display });
    }
    if (cells.length === 0 && rowIssues.length === 0) continue;
    for (const rowDisplay of rowDisplays) referenceDisplays.push({ row: rows.length, ...rowDisplay });
    if (issues.length + rowIssues.length > MAX_IMPORT_CELL_ISSUES) refuse(TOO_MANY_ISSUES);
    for (const rowIssue of rowIssues) issues.push({ row: rows.length, ...rowIssue });
    rows.push({ rowNumber: row.rowNumber, cells: Array.from(cells, value => value ?? "") });
  }
  // A merge is dropped only under a cell issue that refuses under every mapping (review r5 P1). A Reference-only
  // issue never hides it: mapped as Amount, the hidden value must still be refused (review r6 P1).
  const own = new Set(issues.filter(issue => issue.field === undefined).map(issue => `${issue.row}:${issue.column}`));
  const maxVisits = (options.maxRows + 1) * options.maxColumns;
  const merged = mergedCellIssues(mergeRanges(sheet, strict), rows, { maxVisits, maxIssues: MAX_IMPORT_CELL_ISSUES })
    .filter(issue => !own.has(`${issue.row}:${issue.column}`));
  if (issues.length + merged.length > MAX_IMPORT_CELL_ISSUES) refuse(TOO_MANY_ISSUES);
  return { rows: rows.map(row => row.cells), formulaCells: strict.formulaCells, issues: [...issues, ...merged], referenceDisplays };
}

export function readXlsxSheet(buffer: Buffer, options: XlsxReadOptions): XlsxSheetTable {
  const parts = precheckZip(buffer);
  assertWellFormedParts(parts);
  const sheetParts = resolveWorkbookParts(parts);
  const verified = rebuildZip(parts);
  const book = readWithSheetJs(verified, { bookSheets: true });
  const names = book.SheetNames;
  if (names.length !== sheetParts.length) refuse("its sheet list could not be read consistently");
  const isHidden = (index: number) => sheetParts[index].hidden;
  const hiddenSheets = names.filter((_, index) => isHidden(index));
  // Default to the first sheet a user can see in Excel (review r2 P2).
  const firstVisible = Math.max(0, names.findIndex((_, index) => !isHidden(index)));
  const chosen = options.sheet === undefined ? firstVisible : names.indexOf(options.sheet);
  const sheetName = names[chosen] ?? options.sheet ?? "";
  try {
    if (chosen < 0) return refuse(`it has no sheet named "${options.sheet}"`);
    const part = sheetParts[chosen].part ?? refuse(`the sheet "${sheetName}" is not a worksheet`);
    const bytes = parts.get(part) ?? refuse(`the sheet "${sheetName}" is not a worksheet`);
    const strict = readStrictSheet(decodePart(part, bytes), options);
    const full = readWithSheetJs(verified, { sheets: chosen });
    // SheetJS drops a sheet it fails to parse (WTF off), so a missing one is refused, never read as empty.
    // An own property only: a sheet named __proto__ must never read the prototype (review r6 P2).
    const sheet = Object.hasOwn(full.Sheets, sheetName) ? full.Sheets[sheetName] : refuse(INCONSISTENT);
    const date1904 = full.Workbook?.WBProps?.date1904 === true;
    return { sheets: names, hiddenSheets, sheet: sheetName, ...joinSheet(strict, sheet, date1904, options) };
  } catch (error) {
    if (error instanceof ValidationError) throw new XlsxSheetError(error.message, names, sheetName, hiddenSheets);
    throw error;
  }
}
