/**
 * IMP-01 review r4/r5: Excel cell issues carried beside the rows. A mapped
 * issue refuses its row; an unmapped one is ignored. Every column the request
 * names (in the mapping or in an issue) must be a header the rows have, so a
 * stale mapping can never read a missing header as a blank cell.
 */
import { ValidationError } from "../../core/errors";
import type { ImportCellIssue, ImportMapping, ImportReferenceDisplay } from "./types";
import { isZeroPaddedDisplay } from "./xlsx/numberFormat";

/** Issues by row ordinal, then column header. */
export type CellIssueIndex = Map<number, Map<string, ImportCellIssue>>;

/** Each mapped header once, in mapping order; "" is a skipped field. */
export function mappedColumns(mapping: ImportMapping): string[] {
  return Array.from(new Set(Object.values(mapping).filter((column): column is string => !!column)));
}

/** Refuses a mapped column, or an issue row or column, that the rows do not have (review r5). */
export function assertKnownColumns(rows: Record<string, string>[], mapping: ImportMapping, issues: readonly ImportCellIssue[]): void {
  if (rows.length === 0) return;
  const headers = new Set(Object.keys(rows[0]));
  const missing = mappedColumns(mapping).find(column => !headers.has(column));
  if (missing !== undefined) {
    throw new ValidationError(`The column "${missing.slice(0, 80)}" is mapped but this file has no such column; map the columns again`);
  }
  if (issues.some(issue => issue.row > rows.length || !headers.has(issue.column))) {
    throw new ValidationError("The cell checks name a row or column this file does not have; upload the file again");
  }
}

/**
 * The issues that can refuse a row under this mapping: in a mapped column
 * (and, for a field-scoped issue, mapped as that field), one per cell, in row
 * then column order. An issue that refuses under every mapping (a merged
 * cell, an Excel error) wins over a field-scoped one on the same cell, so a
 * Reference-only warning can never hide it (review r6 P1). This is what the
 * batch fingerprint covers.
 */
export function applicableIssues(issues: readonly ImportCellIssue[], mapping: ImportMapping): ImportCellIssue[] {
  const mapped = new Set(mappedColumns(mapping));
  const seen = new Set<string>();
  const unconditionalFirst = [...issues.filter(issue => issue.field === undefined), ...issues.filter(issue => issue.field !== undefined)];
  const applicable = unconditionalFirst.filter(issue => {
    const key = `${issue.row}\u0000${issue.column}`;
    if (!mapped.has(issue.column) || seen.has(key)) return false;
    if (issue.field !== undefined && mapping[issue.field] !== issue.column) return false;
    seen.add(key);
    return true;
  });
  return applicable.sort((a, b) => a.row - b.row || (a.column < b.column ? -1 : a.column > b.column ? 1 : 0));
}

/**
 * The leading-zero displays the Reference reads (review r6 P1). Each must be
 * in the column mapped as Reference, once per row, and be that row's stored
 * value with leading zeros added; anything else refuses the request, as the
 * rows and displays no longer come from one parse of one file.
 */
export function referenceDisplayIndex(rows: Record<string, string>[], mapping: ImportMapping,
  displays: readonly ImportReferenceDisplay[]): Map<number, string> {
  const byRow = new Map<number, string>();
  const stale = () => new ValidationError("The Reference cells do not match this file's rows; upload the file again");
  for (const display of displays) {
    const row = rows[display.row - 1];
    const stored = row && Object.hasOwn(row, display.column) ? row[display.column] : undefined;
    if (display.column !== mapping.reference || typeof stored !== "string" || byRow.has(display.row)) throw stale();
    if (!isZeroPaddedDisplay(stored.trim(), display.text)) throw stale();
    byRow.set(display.row, display.text);
  }
  return byRow;
}

/** One inner map per row, built once and added to (review r5 P1). */
export function indexIssues(issues: readonly ImportCellIssue[]): CellIssueIndex {
  const index: CellIssueIndex = new Map();
  for (const issue of issues) {
    let byColumn = index.get(issue.row);
    if (!byColumn) {
      byColumn = new Map();
      index.set(issue.row, byColumn);
    }
    if (!byColumn.has(issue.column)) byColumn.set(issue.column, issue);
  }
  return index;
}
