/**
 * Characterization tests for the CSV import dedupe keys.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS: `buildImportIdempotencyKey` produces a
 * deterministic UUID that is written to `transactions.idempotencyKey`, which is
 * UNIQUE at schema level and is what stops a re-run of the same CSV creating
 * duplicate ledger rows. If a refactor perturbs this derivation by a single
 * character, every previously-imported row stops matching and re-imports as a
 * duplicate — silent financial corruption that no type checker would catch.
 *
 * So these tests pin GOLDEN VALUES, not just shape. They were written against
 * the pre-split implementation and must pass byte-identically afterwards.
 */
import { describe, it, expect } from "vitest";
import { Money } from "../../core/money";
import { buildImportIdempotencyKey, importRowKey } from "../import/dedupe";
import type { ImportOptions, ParsedImportRow } from "../import/types";

const row = (over: Partial<ParsedImportRow> = {}): ParsedImportRow => ({
  rowIndex: 1,
  date: new Date("2026-03-14T00:00:00Z"),
  dateString: "2026-03-14",
  signedAmount: new Money("-42.50"),
  amount: new Money("42.50"),
  type: "expense",
  merchantName: "Shoprite",
  categoryName: "Groceries",
  notes: "weekly shop",
  raw: {},
  ...over,
});

const options = (over: Partial<ImportOptions> = {}): ImportOptions => ({
  userId: "11111111-1111-4111-8111-111111111111",
  householdId: "22222222-2222-4222-8222-222222222222",
  strategy: "prioritize_csv",
  mapping: { date: "Date", amount: "Amount" },
  categoryMapping: {},
  ...over,
});

const ACCOUNT = "33333333-3333-4333-8333-333333333333";

describe("importRowKey", () => {
  it("is composed of date, type and absolute amount", () => {
    expect(importRowKey(row())).toBe("2026-03-14_expense_42.50");
  });

  it("distinguishes income from expense at the same amount", () => {
    expect(importRowKey(row({ type: "income" }))).toBe(
      "2026-03-14_income_42.50",
    );
  });

  it("ignores merchant and notes (dedupe is date/type/amount only)", () => {
    expect(importRowKey(row({ merchantName: "Other", notes: "different" }))).toBe(
      importRowKey(row()),
    );
  });
});

describe("buildImportIdempotencyKey", () => {
  it("produces a stable golden value for fixed inputs", () => {
    // GOLDEN: changing this string means previously-imported rows will
    // re-import as duplicates. Do not update it to make a test pass.
    // Derived from the PRE-SPLIT ImportService implementation, so a mismatch
    // here means the extraction altered the derivation.
    expect(buildImportIdempotencyKey(options(), ACCOUNT, row())).toBe(
      "cb5057b2-cf29-4e86-9ebb-788322bb6153",
    );
  });

  it("is deterministic across calls", () => {
    const a = buildImportIdempotencyKey(options(), ACCOUNT, row());
    const b = buildImportIdempotencyKey(options(), ACCOUNT, row());
    expect(a).toBe(b);
  });

  it("is shaped as a v4 UUID so it satisfies the uuid column", () => {
    const key = buildImportIdempotencyKey(options(), ACCOUNT, row());
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it.each([
    ["household", { householdId: "44444444-4444-4444-8444-444444444444" }],
  ])("varies with %s", (_label, over) => {
    expect(buildImportIdempotencyKey(options(over), ACCOUNT, row())).not.toBe(
      buildImportIdempotencyKey(options(), ACCOUNT, row()),
    );
  });

  it("varies with the target account", () => {
    expect(
      buildImportIdempotencyKey(
        options(),
        "55555555-5555-4555-8555-555555555555",
        row(),
      ),
    ).not.toBe(buildImportIdempotencyKey(options(), ACCOUNT, row()));
  });

  it.each([
    ["date", { dateString: "2026-03-15" }],
    ["type", { type: "income" as const }],
    ["amount", { amount: new Money("42.51") }],
    ["merchant", { merchantName: "Pick n Pay" }],
    ["category", { categoryName: "Dining" }],
    ["notes", { notes: "different" }],
  ])("varies with row %s", (_label, over) => {
    expect(buildImportIdempotencyKey(options(), ACCOUNT, row(over))).not.toBe(
      buildImportIdempotencyKey(options(), ACCOUNT, row()),
    );
  });

  it("treats absent category and notes as empty, not as the string undefined", () => {
    const withUndefined = buildImportIdempotencyKey(
      options(),
      ACCOUNT,
      row({ categoryName: undefined, notes: undefined }),
    );
    const withEmpty = buildImportIdempotencyKey(
      options(),
      ACCOUNT,
      row({ categoryName: "", notes: "" }),
    );
    expect(withUndefined).toBe(withEmpty);
  });

  it("does not depend on the importing user (household-scoped, not user-scoped)", () => {
    expect(
      buildImportIdempotencyKey(
        options({ userId: "66666666-6666-4666-8666-666666666666" }),
        ACCOUNT,
        row(),
      ),
    ).toBe(buildImportIdempotencyKey(options(), ACCOUNT, row()));
  });
});
