/**
 * IMP-01 strict worksheet pass (owner decision N2). It runs on fast-xml-parser
 * BEFORE SheetJS reads the sheet, and refuses what SheetJS would silently
 * accept: a malformed, misplaced or duplicate cell address, rows out of
 * order, and a formula with no saved value. Position is inferred only when
 * the address is absent (review r5 P1).
 *
 * It keeps each cell's raw type and stored value. Numbers therefore stay the
 * exact stored decimal (never a float), and a typed date (t="d") can be
 * validated as written, where SheetJS would roll 2026-02-30 over to March.
 * Rows, cells and merged ranges are counted on the raw text before parsing,
 * so a padded part cannot build an unbounded tree.
 */
import { MAX_MERGED_RANGES } from "./merges";
import { asNode, attributeOf, countAllStartTags, countStartTags, listOf, parseText, refuse, textOf, type XmlNode } from "./xmlParts";

export interface StrictSheetLimits {
  maxRows: number;
  maxColumns: number;
}

export interface StrictCell {
  address: string;
  column: number;
  /** The t attribute, "n" when absent. */
  type: string;
  /** The stored <v> text, "" when the cell has none. */
  raw: string;
}

export interface StrictRow {
  rowNumber: number;
  cells: StrictCell[];
}

export interface StrictSheet {
  rows: StrictRow[];
  cellCount: number;
  formulaCells: number;
  mergedRanges: number;
}

const CELL_REFERENCE = /^([A-Z]{1,3})([1-9]\d{0,6})$/;
const ROW_NUMBER = /^[1-9]\d{0,6}$/;
const CELL_TYPES = new Set(["n", "s", "str", "inlineStr", "b", "e", "d"]);
/** Elements per cell a real sheet writes (c, v, f, is), plus slack for the rest of the part. */
const ELEMENTS_PER_CELL = 4;
const OTHER_ELEMENTS = 10000;

function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

export function columnLetters(index: number): string {
  let letters = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }
  return letters;
}

function countBudget(text: string, limits: StrictSheetLimits): void {
  const maxCells = (limits.maxRows + 1) * limits.maxColumns;
  // Every <row> and <c> counts, empty or not, so padding cannot run unmetered (review r2 P1).
  if (countStartTags(text, "row") > limits.maxRows + 1) refuse(`it has more than ${limits.maxRows} rows (empty formatted rows count)`);
  if (countStartTags(text, "c") > maxCells) refuse(`it has more than ${maxCells} cells`);
  if (countStartTags(text, "mergeCell") > MAX_MERGED_RANGES) refuse(`it has more than ${MAX_MERGED_RANGES} merged ranges`);
  if (countAllStartTags(text) > maxCells * ELEMENTS_PER_CELL + OTHER_ELEMENTS) refuse("its sheet holds too many elements");
}

function rowNumberOf(row: XmlNode, lastRowNumber: number): number {
  const declared = attributeOf(row, "r");
  if (declared === undefined) return lastRowNumber + 1;
  return ROW_NUMBER.test(declared) ? parseInt(declared, 10) : refuse(`a row number "${declared.slice(0, 16)}" is not valid`);
}

/** A present address must be valid and in its row, and two cells may not share one. */
function columnOf(declared: string | undefined, rowNumber: number, nextColumn: number, taken: Set<number>): number {
  let column = nextColumn;
  if (declared !== undefined) {
    const match = CELL_REFERENCE.exec(declared) ?? refuse(`a cell address "${declared.slice(0, 16)}" is not valid`);
    if (parseInt(match[2], 10) !== rowNumber) refuse(`cell ${declared} is not in row ${rowNumber}`);
    column = columnIndex(match[1]);
  }
  if (taken.has(column)) refuse(`two cells share the address ${declared ?? `${columnLetters(column)}${rowNumber}`}`);
  taken.add(column);
  return column;
}

function readCell(cell: XmlNode, rowNumber: number, column: number): StrictCell & { hasFormula: boolean } {
  const address = `${columnLetters(column)}${rowNumber}`;
  const type = attributeOf(cell, "t") ?? "n";
  if (!CELL_TYPES.has(type)) refuse(`cell ${address} has an unknown type "${type.slice(0, 16)}"`);
  const saved = textOf(cell.v);
  const hasFormula = cell.f !== undefined;
  // A missing or empty cached value means never calculated, unless it is an explicitly empty text result (review r3 P2).
  if (hasFormula && (saved === undefined || (type !== "str" && !saved.trim()))) {
    refuse(`the formula in ${address} has no saved value; open the file in Excel and save it again`);
  }
  return { address, column, type, raw: saved ?? "", hasFormula };
}

export function readStrictSheet(text: string, limits: StrictSheetLimits): StrictSheet {
  countBudget(text, limits);
  const worksheet = parseText(text).worksheet;
  if (worksheet === undefined) refuse("the chosen sheet is not a worksheet");
  const root = asNode(worksheet);
  const rows: StrictRow[] = [];
  let lastRowNumber = 0;
  let cellCount = 0;
  let formulaCells = 0;
  for (const row of listOf(asNode(root.sheetData).row)) {
    const rowNumber = rowNumberOf(row, lastRowNumber);
    if (rowNumber <= lastRowNumber) refuse("its rows are out of order");
    lastRowNumber = rowNumber;
    const taken = new Set<number>();
    const cells: StrictCell[] = [];
    let nextColumn = 0;
    for (const cell of listOf(row.c)) {
      const column = columnOf(attributeOf(cell, "r"), rowNumber, nextColumn, taken);
      nextColumn = column + 1;
      if (column >= limits.maxColumns) refuse(`it uses more than ${limits.maxColumns} columns`);
      const { hasFormula, ...read } = readCell(cell, rowNumber, column);
      if (hasFormula) formulaCells += 1;
      cells.push(read);
    }
    cellCount += cells.length;
    rows.push({ rowNumber, cells });
  }
  return { rows, cellCount, formulaCells, mergedRanges: listOf(asNode(root.mergeCells).mergeCell).length };
}
