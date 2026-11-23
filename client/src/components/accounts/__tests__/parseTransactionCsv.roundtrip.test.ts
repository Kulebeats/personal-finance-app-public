/**
 * A-43: the Account Detail exporter writes RFC 4180 through server/core/csv.ts (doubled quotes,
 * multi-line cells in quotes). These cases build the export with the production writer and read it
 * back with the production client parser, so the two sides cannot drift into different grammars.
 */
import { describe, expect, it } from "vitest";
import { CsvDecimal, sanitizeCsvRow } from "../../../../../server/core/csv";
import { parseCsvRecords, parseTransactionCsv } from "../parseTransactionCsv";

const EXPORT_HEADER = "Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags";

function exportLine(cells: { date: string; name: string; category?: string; original?: string;
  notes?: string; amount: string; tags?: string }): string {
  return sanitizeCsvRow([cells.date, cells.name, cells.category ?? "", "Synthetic Cheque",
    cells.original ?? "", cells.notes ?? "", new CsvDecimal(cells.amount), cells.tags ?? ""]);
}

describe("parseTransactionCsv reads what the account exporter writes", () => {
  it("round-trips a quoted merchant, a multi-line note and comma tags", () => {
    const csv = [EXPORT_HEADER,
      exportLine({ date: "2026-03-04", name: 'Shop "Corner" Ltd', category: "Groceries",
        original: "POS 1234, LUSAKA", notes: "first line\nsecond line", amount: "-58.12",
        tags: "food, weekly" }),
      exportLine({ date: "2026-03-05", name: "Salary", amount: "1200.00" }),
    ].join("\n");

    const rows = parseTransactionCsv(csv, "auto");

    expect(rows).toEqual([
      { date: "2026-03-04", merchant: 'Shop "Corner" Ltd', category: "Groceries",
        originalStatement: "POS 1234, LUSAKA", notes: "first line\nsecond line", amount: "-58.12",
        tags: "food, weekly" },
      { date: "2026-03-05", merchant: "Salary", category: undefined, originalStatement: undefined,
        notes: undefined, amount: "1200.00", tags: undefined },
    ]);
  });

  it("accepts CRLF line endings, a byte-order mark and a trailing line break", () => {
    const csv = `﻿${EXPORT_HEADER}\r\n${exportLine({ date: "2026-03-04", name: "Cafe",
      notes: "a\r\nb", amount: "-4.50" })}\r\n`;

    expect(parseTransactionCsv(csv, "auto")).toEqual([
      expect.objectContaining({ merchant: "Cafe", notes: "a\r\nb", amount: "-4.50" }),
    ]);
  });

  it("removes the export's formula apostrophe and keeps edge spaces in text (R2-03)", () => {
    const text = { name: "-Refund", category: "@Groceries", original: " =SUM(A1)", notes: "  indented note\n", tags: "+later, food" };
    const csv = [EXPORT_HEADER, exportLine({ date: " 2026-03-04 ", amount: "-4.50", ...text })].join("\n");
    expect(csv).toContain("'-Refund");

    const [row] = parseTransactionCsv(csv, "auto");

    expect(row).toEqual({ date: "2026-03-04", merchant: text.name, category: text.category,
      originalStatement: text.original, notes: text.notes, amount: "-4.50", tags: text.tags });
    // Text that merely starts with an apostrophe, which the exporter never added, is kept.
    const [plain] = parseTransactionCsv(`${EXPORT_HEADER}\n2026-03-05,'quoted' shop,,,,,-1.00,`, "auto");
    expect(plain.merchant).toBe("'quoted' shop");
  });

  it("refuses a quoted cell that is never closed instead of guessing", () => {
    expect(() => parseCsvRecords(`${EXPORT_HEADER}\n2026-03-04,"Cafe,,,,-4.50,`)).toThrow(/never closed/);
  });
});
