/**
 * IMP-01 review r4 P1: merged cells. Excel stores a merged range's value only
 * in its top-left (anchor) cell and shows it across the whole range, so the
 * second row of a vertically merged "USD" currency cell reads as empty and
 * would pass the account-currency check at face value. Every non-anchor cell
 * of a merge that reaches a data row is reported as a cell issue, beside the
 * rows (the cell text is unchanged): a mapped one is refused as a row error,
 * an unmapped one is ignored. Merges in or above the header row are layout
 * and are left alone.
 *
 * The ranges come from SheetJS (`!merges`); the strict pass has already
 * capped their number on the raw sheet text and checked SheetJS read them all.
 */
import { ValidationError } from "../../../core/errors";

export const MAX_MERGED_RANGES = 10000;

export interface MergedRange {
  ref: string;
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
}

/** A SheetJS range (0-based rows and columns) as a merged range. */
export interface ZeroBasedRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

/** A sheet row as read: its 1-based row number and cell text by column. */
export interface NumberedRow {
  rowNumber: number;
  cells: string[];
}

/** An issue at one cell: index into the rows read (0 is the header row) and column index. */
export interface SheetCellIssue {
  row: number;
  column: number;
  issue: string;
  /** Only refuses the row when the column is mapped as this field. */
  field?: "reference";
}

/** Work caps: rows plus cells visited, and issues reported. */
export interface MergeBudget {
  maxVisits: number;
  maxIssues: number;
}

const refuse = (reason: string): never => {
  throw new ValidationError(`This Excel file cannot be imported: ${reason}`);
};

export function toMergedRange(range: ZeroBasedRange, ref: string): MergedRange {
  return { ref, firstRow: Math.min(range.s.r, range.e.r) + 1, lastRow: Math.max(range.s.r, range.e.r) + 1,
    firstColumn: Math.min(range.s.c, range.e.c), lastColumn: Math.max(range.s.c, range.e.c) };
}

/** Index of the first row whose number is at least `rowNumber` (rows ascend). */
function firstRowAtOrAfter(rows: NumberedRow[], rowNumber: number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (rows[middle].rowNumber < rowNumber) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Issues for every non-anchor merged cell in a data row (after the first,
 * header, row) within the columns read. A range with no read column is
 * skipped before its rows are visited, and every row and cell visited counts
 * against the budget (review r4 P1).
 */
export function mergedCellIssues(ranges: MergedRange[], rows: NumberedRow[], budget: MergeBudget): SheetCellIssue[] {
  if (rows.length < 2) return [];
  const headerRow = rows[0].rowNumber;
  const width = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  const issues: SheetCellIssue[] = [];
  const marked = new Set<number>();
  let visits = 0;
  const visit = () => {
    visits += 1;
    if (visits > budget.maxVisits) refuse(`its merged ranges cover more than ${budget.maxVisits} cells`);
  };
  for (const range of ranges) {
    const lastColumn = Math.min(range.lastColumn, width - 1);
    if (range.lastRow <= headerRow || range.firstColumn > lastColumn) continue;
    if (range.firstRow === range.lastRow && range.firstColumn === range.lastColumn) continue;
    for (let index = firstRowAtOrAfter(rows, Math.max(range.firstRow, headerRow + 1));
      index < rows.length && rows[index].rowNumber <= range.lastRow; index++) {
      visit();
      for (let column = range.firstColumn; column <= lastColumn; column++) {
        visit();
        if (rows[index].rowNumber === range.firstRow && column === range.firstColumn) continue;
        // Overlapping ranges report a cell once (review r5 P1).
        const key = index * width + column;
        if (marked.has(key)) continue;
        marked.add(key);
        if (issues.length >= budget.maxIssues) refuse(`more than ${budget.maxIssues} cells hold Excel errors, unreadable dates or merged cells`);
        issues.push({ row: index, column, issue: `part of the merged cells ${range.ref}` });
      }
    }
  }
  return issues;
}
