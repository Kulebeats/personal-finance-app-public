// Relative, so the server real-DB round-trip test (R2-03) can load this production parser.
import { isParsableMoneyString } from "../../lib/money";
import { normalizeImportDate, type ImportDateFormat } from "@shared/import-date";
import { restoreCsvFormulaText } from "@shared/csv-formula";
import type { TransactionImportRow } from "@/lib/api";

const BYTE_ORDER_MARK = "﻿";
const MIN_COLUMNS = 7;

/**
 * A-43: RFC 4180 records, the grammar server/core/csv.ts writes. A quoted cell may hold commas,
 * doubled quotes ("") and line breaks, so records are split by the quote-aware scan, never by lines.
 */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  const source = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inQuotes) {
      if (char !== '"') field += char;
      else if (source[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = false;
    } else if (char === '"' && field.trim() === "") { field = ""; inQuotes = true; }
    else if (char === ",") { record = [...record, field]; field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      records.push([...record, field]);
      record = []; field = "";
    } else field += char;
  }
  if (inQuotes) throw new Error(`Row ${records.length + 1}: a quoted cell is never closed`);
  if (record.length > 0 || field !== "") records.push([...record, field]);
  return records;
}

const isBlankRecord = (fields: string[]) => fields.every(field => field.trim() === "");

/** Account-export CSV layout; calendar parsing is shared with the global wizard. */
export function parseTransactionCsv(text: string, dateFormat: ImportDateFormat): TransactionImportRow[] {
  const records = parseCsvRecords(text);
  const dataRows = records.slice(1).map((fields, index) => ({ fields, rowNumber: index + 2 }))
    .filter(({ fields }) => !isBlankRecord(fields));
  if (records.length < 2 || dataRows.length === 0) {
    throw new Error("CSV file must contain a header row and at least one data row");
  }
  return dataRows.map(({ fields: rawFields, rowNumber }) => {
    if (rawFields.length < MIN_COLUMNS) {
      throw new Error(`Row ${rowNumber}: Expected at least ${MIN_COLUMNS} columns, got ${rawFields.length}`);
    }
    // R2-03: text cells keep their edge spaces and lose only the exporter's formula apostrophe.
    const [rawDate, merchant, category, , originalStatement, notes, rawAmount, tags] = rawFields.map(restoreCsvFormulaText);
    const date = rawDate.trim();
    const amount = rawAmount.trim();
    if (!date || !merchant.trim() || !amount) throw new Error(`Row ${rowNumber}: Date, Merchant, and Amount are required`);
    const normalized = normalizeImportDate(date, dateFormat);
    if (normalized.dateString === undefined) throw new Error(`Row ${rowNumber}, date "${date}": ${normalized.error}`);
    const normalizedAmount = amount.replace(/,/g, "").trim();
    if (!isParsableMoneyString(normalizedAmount)) throw new Error(`Row ${rowNumber}: Invalid amount "${amount}"`);
    return { date: normalized.dateString, merchant, category: category || undefined,
      originalStatement: originalStatement || undefined, notes: notes || undefined,
      amount: normalizedAmount, tags: tags || undefined };
  });
}
