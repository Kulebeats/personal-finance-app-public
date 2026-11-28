/**
 * A SheetJS failure on a file that passed the strict checks is still a 400,
 * but the client gets a plain message: the parser's own text (which can name
 * internal parts, offsets or library detail) goes only to the server logger,
 * which keeps what its R19 redaction allows (the error's name and frames).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "../../../core/errors";

const state = vi.hoisted(() => ({ failRead: false, warn: vi.fn() }));
const PARSER_DETAIL = "SYNTHETIC_PARSER_DETAIL at xl/worksheets/sheet1.xml offset 4096";

vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return {
    ...actual,
    read: (...args: Parameters<typeof actual.read>) => {
      if (state.failRead) throw new Error(PARSER_DETAIL);
      return actual.read(...args);
    },
  };
});
vi.mock("../../../utils/logger", () => ({ logger: { warn: state.warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const { readXlsxSheet } = await import("../xlsx/workbook");
const { buildXlsxTemplate } = await import("../template");
const OPTIONS = { maxRows: 100, maxColumns: 20, maxTextChars: 100_000 };

describe("readXlsxSheet when SheetJS itself fails", () => {
  beforeEach(() => { state.failRead = false; state.warn.mockReset(); });

  it("reads the template normally (the fixture passes every strict check)", () => {
    expect(readXlsxSheet(buildXlsxTemplate(), OPTIONS).sheet).toBe("Transactions");
  });

  it("refuses with a plain 400 message that carries none of the parser's text", () => {
    state.failRead = true;
    let thrown: unknown;
    try { readXlsxSheet(buildXlsxTemplate(), OPTIONS); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(ValidationError);
    const refusal = thrown as ValidationError;
    expect(refusal.statusCode).toBe(400);
    expect(refusal.message).toMatch(/^This Excel file cannot be imported: /);
    expect(JSON.stringify(refusal.toJSON())).not.toContain("SYNTHETIC_PARSER_DETAIL");
    expect(refusal.message).not.toContain("offset");
  });

  it("logs the parser's detail on the server", () => {
    state.failRead = true;
    expect(() => readXlsxSheet(buildXlsxTemplate(), OPTIONS)).toThrow(ValidationError);
    // The parser's error goes to the logger, which keeps what its R19 redaction allows.
    expect(state.warn).toHaveBeenCalledWith(expect.any(String), expect.any(Object), expect.objectContaining({ message: PARSER_DETAIL }));
  });
});
