/**
 * IMP-01 (R09): Excel (.xlsx) import and downloadable templates.
 *
 * An .xlsx upload goes through exactly the CSV path: /parse turns the sheet
 * into the same records, then the NEW-17 preview/execute identity applies, so
 * the same statement as CSV or Excel is ONE identity. Dates are calendar days
 * (no JS Date, no zone), numbers stay decimal text, formulas give their saved
 * value only, and macro, legacy, entity, zip-bomb and oversize files are
 * refused with a 400.
 *
 * Real HTTP against real Postgres. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db";
import {
  accounts, auditLogs, householdMembers, households, merchants, outboxEvents, transactions, users,
} from "@shared/schema";
import { TEMPLATE_COLUMNS } from "@shared/import-template";
import { getTestApp } from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";
import { calendarDateToSerial, isSameStoredNumber } from "../../services/import/xlsx/cells";
import { isZeroPaddedDisplay } from "../../services/import/xlsx/numberFormat";
import { MAX_IMPORT_CELL_ISSUES } from "../../services/import/types";
import { IMPORT_MAX_ROWS } from "../../services/import/spreadsheet";
import { globalImportRowKey, importBatchFingerprint } from "../../services/import/identity";
import { crc32 } from "node:zlib";
import { writeZip, type ZipPart } from "../../core/zipWriter";
import * as XLSX from "xlsx";
import { precheckZip } from "../../services/import/xlsx/zipPrecheck";
import { resolveWorkbookParts } from "../../services/import/xlsx/workbookParts";
import { IMPORT_JSON_LIMIT_BYTES } from "../../middleware/importBody";
import { mergedCellIssues, toMergedRange } from "../../services/import/xlsx/merges";
import { parseRows } from "../../services/import/parse";
import { STYLE_TEXT } from "../../services/import/template";

type Cell = string | { n: string; date?: boolean; padded?: boolean } | { f: string; v?: string } | { iso: string } | { xml: string } | null;
interface SheetSpec { name: string; rows: Cell[][]; state?: "hidden" | "veryHidden"; mergeCells?: string[] }
interface WorkbookSpec {
  sheets: SheetSpec[]; date1904?: boolean; extraParts?: ZipPart[]; sheetPrefix?: string;
  /** Review r1 hostile files: the date style's format code, preset shared strings, stored (not deflated) parts. */
  formatCode?: string; strings?: string[]; store?: boolean;
  /** Review r3: extra relationships in the workbook .rels, and the first sheet's r:id. */
  workbookRelsExtra?: string; sheetRid?: string;
  /** Review r5: the format code of the padded style (s="2"), "000000" by default. */
  padFormat?: string;
}

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const SHEET_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const xmlPart = (name: string, xml: string, store = false): ZipPart => ({ name, data: Buffer.from(xml, "utf8"), deflate: !store });
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Builds an .xlsx the way Excel writes one: shared strings, a date style, deflated parts. */
function buildWorkbook(spec: WorkbookSpec): Buffer {
  const strings: string[] = [...(spec.strings ?? [])];
  const part = (name: string, xml: string) => xmlPart(name, xml, spec.store);
  const sheetXml = spec.sheets.map(sheet => {
    const rows = sheet.rows.map((cells, r) => `<row r="${r + 1}">${cells.map((cell, c) => {
      const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
      if (cell === null) return "";
      if (typeof cell === "object" && "xml" in cell) return cell.xml;
      if (typeof cell === "string") return `<c r="${ref}" t="s"><v>${strings.push(cell) - 1}</v></c>`;
      // Excel marks a text formula result t="str"; a number result has no type.
      if ("f" in cell) return `<c r="${ref}"${cell.v !== undefined && !/^[-+.\dEe]+$/.test(cell.v) ? ' t="str"' : ""}><f>${escape(cell.f)}</f>${cell.v === undefined ? "" : `<v>${cell.v}</v>`}</c>`;
      if ("iso" in cell) return `<c r="${ref}" t="d"><v>${cell.iso}</v></c>`;
      return `<c r="${ref}"${cell.date ? ' s="1"' : cell.padded ? ' s="2"' : ""}><v>${cell.n}</v></c>`;
    }).join("")}</row>`).join("");
    const merges = sheet.mergeCells?.length
      ? `<mergeCells count="${sheet.mergeCells.length}">${sheet.mergeCells.map(ref => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
    return `${spec.sheetPrefix ?? ""}<worksheet xmlns="${MAIN_NS}"><sheetData>${rows}</sheetData>${merges}</worksheet>`;
  });
  const overrides = spec.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${SHEET_CT}"/>`).join("");
  return writeZip([
    part("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`),
    part("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    part("xl/workbook.xml", `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL}"><workbookPr${spec.date1904 ? ' date1904="1"' : ""}/><sheets>${spec.sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ""} r:id="${i === 0 && spec.sheetRid ? spec.sheetRid : `rId${i + 1}`}"/>`).join("")}</sheets></workbook>`),
    part("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${spec.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rIdS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rIdT" Type="${REL}/styles" Target="styles.xml"/>${spec.workbookRelsExtra ?? ""}</Relationships>`),
    part("xl/styles.xml", `<styleSheet xmlns="${MAIN_NS}"><numFmts count="2"><numFmt numFmtId="164" formatCode="${spec.formatCode ?? "dd/mm/yyyy"}"/><numFmt numFmtId="165" formatCode="${escape(spec.padFormat ?? "000000")}"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/></cellXfs></styleSheet>`),
    ...sheetXml.map((xml, i) => part(`xl/worksheets/sheet${i + 1}.xml`, xml)),
    part("xl/sharedStrings.xml", `<sst xmlns="${MAIN_NS}">${strings.map(s => `<si><t>${escape(s)}</t></si>`).join("")}</sst>`),
    ...(spec.extraParts ?? []),
  ]);
}

/** Rewrite one entry's declared uncompressed size in both headers (a lying zip). */
function declareSize(zip: Buffer, name: string, size: number): Buffer {
  const patched = Buffer.from(zip);
  for (let at = patched.indexOf(name); at >= 0; at = patched.indexOf(name, at + 1)) {
    if (patched.readUInt32LE(at - 46) === 0x02014b50) patched.writeUInt32LE(size, at - 46 + 24);
    else if (patched.readUInt32LE(at - 30) === 0x04034b50) patched.writeUInt32LE(size, at - 30 + 22);
  }
  return patched;
}

/** Remove one entry's central-directory record, leaving its local entry in the file (a hidden part). */
function dropFromDirectory(zip: Buffer, name: string): Buffer {
  let record = -1;
  for (let index = zip.indexOf(Buffer.from(name)); index >= 0; index = zip.indexOf(Buffer.from(name), index + 1)) {
    if (index >= 46 && zip.readUInt32LE(index - 46) === 0x02014b50) record = index - 46;
  }
  if (record < 0) throw new Error("no directory record");
  const length = 46 + zip.readUInt16LE(record + 28) + zip.readUInt16LE(record + 30) + zip.readUInt16LE(record + 32);
  const patched = Buffer.concat([zip.subarray(0, record), zip.subarray(record + length)]);
  const eocd = patched.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  patched.writeUInt16LE(patched.readUInt16LE(eocd + 8) - 1, eocd + 8);
  patched.writeUInt16LE(patched.readUInt16LE(eocd + 10) - 1, eocd + 10);
  patched.writeUInt32LE(patched.readUInt32LE(eocd + 12) - length, eocd + 12);
  return patched;
}

const householdId = randomUUID();
const userId = randomUUID();
const currency = "USD";
const mapping = { date: "Date", amount: "Amount", merchant: "Description", reference: "Reference" };
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

function auth(req: request.Test) {
  return req.set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId);
}

function upload(file: Buffer, filename: string, sheet?: string) {
  const req = auth(request(app).post("/api/import/parse"));
  if (sheet) req.field("sheet", sheet);
  return req.attach("file", file, { filename, contentType: filename.endsWith(".csv") ? "text/csv" : XLSX_MIME });
}

interface ReferenceDisplay { row: number; column: string; text: string }
interface ParsedBody { rows: Record<string, string>[]; cellIssues?: unknown[]; referenceDisplays?: ReferenceDisplay[] }

function execute(targetAccountId: string, rows: Record<string, string>[], map: Record<string, string> = mapping, cellIssues: unknown[] = [],
  referenceDisplays: ReferenceDisplay[] = []) {
  return auth(request(app).post("/api/import/execute")).send({ targetAccountId, strategy: "prioritize_coppercoin",
    mapping: map, categoryMapping: {}, dateFormat: "auto", rows, cellIssues, referenceDisplays, batchId: randomUUID() });
}

/** The displays the wizard sends: those of the column mapped as Reference only (review r6). */
const displaysFor = (parsed: ParsedBody, map: Record<string, string>) =>
  (parsed.referenceDisplays ?? []).filter(display => display.column === map.reference);

/** Execute a /parse result as the wizard does: its rows, the Excel cell issues and the Reference displays beside them (review r4, r6). */
function executeParsed(targetAccountId: string, parsed: ParsedBody, map: Record<string, string> = mapping) {
  return execute(targetAccountId, parsed.rows, map, parsed.cellIssues ?? [], displaysFor(parsed, map));
}

async function newAccount() {
  const [account] = await db.insert(accounts).values({ householdId, ownerUserId: userId, name: "Synthetic IMP-01 checking",
    type: "checking", isAsset: true, currency, balance: "100.00", initialBalance: "100.00" }).returning();
  return account.id;
}

async function ledger(accountId: string) {
  const result = await pool.query<{ date: string; name: string; amount: string; type: string }>(
    "SELECT to_char(date, 'YYYY-MM-DD') AS date, name, amount, type FROM transactions WHERE account_id=$1 AND deleted_at IS NULL ORDER BY date, name, amount",
    [accountId]);
  return result.rows;
}

const header = ["Date", "Description", "Amount", "Reference"];
const csvStatement = [
  "Date,Description,Amount,Reference",
  "2026-03-02,Synthetic coffee,-4.5,",
  "2026-03-02,Synthetic coffee,-4.5,",
  "2026-03-03,Synthetic salary,1250,BANK-REF-1",
].join("\n");
const xlsxStatement = buildWorkbook({ sheets: [{ name: "Statement", rows: [header,
  [{ n: String(calendarDateToSerial("2026-03-02")), date: true }, "Synthetic coffee", { n: "-4.5" }, null],
  [{ n: String(calendarDateToSerial("2026-03-02")), date: true }, "Synthetic coffee", { n: "-4.5" }, null],
  [{ iso: "2026-03-03T00:00:00" }, "Synthetic salary", { n: "1.25E+3" }, "BANK-REF-1"],
] }] });

describe("IMP-01 Excel import (real Postgres)", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = `imp01-${userId}@example.invalid`;
    const password = "SyntheticExcelImport123!";
    await db.insert(households).values({ id: householdId, name: "Synthetic IMP-01", currency: "ZMW" });
    await db.insert(users).values({ id: userId, email, username: `imp01-${userId}`,
      passwordHash: await hashPassword(password), emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  afterAll(async () => {
    await pool.query("DELETE FROM data_imports WHERE user_id=$1", [userId]);
    await db.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(merchants).where(eq(merchants.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
    await db.delete(users).where(eq(users.id, userId));
  });

  it("reads the same statement from CSV and .xlsx as identical rows with one identity", async () => {
    const csv = await upload(Buffer.from(csvStatement), "statement.csv").expect(200);
    const xlsx = await upload(xlsxStatement, "statement.xlsx").expect(200);
    expect(xlsx.body).toMatchObject({ format: "xlsx", sheets: ["Statement"], sheet: "Statement", formulaCells: 0 });
    expect(xlsx.body.headers).toEqual(csv.body.headers);
    expect(xlsx.body.rows).toEqual(csv.body.rows);

    const accountId = await newAccount();
    const first = await execute(accountId, xlsx.body.rows).expect(200);
    expect(first.body).toMatchObject({ imported: 3, duplicate: 0, failed: 0 });
    expect(await ledger(accountId)).toEqual([
      { date: "2026-03-02", name: "Synthetic coffee", amount: "4.50", type: "expense" },
      { date: "2026-03-02", name: "Synthetic coffee", amount: "4.50", type: "expense" },
      { date: "2026-03-03", name: "Synthetic salary", amount: "1250.00", type: "income" },
    ]);
    // The CSV of the same statement, and the workbook again, import nothing new.
    expect((await execute(accountId, csv.body.rows).expect(200)).body).toMatchObject({ imported: 0, duplicate: 3 });
    expect((await execute(accountId, xlsx.body.rows).expect(200)).body).toMatchObject({ imported: 0, duplicate: 3 });
    expect(await ledger(accountId)).toHaveLength(3);
  });

  describe("cross-format replay without a reference (#253 r6 P1-3)", () => {
    const noReference = { date: "Date", amount: "Amount", merchant: "Description" };
    const csvSpelling = ["Date,Description,Amount",
      "2026-04-02,  Synthetic bakery ,-4.50", "2026-04-02,Synthetic bakery,-4.50", "2026-04-03,Synthetic refund,12.50"].join("\n");
    const xlsxSpelling = buildWorkbook({ sheets: [{ name: "Statement", rows: [["Date", "Description", "Amount"],
      [{ n: String(calendarDateToSerial("2026-04-02")), date: true }, "Synthetic bakery", { n: "-4.5" }],
      [{ iso: "2026-04-02T00:00:00" }, "Synthetic bakery", { n: "-4.5" }],
      [{ n: String(calendarDateToSerial("2026-04-03")), date: true }, "Synthetic refund", { n: "12.5" }],
    ] }] });
    const expected = [
      { date: "2026-04-02", name: "Synthetic bakery", amount: "4.50", type: "expense" },
      { date: "2026-04-02", name: "Synthetic bakery", amount: "4.50", type: "expense" },
      { date: "2026-04-03", name: "Synthetic refund", amount: "12.50", type: "income" },
    ];
    const run = (accountId: string, rows: Record<string, string>[], strategy = "prioritize_coppercoin") =>
      auth(request(app).post("/api/import/execute")).send({ targetAccountId: accountId, strategy, mapping: noReference,
        categoryMapping: {}, dateFormat: "auto", rows, batchId: randomUUID() }).expect(200);
    const previewOf = (accountId: string, rows: Record<string, string>[]) =>
      auth(request(app).post("/api/import/preview")).send({ targetAccountId: accountId, strategy: "prioritize_coppercoin",
        mapping: noReference, categoryMapping: {}, dateFormat: "auto", rows }).expect(200);

    it("replays the same statement in the other format, whichever comes first", async () => {
      const csv = (await upload(Buffer.from(csvSpelling), "spelling.csv").expect(200)).body.rows;
      const xlsx = (await upload(xlsxSpelling, "spelling.xlsx").expect(200)).body.rows;
      // The cells really are spelled differently.
      expect(csv[2].Amount).toBe("12.50");
      expect(xlsx[2].Amount).toBe("12.5");
      for (const [first, second] of [[csv, xlsx], [xlsx, csv]]) {
        const accountId = await newAccount();
        expect((await run(accountId, first)).body).toMatchObject({ imported: 3, duplicate: 0, failed: 0 });
        expect((await previewOf(accountId, second)).body.counts).toMatchObject({ new: 0, duplicate: 3, candidate: 0 });
        expect((await run(accountId, second)).body).toMatchObject({ imported: 0, duplicate: 3 });
        expect(await ledger(accountId)).toEqual(expected);
      }
    });

    it("still replays rows stored under the earlier raw-cell key, under both strategies", async () => {
      const csv = (await upload(Buffer.from(csvSpelling), "spelling.csv").expect(200)).body.rows;
      for (const strategy of ["prioritize_coppercoin", "prioritize_csv"]) {
        const accountId = await newAccount();
        const imported = (await run(accountId, csv)).body;
        expect(imported).toMatchObject({ imported: 3 });
        // Rewrite each stored key to the earlier key of its row, as an import before this change wrote it.
        const fingerprint = importBatchFingerprint({ rows: csv, mapping: noReference, dateFormat: "auto" });
        const outcomes = await pool.query<{ outcomes: Array<{ ordinal: number; transactionId?: string }> }>(
          "SELECT row_outcomes AS outcomes FROM data_imports WHERE account_id=$1", [accountId]);
        for (const outcome of outcomes.rows[0].outcomes) {
          await pool.query("UPDATE transactions SET idempotency_key=$1 WHERE id=$2",
            [globalImportRowKey(householdId, accountId, fingerprint, { ordinal: outcome.ordinal }), outcome.transactionId]);
        }
        expect((await run(accountId, csv, strategy)).body, strategy).toMatchObject({ imported: 0, duplicate: 3, deleted: 0 });
        expect(await ledger(accountId), strategy).toEqual(expected);
      }
    });
  });

  it("serves CSV and Excel templates whose example row is refused if left in", async () => {
    const csvTemplate = await auth(request(app).get("/api/import/template.csv")).expect(200);
    expect(csvTemplate.headers["content-disposition"]).toContain(".csv");
    const xlsxTemplate = await auth(request(app).get("/api/import/template.xlsx"))
      .buffer(true).parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      }).expect(200);
    expect(xlsxTemplate.headers["content-type"]).toContain(XLSX_MIME);

    const fromCsv = await upload(Buffer.from(csvTemplate.text), "template.csv").expect(200);
    const fromXlsx = await upload(xlsxTemplate.body as Buffer, "template.xlsx").expect(200);
    expect(fromXlsx.body.sheets).toEqual(["Transactions", "Instructions"]);
    expect(fromXlsx.body.headers).toEqual(TEMPLATE_COLUMNS.map(column => column.header));
    expect(fromXlsx.body.rows).toEqual(fromCsv.body.rows);
    expect(fromXlsx.body.rows[0]).toMatchObject({ Date: "2026-01-31", Amount: "-12.50" });
    const instructions = await upload(xlsxTemplate.body as Buffer, "template.xlsx", "Instructions").expect(200);
    expect(JSON.stringify(instructions.body.rows)).toContain("Macro-enabled files (.xlsm)");

    const templateMapping = Object.fromEntries(TEMPLATE_COLUMNS.map(column => [column.field, column.header]));
    const accountId = await newAccount();
    const res = await execute(accountId, fromXlsx.body.rows, templateMapping).expect(200);
    expect(res.body).toMatchObject({ imported: 0, failed: 1 });
    expect(res.body.errors[0]).toMatchObject({ rowIndex: 1, field: "row" });
    expect(res.body.errors[0].reason).toContain("example row");
    expect(await ledger(accountId)).toEqual([]);
  });

  it("imports a filled template with debit/credit and refuses ambiguous or foreign-currency rows", async () => {
    const headers = TEMPLATE_COLUMNS.map(column => column.header);
    const row = (values: Record<string, Cell>) => headers.map(name => values[name] ?? null);
    const workbook = buildWorkbook({ sheets: [{ name: "Transactions", rows: [headers,
      row({ Date: { n: String(calendarDateToSerial("2026-04-01")), date: true }, Description: "Synthetic rent", Debit: { n: "80" }, Currency: "usd" }),
      row({ Date: "2026-04-02", Description: "Synthetic refund", Credit: { n: "25.5" } }),
      row({ Date: "2026-04-03", Description: "Synthetic both", Amount: { n: "-5" }, Debit: { n: "5" } }),
      row({ Date: "2026-04-04", Description: "Synthetic foreign", Amount: { n: "-7" }, Currency: "ZMW" }),
    ] }] });
    const parsed = await upload(workbook, "filled.xlsx").expect(200);
    const accountId = await newAccount();
    const templateMapping = Object.fromEntries(TEMPLATE_COLUMNS.map(column => [column.field, column.header]));
    const res = await execute(accountId, parsed.body.rows, templateMapping);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ imported: 2, failed: 2 });
    expect(res.body.errors.map((e: { rowIndex: number; reason: string }) => [e.rowIndex, e.reason])).toEqual([
      [3, "Fill Amount, or Debit and Credit, not both"],
      [4, "Currency ZMW does not match the account currency USD"],
    ]);
    expect(await ledger(accountId)).toEqual([
      { date: "2026-04-01", name: "Synthetic rent", amount: "80.00", type: "expense" },
      { date: "2026-04-02", name: "Synthetic refund", amount: "25.50", type: "income" },
    ]);
  });

  it("reads the first sheet by default and the chosen sheet on request", async () => {
    const workbook = buildWorkbook({ sheets: [
      { name: "Summary", rows: [["Note"], ["Synthetic summary"]] },
      { name: "Data", rows: [header, ["2026-05-01", "Synthetic data row", { n: "-1" }, null]] },
    ] });
    const first = await upload(workbook, "two.xlsx").expect(200);
    expect(first.body).toMatchObject({ sheets: ["Summary", "Data"], sheet: "Summary", headers: ["Note"] });
    const data = await upload(workbook, "two.xlsx", "Data").expect(200);
    expect(data.body).toMatchObject({ sheet: "Data", headers: header });
    expect(data.body.rows).toEqual([{ Date: "2026-05-01", Description: "Synthetic data row", Amount: "-1", Reference: "" }]);
    const missing = await upload(workbook, "two.xlsx", "Nope").expect(400);
    expect(missing.body.error.message).toContain('no sheet named "Nope"');
  });

  it("uses saved formula values exactly as stored and the 1904 date system", async () => {
    const workbook = buildWorkbook({ date1904: true, sheets: [{ name: "Calc", rows: [header,
      [{ n: "44591", date: true }, "Synthetic formula", { f: "-100.1+0.1", v: "-99.999999999999986" }, null],
      [{ n: "44592", date: true }, { f: "\"Synthetic\"&\" text\"", v: "Synthetic text" }, { n: "-2" }, null],
    ] }] });
    const parsed = await upload(workbook, "calc.xlsx").expect(200);
    expect(parsed.body.formulaCells).toBe(2);
    // Review r1 P1: float noise is kept as stored, never rounded, and the amount validator refuses the row.
    expect(parsed.body.rows[0]).toEqual({ Date: "2026-01-31", Description: "Synthetic formula", Amount: "-99.999999999999986", Reference: "" });
    expect(parsed.body.rows[1]).toMatchObject({ Date: "2026-02-01", Description: "Synthetic text" });
    const accountId = await newAccount();
    const res = await execute(accountId, parsed.body.rows).expect(200);
    expect(res.body).toMatchObject({ imported: 1, failed: 1 });
    expect(res.body.errors[0]).toMatchObject({ rowIndex: 1, field: "amount" });
    expect(res.body.errors[0].reason).toMatch(/^Amount has more than 2 decimal places/);
    expect(await ledger(accountId)).toEqual([{ date: "2026-02-01", name: "Synthetic text", amount: "2.00", type: "expense" }]);

    const uncalculated = buildWorkbook({ sheets: [{ name: "Calc", rows: [header, ["2026-01-01", "x", { f: "1+1" }, null]] }] });
    const refused = await upload(uncalculated, "uncalc.xlsx").expect(400);
    expect(refused.body.error.message).toContain("formula in C2 has no saved value");
  });

  it("refuses macro, legacy, entity, zip-bomb and oversize files with a 400", async () => {
    const plain = { sheets: [{ name: "S", rows: [header, ["2026-01-01", "x", { n: "-1" }, null]] }] };
    const cases: Array<[string, Buffer, string, string]> = [
      ["vba project", buildWorkbook({ ...plain, extraParts: [{ name: "xl/vbaProject.bin", data: Buffer.from("synthetic") }] }), "book.xlsx", "macro-enabled"],
      ["xlsm name", buildWorkbook(plain), "book.xlsm", ""],
      ["legacy xls", Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]), "book.xls", ""],
      ["doctype", buildWorkbook({ ...plain, sheetPrefix: "<!DOCTYPE x [<!ENTITY a \"aaaa\">]>" }), "book.xlsx", "DTD or entities"],
      ["bomb by ratio", buildWorkbook({ ...plain, extraParts: [{ name: "xl/media/zeros.bin", data: Buffer.alloc(20 * 1024 * 1024), deflate: true }] }), "book.xlsx", "decompresses to far more"],
      ["lying size", declareSize(buildWorkbook({ ...plain, extraParts: [] }), "xl/worksheets/sheet1.xml", 10), "book.xlsx", "larger than it declares"],
      ["too many rows", buildWorkbook({ sheets: [{ name: "S", rows: [header, ...Array.from({ length: 5001 }, (_, i) => [`2026-01-01`, `r${i}`, { n: "-1" }, null] as Cell[])] }] }), "big.xlsx", "more than 5000 rows"],
    ];
    for (const [label, file, name, message] of cases) {
      const res = await upload(file, name);
      expect(res.status, label).toBe(400);
      if (message) expect(JSON.stringify(res.body), label).toContain(message);
    }
  });

  describe("hostile and ambiguous files (review r1)", () => {
    const HOSTILE_TIME_BOUND_MS = 3000;
    const columnName = (index: number): string =>
      (index >= 26 ? columnName(Math.floor(index / 26) - 1) : "") + String.fromCharCode(65 + (index % 26));
    const one = (rows: Cell[][], extra: Partial<WorkbookSpec> = {}) => buildWorkbook({ ...extra, sheets: [{ name: "S", rows }] });

    async function refusedQuickly(file: Buffer, message: string, label: string) {
      const started = Date.now();
      const res = await upload(file, "hostile.xlsx");
      expect(res.status, label).toBe(400);
      expect(JSON.stringify(res.body), label).toContain(message);
      expect(Date.now() - started, label).toBeLessThan(HOSTILE_TIME_BOUND_MS);
    }

    it("refuses unbounded numbers, oversized formats and shared-string fan-out with a fast 400 (P1)", async () => {
      await refusedQuickly(one([header, ["2026-01-01", "x", { n: "1e100000000" }, null]]),
        "cell C2 holds a number that cannot be read exactly", "huge exponent");
      await refusedQuickly(one([header, ["2026-01-01", "x", { n: "1e9999" }, null]]),
        "cell C2 holds a number that cannot be read exactly", "long expansion");
      await refusedQuickly(one([header, [{ n: "46000", date: true }, "x", { n: "-1" }, null]], { formatCode: "[".repeat(500_000) }),
        "a number format is longer than Excel allows", "format code");
      const long = "S".repeat(32767);
      const cell = (r: number, c: number): Cell => ({ xml: `<c r="${columnName(c)}${r}" t="s"><v>0</v></c>` });
      const fanOut = Array.from({ length: 6 }, (_, r) => Array.from({ length: 100 }, (_, c) => cell(r + 1, c)));
      await refusedQuickly(one(fanOut, { strings: [long] }), "characters of cell text", "cell fan-out");
      const headerRow = Array.from({ length: 100 }, (_, c) => cell(1, c));
      const dataRows = Array.from({ length: 6 }, (_, r): Cell[] => [{ xml: `<c r="A${r + 2}"><v>1</v></c>` }]);
      await refusedQuickly(one([headerRow, ...dataRows], { strings: [long] }), "holds more text than an import can return", "header fan-out");
    });

    it("keeps stored decimals and numeric references exactly (P1)", async () => {
      const parsed = await upload(one([header,
        ["2026-01-01", "Synthetic big", { n: "12345678901234.56" }, { n: "1234567890123456789" }],
        ["2026-01-02", "Synthetic exponent", { n: "1.2345E-2" }, { n: "+12" }],
      ]), "exact.xlsx").expect(200);
      expect(parsed.body.rows.map((row: Record<string, string>) => [row.Amount, row.Reference])).toEqual([
        ["12345678901234.56", "1234567890123456789"], ["0.012345", "12"],
      ]);
    });

    it("never reads comments as data, reads CDATA as text, and refuses any comment (P2; N2: SheetJS reads markup inside comments)", async () => {
      const cdata: Cell = { xml: "<c r=\"B2\" t=\"inlineStr\"><is><t><![CDATA[Synthetic <cdata> & co]]></t></is></c>" };
      const parsed = await upload(one([header, ["2026-01-01", cdata, { n: "-10" }, null]]), "cdata.xlsx").expect(200);
      expect(parsed.body.headers).toEqual(header);
      expect(parsed.body.rows).toEqual([{ Date: "2026-01-01", Description: "Synthetic <cdata> & co", Amount: "-10", Reference: "" }]);
      // Excel never writes comments in a part, and SheetJS would read <v>900</v> inside one, so any comment is a 400.
      const comment = "contains XML comments or processing instructions";
      await refusedQuickly(one([header, ["2026-01-01", "x", { xml: "<c r=\"C2\"><!--<v>900</v>--><v>-10</v></c>" }, null]]),
        comment, "comment inside a cell");
      const decoy = "<?xml version=\"1.0\"?><!--<sheetData><row r=\"1\"><c r=\"A1\"><v>1</v></c></row></sheetData>-->";
      await refusedQuickly(one([header, ["2026-01-01", "x", { n: "-1" }, null]], { sheetPrefix: decoy }), comment, "decoy sheet in a comment");
      await refusedQuickly(one([header, ["2026-01-01", "x", { n: "-1" }, null]], { sheetPrefix: "<!-- never closed" }), comment, "unclosed comment");
    });

    it("gives repeated headers names no other header uses, so no column is lost (P2)", async () => {
      const parsed = await upload(one([["Date", "Amount", "Amount", "Amount (2)"],
        ["2026-01-01", { n: "-1" }, { n: "-2" }, { n: "-3" }]]), "headers.xlsx").expect(200);
      expect(parsed.body.headers).toEqual(["Date", "Amount", "Amount (3)", "Amount (2)"]);
      expect(parsed.body.rows).toEqual([{ Date: "2026-01-01", Amount: "-1", "Amount (3)": "-2", "Amount (2)": "-3" }]);
    });

    it("refuses a part whose bytes no longer match its CRC-32 (P2)", async () => {
      const stored = one([header, ["2026-01-01", "x", { n: "-10.00" }, null]], { store: true });
      expect((await upload(stored, "stored.xlsx").expect(200)).body.rows[0].Amount).toBe("-10.00");
      const tampered = Buffer.from(stored);
      tampered.write("9", tampered.indexOf("<v>-10.00</v>") + "<v>-".length);
      await refusedQuickly(tampered, "fails its integrity check", "crc");
    });

    it("lists the sheets when the first sheet cannot be read, so another can be chosen (P2)", async () => {
      const workbook = buildWorkbook({ sheets: [
        { name: "Cover", rows: [["Synthetic cover"]] },
        { name: "Data", rows: [header, ["2026-01-01", "Synthetic data", { n: "-1" }, null]] },
      ] });
      const refused = await upload(workbook, "cover.xlsx").expect(400);
      expect(refused.body.error).toMatchObject({ details: { sheets: ["Cover", "Data"], sheet: "Cover" } });
      expect(refused.body.error.message).toContain("\"Cover\" has no rows");
      expect((await upload(workbook, "cover.xlsx", "Data").expect(200)).body.sheet).toBe("Data");
    });

    it("refuses padded shared strings fanned across empty cells and rows with a fast 400 (r2 P1)", async () => {
      const padded = { strings: ["x", " ".repeat(1_000_000)] };
      const emptyCell = (r: number, c: number): Cell => ({ xml: `<c r="${columnName(c)}${r}" t="s"><v>1</v></c>` });
      await refusedQuickly(one([Array.from({ length: 2000 }, (_, c) => emptyCell(1, c))], padded),
        "more than 100 columns", "padded cells in one row");
      const tallRows = Array.from({ length: 5002 }, (_, r) => [emptyCell(r + 1, 0)]);
      await refusedQuickly(one(tallRows, padded), "more than 5000 rows", "padded empty rows");
    });

    it("defaults to the first visible sheet and reports hidden sheets (r2 P2)", async () => {
      const workbook = buildWorkbook({ sheets: [
        { name: "Lookup", state: "hidden", rows: [["Synthetic lookup"], ["x"]] },
        { name: "Data", rows: [header, ["2026-01-01", "Synthetic data", { n: "-1" }, null]] },
      ] });
      const parsed = await upload(workbook, "hidden.xlsx").expect(200);
      expect(parsed.body).toMatchObject({ sheet: "Data", sheets: ["Lookup", "Data"], hiddenSheets: ["Lookup"] });
    });

    it("refuses a row whose mapped column holds an Excel error value (r2 P2)", async () => {
      const errorRef = (r: number): Cell => ({ xml: `<c r="D${r}" t="e"><v>#N/A</v></c>` });
      const parsed = await upload(one([header,
        ["2026-01-01", "Synthetic one", { n: "-1" }, errorRef(2)],
        ["2026-01-02", "Synthetic two", { n: "-2" }, errorRef(3)],
      ]), "errors.xlsx").expect(200);
      const accountId = await newAccount();
      const res = await executeParsed(accountId, parsed.body).expect(200);
      expect(res.body).toMatchObject({ imported: 0, failed: 2 });
      expect(res.body.errors.map((e: { reason: string }) => e.reason)).toEqual(Array(2).fill(
        "Column Reference holds the Excel error #N/A; fix the cell and upload again"));
      expect(await ledger(accountId)).toEqual([]);
    });

    it("rounds a datetime serial to the millisecond before taking its day (r2 P2)", async () => {
      const serial = calendarDateToSerial("2026-03-02");
      const parsed = await upload(one([header,
        [{ n: `${serial}.99999999999`, date: true }, "Synthetic late", { n: "-1" }, null],
        [{ n: `${serial}.5`, date: true }, "Synthetic noon", { n: "-1" }, null],
      ]), "datetime.xlsx").expect(200);
      expect(parsed.body.rows.map((row: Record<string, string>) => row.Date)).toEqual(["2026-03-03", "2026-03-02"]);
    });

    it("refuses oversized relationship ids and relationship floods with a fast 400 (r3 P1)", async () => {
      const plainRows: Cell[][] = [header, ["2026-01-01", "x", { n: "-1" }, null]];
      const flood = Array.from({ length: 1001 }, (_, i) =>
        `<Relationship Id="rIdFlood${i}" Type="${REL}/worksheet" Target="worksheets/none${i}.xml"/>`).join("");
      await refusedQuickly(one(plainRows, { workbookRelsExtra: flood }), "more than 1000 relationships", "relationship flood");
      await refusedQuickly(one(plainRows, { sheetRid: "u".repeat(600_000) }), "attribute is longer than 255 characters", "huge sheet r:id");
      const longRelId = `<Relationship Id="${"i".repeat(256)}" Type="${REL}/worksheet" Target="worksheets/x.xml"/>`;
      await refusedQuickly(one(plainRows, { workbookRelsExtra: longRelId }), "attribute is longer than 255 characters", "long relationship id");
    });

    it("drops namespace-prefixed phonetic runs from string text (r3 P2)", async () => {
      const phonetic: Cell = { xml: "<c r=\"C2\" t=\"inlineStr\"><is><x:t>100</x:t><x:rPh sb=\"0\" eb=\"1\"><x:t>200</x:t></x:rPh></is></c>" };
      const parsed = await upload(one([header, ["2026-01-01", "Synthetic phonetic", phonetic, null]]), "phonetic.xlsx").expect(200);
      expect(parsed.body.rows[0]).toMatchObject({ Amount: "100" });
    });

    it("refuses a formula whose cached value is empty, except an explicitly empty text result (r3 P2)", async () => {
      const emptyAmount: Cell = { xml: "<c r=\"C2\"><f>100+23</f><v/></c>" };
      await refusedQuickly(one([header, ["2026-01-01", "x", emptyAmount, null]]), "formula in C2 has no saved value", "empty amount");
      const emptyReference: Cell = { xml: "<c r=\"D2\"><f>100+23</f><v></v></c>" };
      await refusedQuickly(one([header, ["2026-01-01", "x", { n: "-1" }, emptyReference]]), "formula in D2 has no saved value", "empty reference");
      const emptyText: Cell = { xml: "<c r=\"D2\" t=\"str\"><f>\"\"</f><v></v></c>" };
      const parsed = await upload(one([header, ["2026-01-01", "x", { n: "-1" }, emptyText]]), "emptytext.xlsx").expect(200);
      expect(parsed.body.rows[0]).toMatchObject({ Amount: "-1", Reference: "" });
    });

    it("refuses a mapped cell hidden inside a merged range, so a merged currency cannot pass at face value (r4 P1)", async () => {
      const withCurrency = [...header, "Currency"];
      const workbook = buildWorkbook({ sheets: [{ name: "S", mergeCells: ["E2:E3", "A5:B5"], rows: [withCurrency,
        ["2026-01-01", "Synthetic first", { n: "-1" }, null, "ZMW"],
        ["2026-01-02", "Synthetic second", { n: "-2" }, null, null],
        ["2026-01-03", "Synthetic plain", { n: "-3" }, null, "USD"],
      ] }] });
      const parsed = await upload(workbook, "merged.xlsx").expect(200);
      const accountId = await newAccount();
      const res = await executeParsed(accountId, parsed.body, { ...mapping, currency: "Currency" }).expect(200);
      expect(res.body).toMatchObject({ imported: 1, failed: 2 });
      expect(res.body.errors.map((e: { rowIndex: number; reason: string }) => [e.rowIndex, e.reason])).toEqual([
        [1, "Currency ZMW does not match the account currency USD"],
        [2, "Column Currency holds part of the merged cells E2:E3; fix the cell and upload again"],
      ]);
      expect(await ledger(accountId)).toEqual([{ date: "2026-01-03", name: "Synthetic plain", amount: "3.00", type: "expense" }]);
    });

    it("reproduces a zero-padded numeric Reference as Excel shows it, matching the CSV identity (r4 P1)", async () => {
      const workbook = one([header, ["2026-01-01", "Synthetic padded", { n: "-1" }, { n: "123", padded: true }]]);
      const parsed = await upload(workbook, "padded.xlsx").expect(200);
      // The row keeps the stored value; only the Reference reads the display (review r6 P1).
      expect(parsed.body.rows[0]).toMatchObject({ Reference: "123" });
      expect(parsed.body.referenceDisplays).toEqual([{ row: 1, column: "Reference", text: "000123" }]);
      const csv = await upload(Buffer.from("Date,Description,Amount,Reference\n2026-01-01,Synthetic padded,-1,000123"), "padded.csv").expect(200);
      const accountId = await newAccount();
      await executeParsed(accountId, parsed.body).expect(200);
      expect((await execute(accountId, csv.body.rows).expect(200)).body).toMatchObject({ imported: 0, duplicate: 1 });
    });

    it("keeps invalid date serials and typed Excel errors typed, so a mapped one is a row error (r4 P2)", async () => {
      const parsed = await upload(one([header,
        ["2026-01-01", "Synthetic leap amount", { n: "60", date: true }, null],
        ["2026-01-02", "Synthetic leap reference", { n: "-1" }, { n: "60", date: true }],
        ["2026-01-03", "Synthetic python", { n: "-1" }, { xml: "<c r=\"D4\" t=\"e\"><v>#PYTHON!</v></c>" }],
      ]), "typed.xlsx").expect(200);
      const accountId = await newAccount();
      const res = await executeParsed(accountId, parsed.body).expect(200);
      expect(res.body).toMatchObject({ imported: 0, failed: 3 });
      expect(res.body.errors.map((e: { reason: string }) => e.reason)).toEqual([
        "Column Amount holds a date Excel cannot show (serial 60); fix the cell and upload again",
        "Column Reference holds a date Excel cannot show (serial 60); fix the cell and upload again",
        "Column Reference holds the Excel error #PYTHON!; fix the cell and upload again",
      ]);
      expect(await ledger(accountId)).toEqual([]);
    });

    it("fails the currency check closed: execute without a target account is refused, never accepted at face value (r4 review P1)", async () => {
      const parsed = await upload(Buffer.from("Date,Description,Amount,Currency\n2026-01-01,Synthetic untargeted,-1,ZMW"), "untargeted.csv").expect(200);
      const before = await pool.query("SELECT count(*)::int AS n FROM transactions WHERE household_id=$1", [householdId]);
      const res = await auth(request(app).post("/api/import/execute")).send({ strategy: "prioritize_coppercoin",
        mapping: { ...mapping, currency: "Currency" }, categoryMapping: {}, dateFormat: "auto", rows: parsed.body.rows, batchId: randomUUID() });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", message: "Target account is required" });
      const after = await pool.query("SELECT count(*)::int AS n FROM transactions WHERE household_id=$1", [householdId]);
      expect(after.rows[0].n).toBe(before.rows[0].n);
      // The shared parser refuses a populated Currency whenever the target's currency is unknown.
      const unchecked = parseRows(parsed.body.rows, { date: "Date", amount: "Amount", merchant: "Description", currency: "Currency" }, "auto", {});
      expect(unchecked.rows).toEqual([]);
      expect(unchecked.errors).toEqual([{ rowIndex: 1, field: "row", value: "ZMW",
        reason: "Currency ZMW cannot be checked: the target account's currency is unknown" }]);
    });

    it("pads an integral decimal under a zero-padded format, so 123 and 123.0 both match the CSV 000123 (r4 review P1)", async () => {
      const csv = await upload(Buffer.from("Date,Description,Amount,Reference\n2026-01-05,Synthetic integral,-1,000123"), "integral.csv").expect(200);
      for (const stored of ["123", "123.0", "123.000"]) {
        const parsed = await upload(one([header, ["2026-01-05", "Synthetic integral", { n: "-1" }, { n: stored, padded: true }]]), "integral.xlsx").expect(200);
        expect(parsed.body.rows[0], stored).toMatchObject({ Reference: stored });
        expect(parsed.body.referenceDisplays, stored).toEqual([{ row: 1, column: "Reference", text: "000123" }]);
        const accountId = await newAccount();
        expect((await executeParsed(accountId, parsed.body).expect(200)).body, stored).toMatchObject({ imported: 1 });
        expect((await execute(accountId, csv.body.rows).expect(200)).body, stored).toMatchObject({ imported: 0, duplicate: 1 });
      }
    });

    it("keeps raw values, identity and dedupe identical to the CSV when an unmapped cell is merged (r4 review P1)", async () => {
      const withNotes = [...header, "Notes"];
      const workbook = buildWorkbook({ sheets: [{ name: "S", mergeCells: ["E2:E3"], rows: [withNotes,
        ["2026-01-06", "Synthetic repeat", { n: "-4" }, "R-MERGE-1", null],
        ["2026-01-06", "Synthetic repeat", { n: "-4" }, "R-MERGE-1", null],
      ] }] });
      const parsed = await upload(workbook, "unmapped-merge.xlsx").expect(200);
      const csv = await upload(Buffer.from(
        "Date,Description,Amount,Reference,Notes\n2026-01-06,Synthetic repeat,-4,R-MERGE-1,\n2026-01-06,Synthetic repeat,-4,R-MERGE-1,"), "unmapped-merge.csv").expect(200);
      expect(parsed.body.rows).toEqual(csv.body.rows);
      expect(parsed.body.cellIssues).toEqual([{ row: 2, column: "Notes", issue: "part of the merged cells E2:E3" }]);
      const accountId = await newAccount();
      const previewOf = async (body: { rows: Record<string, string>[]; cellIssues?: unknown[] }) =>
        (await auth(request(app).post("/api/import/preview")).send({ targetAccountId: accountId, strategy: "prioritize_coppercoin",
          mapping, categoryMapping: {}, dateFormat: "auto", rows: body.rows, cellIssues: body.cellIssues ?? [] }).expect(200)).body;
      const [fromXlsx, fromCsv] = [await previewOf(parsed.body), await previewOf(csv.body)];
      expect(fromXlsx.fingerprint).toBe(fromCsv.fingerprint);
      expect(fromXlsx.counts).toEqual(fromCsv.counts);
      expect((await executeParsed(accountId, parsed.body).expect(200)).body).toMatchObject({ imported: 1, failed: 0 });
      expect((await execute(accountId, csv.body.rows).expect(200)).body).toMatchObject({ imported: 0, failed: 0 });
    });

    it("imports text that begins with U+E000 as written (r4 review P2)", async () => {
      const parsed = await upload(one([header, ["2026-01-07", "\uE000Synthetic private use", { n: "-1" }, "\uE000REF-7"]]), "pua.xlsx").expect(200);
      const accountId = await newAccount();
      expect((await executeParsed(accountId, parsed.body).expect(200)).body).toMatchObject({ imported: 1, failed: 0 });
    });

    it("skips merged ranges outside the imported columns and counts every row it visits (r4 review P1)", () => {
      const rows = Array.from({ length: 5001 }, (_, index) => ({ rowNumber: index + 1, cells: ["a", "b", "c", "d"] }));
      const ranges = (refs: string[]) => refs.map(ref => toMergedRange(XLSX.utils.decode_range(ref), ref));
      const outside = ranges(Array.from({ length: 10000 }, () => "AA2:AZ5001"));
      expect(mergedCellIssues(outside, rows, { maxVisits: 100, maxIssues: 100 })).toEqual([]);
      // One imported column across 5000 rows: the row visits alone exceed a 100-visit budget.
      expect(() => mergedCellIssues(ranges(["D1:D5001"]), rows, { maxVisits: 100, maxIssues: 100000 }))
        .toThrow("its merged ranges cover more than 100 cells");
    });

    it("refuses an impossible typed date and a 1904 serial past 9999-12-31 (r4 review P2)", async () => {
      const typed = (ref: string, value: string): Cell => ({ xml: `<c r="${ref}" t="d"><v>${value}</v></c>` });
      const parsed = await upload(one([header,
        ["2026-01-08", "Synthetic impossible reference", { n: "-1" }, typed("D2", "2026-02-30")],
        [typed("A3", "2026-01-31Tgarbage"), "Synthetic garbage date", { n: "-1" }, null],
        [typed("A4", "2026-01-31T10:15:00Z"), "Synthetic typed date-time", { n: "-1" }, null],
      ]), "typed-dates.xlsx").expect(200);
      expect(parsed.body.rows.map((row: Record<string, string>) => [row.Date, row.Reference]))
        .toEqual([["2026-01-08", "2026-02-30"], ["2026-01-31Tgarbage", ""], ["2026-01-31", ""]]);
      const accountId = await newAccount();
      const res = await executeParsed(accountId, parsed.body).expect(200);
      expect(res.body).toMatchObject({ imported: 1, failed: 2 });
      expect(res.body.errors.map((e: { reason: string }) => e.reason)).toEqual([
        "Column Reference holds a date that cannot be read (2026-02-30); fix the cell and upload again",
        "Column Date holds a date that cannot be read (2026-01-31Tgarbage); fix the cell and upload again",
      ]);
      const late = await upload(one([header, [{ n: "2958465", date: true }, "Synthetic far future", { n: "-1" }, null]],
        { date1904: true }), "late1904.xlsx").expect(200);
      expect(late.body.cellIssues).toEqual([{ row: 1, column: "Date", issue: "a date Excel cannot show (serial 2958465)" }]);
    });

    it("formats the template's Reference column as text, so a typed 000123 round-trips to the CSV identity (r4 review P2)", async () => {
      const template = await auth(request(app).get("/api/import/template.xlsx"))
        .buffer(true).parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => done(null, Buffer.concat(chunks)));
        }).expect(200);
      const zip = template.body as Buffer;
      const entries = precheckZip(zip);
      const read = (name: string) => (entries.get(name) ?? Buffer.alloc(0)).toString("utf8");
      const referenceColumn = TEMPLATE_COLUMNS.findIndex(column => column.field === "reference") + 1;
      const letter = String.fromCharCode(64 + referenceColumn);
      expect(read("xl/worksheets/sheet1.xml")).toContain(`<col min="${referenceColumn}" max="${referenceColumn}" width="22" customWidth="1" style="${STYLE_TEXT}"/>`);
      const cellXfs = /<cellXfs[^>]*>(.*?)<\/cellXfs>/.exec(read("xl/styles.xml"))?.[1] ?? "";
      expect(Array.from(cellXfs.matchAll(/<xf [^>]*\/>/g), match => match[0])[STYLE_TEXT]).toContain("numFmtId=\"49\"");
      // What Excel saves when 000123 is typed into that Text column: a string cell, the example row deleted.
      const filled = read("xl/worksheets/sheet1.xml").replace(/<row r="2">.*?<\/row>/,
        `<row r="2"><c r="A2" t="inlineStr"><is><t>2026-01-09</t></is></c><c r="B2" t="inlineStr"><is><t>Synthetic template</t></is></c>`
        + `<c r="C2"><v>-1</v></c><c r="${letter}2" s="${STYLE_TEXT}" t="inlineStr"><is><t>000123</t></is></c></row>`);
      const saved = writeZip(Array.from(entries.keys(), name => ({ name, data: name === "xl/worksheets/sheet1.xml" ? Buffer.from(filled) : entries.get(name) ?? Buffer.alloc(0) })));
      const parsed = await upload(saved, "filled-template.xlsx").expect(200);
      expect(parsed.body.rows[0]).toMatchObject({ Date: "2026-01-09", Reference: "000123" });
      const csv = await upload(Buffer.from("Date,Description,Amount,Reference\n2026-01-09,Synthetic template,-1,000123"), "template-round.csv").expect(200);
      const accountId = await newAccount();
      const templateMapping = { date: "Date", amount: "Amount", merchant: "Description", reference: "Reference" };
      expect((await executeParsed(accountId, parsed.body, templateMapping).expect(200)).body).toMatchObject({ imported: 1 });
      expect((await execute(accountId, csv.body.rows).expect(200)).body).toMatchObject({ imported: 0, duplicate: 1 });
    });

    it("refuses cell checks for a row or column the file does not have, and indexes a flood of them quickly (r5 P1)", async () => {
      const parsed = await upload(one([header, ["2026-02-01", "Synthetic indexed", { n: "-1" }, "R-IDX-1"]]), "indexed.xlsx").expect(200);
      const accountId = await newAccount();
      // The app's JSON body limit (express default, 100 kb) holds the flood below the schema's 10,000.
      const flood = Array.from({ length: 1000 }, (_, index) => ({ row: 1, column: `Not a header ${index}`, issue: "the Excel error #N/A" }));
      const started = Date.now();
      const res = await execute(accountId, parsed.body.rows, mapping, flood);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe("The cell checks name a row or column this file does not have; upload the file again");
      expect(Date.now() - started).toBeLessThan(3000);
      const pastEnd = await execute(accountId, parsed.body.rows, mapping, [{ row: 2, column: "Reference", issue: "the Excel error #N/A" }]);
      expect(pastEnd.status).toBe(400);
      expect(await ledger(accountId)).toEqual([]);
    });

    it("reports a cell under overlapping merges once, and charges issue text to the response budget (r5 P1)", async () => {
      const withNotes = [...header, "Notes"];
      const merged = await upload(buildWorkbook({ sheets: [{ name: "S", mergeCells: ["E2:E3", "E2:E3", "D2:E3"], rows: [withNotes,
        ["2026-02-02", "Synthetic overlap", { n: "-1" }, "R-OV-1", null],
        ["2026-02-02", "Synthetic overlap", { n: "-1" }, "R-OV-1", null],
      ] }] }), "overlap.xlsx").expect(200);
      expect(merged.body.cellIssues).toHaveLength(3);
      expect(merged.body.cellIssues).toEqual(expect.arrayContaining([
        { row: 1, column: "Notes", issue: "part of the merged cells D2:E3" },
        { row: 2, column: "Reference", issue: "part of the merged cells D2:E3" },
        { row: 2, column: "Notes", issue: "part of the merged cells E2:E3" },
      ]));
      // 5000 rows under a 3000-character header fit the budget as cells, but not once each issue repeats the header.
      const longHeader = "H".repeat(3000);
      const errorRows: Cell[][] = Array.from({ length: 5000 }, (_, index) => [{ xml: `<c r="A${index + 2}" t="e"><v>#N/A</v></c>` }]);
      await refusedQuickly(one([[longHeader], ...errorRows]), "holds more text than an import can return", "issue text budget");
    });

    it("reproduces a two-section zero-padded format and refuses a Reference display it cannot reproduce (r5 P1)", async () => {
      const signed = await upload(one([header,
        ["2026-02-03", "Synthetic positive", { n: "-1" }, { n: "123", padded: true }],
        ["2026-02-04", "Synthetic negative", { n: "-1" }, { n: "-123", padded: true }],
      ], { padFormat: "000000;[Red]-000000" }), "two-section.xlsx").expect(200);
      expect(signed.body.rows.map((row: Record<string, string>) => row.Reference)).toEqual(["123", "-123"]);
      expect(signed.body.referenceDisplays.map((display: ReferenceDisplay) => display.text)).toEqual(["000123", "-000123"]);
      const csv = await upload(Buffer.from("Date,Description,Amount,Reference\n2026-02-03,Synthetic positive,-1,000123"), "two-section.csv").expect(200);
      const accountId = await newAccount();
      await executeParsed(accountId, { rows: [signed.body.rows[0]], cellIssues: [],
        referenceDisplays: signed.body.referenceDisplays.filter((display: ReferenceDisplay) => display.row === 1) }).expect(200);
      expect((await execute(accountId, csv.body.rows).expect(200)).body).toMatchObject({ imported: 0, duplicate: 1 });

      // SheetJS renders the format; a conditional section that only pads is accepted (N2), as Excel shows 123 under it.
      const conditional = await upload(one([header, ["2026-02-05", "Synthetic conditional", { n: "-5" }, { n: "123", padded: true }]],
        { padFormat: "[<100]000;0000" }), "conditional.xlsx").expect(200);
      expect(conditional.body).toMatchObject({ rows: [{ Reference: "123" }], cellIssues: [],
        referenceDisplays: [{ row: 1, column: "Reference", text: "0123" }] });

      // Shown with decimals, with separators, or without its minus (the sign-flip guard): never a silently different reference.
      for (const { padFormat, n, shown } of [
        { padFormat: "0.00", n: "1234", shown: "1234.00" },
        { padFormat: "#,##0", n: "1234", shown: "1,234" },
        { padFormat: "0000;0000", n: "-1234", shown: "1234" },
      ]) {
        const parsed = await upload(one([header,
          ["2026-02-05", "Synthetic shown differently", { n: "-5", padded: true }, { n, padded: true }],
          ["2026-02-06", "Synthetic amount format only", { n: "-6", padded: true }, "R-FMT-2"],
        ], { padFormat }), "formats.xlsx").expect(200);
        const target = await newAccount();
        const res = await executeParsed(target, parsed.body).expect(200);
        expect(res.body, padFormat).toMatchObject({ imported: 1, failed: 1 });
        expect(res.body.errors[0].reason, padFormat).toBe(
          `Column Reference holds a number shown as "${shown}" by the format "${padFormat}", not as its stored value; fix the cell and upload again`);
        expect(await ledger(target), padFormat).toEqual([{ date: "2026-02-06", name: "Synthetic amount format only", amount: "6.00", type: "expense" }]);
      }
    });

    it("refuses malformed, misplaced and duplicate cell addresses; infers position only when the address is absent (r5 P1)", async () => {
      const row2 = (cells: string) => ({ xml: cells });
      const sheet = (cells: string) => one([header, ["2026-02-07", "Synthetic address", row2(cells), null]]);
      await refusedQuickly(sheet(`<c r="C2x"><v>-1</v></c>`), 'a cell address \\"C2x\\" is not valid', "malformed address");
      await refusedQuickly(sheet(`<c r="C9"><v>-1</v></c>`), "cell C9 is not in row 2", "misplaced address");
      await refusedQuickly(sheet(`<c r="C2"><v>-1</v></c><c r="C2"><v>-999</v></c>`), "two cells share the address C2", "duplicate address");
      const inferred = await upload(sheet(`<c r="C2"><v>-1</v></c><c><v>42</v></c>`), "inferred.xlsx").expect(200);
      expect(inferred.body.rows[0]).toMatchObject({ Amount: "-1", Reference: "42" });
    });

    it("refuses a typed date with an impossible UTC offset (r5 P2)", async () => {
      const typed = (ref: string, value: string): Cell => ({ xml: `<c r="${ref}" t="d"><v>${value}</v></c>` });
      const parsed = await upload(one([header,
        [typed("A2", "2026-01-31T10:15:00+99:99"), "Synthetic bad offset", { n: "-1" }, null],
        [typed("A3", "2026-01-31T10:15:00-12:30"), "Synthetic far west", { n: "-1" }, null],
        [typed("A4", "2026-01-31T10:15:00+05:30"), "Synthetic real offset", { n: "-1" }, null],
        [typed("A5", "2026-01-31T10:15:00+14:00"), "Synthetic line islands", { n: "-1" }, null],
      ]), "offsets.xlsx").expect(200);
      expect(parsed.body.cellIssues.map((issue: { row: number }) => issue.row)).toEqual([1, 2]);
      expect(parsed.body.rows.map((row: Record<string, string>) => row.Date).slice(2)).toEqual(["2026-01-31", "2026-01-31"]);
    });

    it("refuses a mapped column the file does not have instead of reading it as blank (r5 P2)", async () => {
      const csv = await upload(Buffer.from("Date,Description,Amount,Reference,CCY\n2026-02-08,Synthetic stale mapping,-1,R-CCY-1,ZMW"), "ccy.csv").expect(200);
      const accountId = await newAccount();
      const res = await execute(accountId, csv.body.rows, { ...mapping, currency: "Currency" });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe("The column \"Currency\" is mapped but this file has no such column; map the columns again");
      expect(await ledger(accountId)).toEqual([]);
    });

    it("puts the refusing cell checks in the batch fingerprint, and only those (r5)", async () => {
      const withNotes = [...header, "Notes"];
      const rows: Cell[][] = [withNotes, ["2026-02-09", "Synthetic fingerprint", { n: "-1" }, null, "note"]];
      const parsed = await upload(one(rows), "fingerprint.xlsx").expect(200);
      const accountId = await newAccount();
      const fingerprint = async (cellIssues: unknown[]) => (await auth(request(app).post("/api/import/preview")).send({
        targetAccountId: accountId, strategy: "prioritize_coppercoin", mapping, categoryMapping: {}, dateFormat: "auto",
        rows: parsed.body.rows, cellIssues }).expect(200)).body.fingerprint as string;
      const none = await fingerprint([]);
      expect(await fingerprint([{ row: 1, column: "Notes", issue: "the Excel error #N/A" }])).toBe(none);
      expect(await fingerprint([{ row: 1, column: "Amount", issue: "the Excel error #N/A" }])).not.toBe(none);
    });

    it("refuses a corpus of malformed workbooks with a clean 400, never a 500 or silently dropped rows (N2)", async () => {
      const rows: Cell[][] = [header, ["2026-01-01", "Synthetic corpus", { n: "-1" }, null], ["2026-01-02", "Synthetic corpus", { n: "-2" }, null]];
      const good = one(rows);
      expect((await upload(good, "good.xlsx").expect(200)).body.rows).toHaveLength(2);
      const SHEET = "xl/worksheets/sheet1.xml";
      const parts = (file: Buffer): ZipPart[] => Array.from(precheckZip(file), ([name, data]) => ({ name, data, deflate: true }));
      const withSheet = (text: string) => writeZip(parts(good).map(part => (part.name === SHEET ? { ...part, data: Buffer.from(text) } : part)));
      const sheetText = (precheckZip(good).get(SHEET) ?? Buffer.alloc(0)).toString("utf8");
      const notWellFormed = "is not well-formed XML";
      // SheetJS alone reads both of these as a sheet with fewer rows.
      await refusedQuickly(withSheet(sheetText.replace("</worksheet>", "")), notWellFormed, "no closing worksheet tag");
      await refusedQuickly(withSheet(sheetText.slice(0, sheetText.indexOf("<row r=\"3\"") + 8)), notWellFormed, "truncated mid-tag");
      await refusedQuickly(writeZip([...parts(good), { name: "xl/media/zeros.xml", data: Buffer.alloc(30 * 1024 * 1024, 0x20), deflate: true }]),
        "decompresses to far more", "bomb ratio, refused before inflation");
      await refusedQuickly(writeZip([...parts(good), { name: SHEET, data: Buffer.from(sheetText.replace("<v>-1</v>", "<v>-999</v>")), deflate: true }]),
        "appears twice", "duplicate part");
      await refusedQuickly(writeZip([...parts(good), { name: "XL/Worksheets/Sheet1.xml", data: Buffer.from(sheetText), deflate: true }]),
        "appears twice", "duplicate part in another case");
      const badDirectory = Buffer.from(good);
      const eocd = badDirectory.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      badDirectory.writeUInt32LE(badDirectory.readUInt32LE(eocd + 12) + 7, eocd + 12);
      await refusedQuickly(badDirectory, "central directory is not where or as large as it declares", "bad central-directory size");
      const hidden = writeZip([...parts(good), { name: "xl/hidden.xml", data: Buffer.from("<x/>"), deflate: true }]);
      await refusedQuickly(dropFromDirectory(hidden, "xl/hidden.xml"), "holds data outside its listed parts", "local entry missing from the directory");
      await refusedQuickly(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("synthetic garbage")]), "File content does not match", "garbage bytes");
      await refusedQuickly(good.subarray(0, Math.floor(good.length / 2)), "not a valid .xlsx", "truncated zip");
      // An unconsumed part is CRC-checked too (held item).
      const extra = one(rows, { store: true, extraParts: [{ name: "docProps/app.xml", data: Buffer.from("<Properties>synthetic-app</Properties>"), deflate: false }] });
      const tampered = Buffer.from(extra);
      tampered.write("X", tampered.indexOf("synthetic-app"));
      await refusedQuickly(tampered, "fails its integrity check", "crc of an unconsumed part");
      await refusedQuickly(one(rows, { workbookRelsExtra: `<Relationship Id="rIdUp" Type="${REL}/image" Target="../../../etc/synthetic"/>` }),
        "a relationship points outside the file", "relationship above the package root");
    });

    it("reads attributes as XML, not by text matching, and caps the shared-string table before SheetJS builds it (N2 held items)", async () => {
      // A quoted ">" and an r= or t= inside another attribute's value used to confuse the text scanner.
      const tricky = await upload(one([header, ["2026-01-01", "Synthetic attributes",
        { xml: `<c foo="a>b r=&quot;Z9&quot;" r="C2"><v>-1</v></c>` }, { xml: `<c bar='t="s"' r="D2"><v>42</v></c>` }]]), "attributes.xlsx").expect(200);
      expect(tricky.body.rows).toEqual([{ Date: "2026-01-01", Description: "Synthetic attributes", Amount: "-1", Reference: "42" }]);
      const table = new Map(precheckZip(one([header, ["2026-01-01", "x", { n: "-1" }, null]])));
      table.set("xl/sharedStrings.xml", Buffer.from(`<sst xmlns="${MAIN_NS}">${"<si/>".repeat(1_000_001)}</sst>`));
      expect(() => resolveWorkbookParts(table)).toThrow("its shared-string table has more than 1000000 entries");
    });

    it("accepts an import body as large as its caps allow and refuses a larger one with a 413; other routes keep 100 kb (r5 follow-up)", async () => {
      const accountId = await newAccount();
      const note = "N".repeat(6000);
      // 5000 rows and 10000 cell issues, the most the caps allow; the amounts are invalid so nothing is written.
      const rows = Array.from({ length: 5000 }, (_, index) => ({ Date: "2026-02-10", Description: "Synthetic body", Amount: "not money",
        Reference: `R-BODY-${index}`, Notes: note, Notes2: "x" }));
      const cellIssues = Array.from({ length: 10000 }, (_, index) => ({ row: Math.floor(index / 2) + 1,
        column: index % 2 ? "Notes2" : "Notes", issue: "the Excel error #N/A" }));
      const body = { targetAccountId: accountId, strategy: "prioritize_coppercoin", mapping, categoryMapping: {}, dateFormat: "auto",
        rows, cellIssues, batchId: randomUUID() };
      const bytes = Buffer.byteLength(JSON.stringify(body));
      expect(bytes).toBeGreaterThan(IMPORT_JSON_LIMIT_BYTES - 4 * 1024 * 1024);
      expect(bytes).toBeLessThan(IMPORT_JSON_LIMIT_BYTES);
      const accepted = await auth(request(app).post("/api/import/execute")).send(body);
      expect(accepted.status).toBe(200);
      expect(accepted.body).toMatchObject({ imported: 0, failed: 5000 });
      const oversize = await auth(request(app).post("/api/import/execute"))
        .send({ ...body, rows: rows.map(row => ({ ...row, Notes: `${note}${"N".repeat(1000)}` })) });
      expect(oversize.status).toBe(413);
      expect(await ledger(accountId)).toEqual([]);
      // The larger limit is scoped to preview and execute: the same router's parse route keeps the global 100 kb.
      const elsewhere = await auth(request(app).post("/api/import/parse")).send({ padding: "P".repeat(200 * 1024) });
      expect(elsewhere.status).toBe(413);
    });

    describe("review r6", () => {
      const SHEET = "xl/worksheets/sheet1.xml";
      const rowsOf = (n: string): Cell[][] => [header, ["2026-03-10", "Synthetic r6", { n }, "R-R6-1"]];
      const partsOf = (file: Buffer) => new Map(precheckZip(file));
      const rezip = (parts: Map<string, Buffer>) => writeZip(Array.from(parts, ([name, data]) => ({ name, data, deflate: true })));
      const edited = (file: Buffer, name: string, edit: (text: string) => string) => {
        const parts = partsOf(file);
        parts.set(name, Buffer.from(edit((parts.get(name) ?? Buffer.alloc(0)).toString("utf8"))));
        return rezip(parts);
      };
      const previewOf = (accountId: string, body: ParsedBody) => auth(request(app).post("/api/import/preview")).send({
        targetAccountId: accountId, strategy: "prioritize_coppercoin", mapping, categoryMapping: {}, dateFormat: "auto",
        rows: body.rows, cellIssues: body.cellIssues ?? [], referenceDisplays: displaysFor(body, mapping) });

      it("counts non-ASCII element names toward the metadata element caps (final pass P1)", async () => {
        const good = one(rowsOf("-1"));
        await refusedQuickly(edited(good, "xl/_rels/workbook.xml.rels", text => text.replace("</Relationships>", `${"<é/>".repeat(1200)}</Relationships>`)),
          "has more than 1001 elements", "non-ASCII relationships element flood");
        await refusedQuickly(edited(good, "xl/styles.xml", text => text.replace("</numFmts>", `${"<ü/>".repeat(5000)}</numFmts>`)),
          "has too many elements", "non-ASCII flood inside numFmts");
      });

      it("refuses an over-long display or cell-issue array before checking its entries (final pass P1)", async () => {
        const accountId = await newAccount();
        const rows = [{ Date: "2026-03-10", Description: "Synthetic r7", Amount: "-1", Reference: "R-R7-1" }];
        for (const [field, max] of [["referenceDisplays", IMPORT_MAX_ROWS], ["cellIssues", MAX_IMPORT_CELL_ISSUES]] as const) {
          const flood = Array.from({ length: max + 1 }, () => null);
          const res = await auth(request(app).post("/api/import/execute")).send({ targetAccountId: accountId, strategy: "prioritize_coppercoin",
            mapping, categoryMapping: {}, dateFormat: "auto", rows, batchId: randomUUID(), [field]: flood });
          expect(res.status, field).toBe(400);
          // One issue for the array, none per entry: the entries are never parsed.
          expect(res.body.error.details, field).toHaveLength(1);
          expect(res.body.error.details[0].path, field).toEqual([field]);
        }
        expect(await ledger(accountId)).toEqual([]);
      });

      it("accepts a Reference display only when it keeps every stored digit, zero-padded before them (final pass P1)", async () => {
        expect(isZeroPaddedDisplay("000123", "0123")).toBe(false);
        expect(isZeroPaddedDisplay("000123", "00000123")).toBe(true);
        expect(isZeroPaddedDisplay("123", "000123")).toBe(true);
        expect(isZeroPaddedDisplay("123.000", "000123")).toBe(true);
        expect(isZeroPaddedDisplay("-123", "-000123")).toBe(true);
        expect(isZeroPaddedDisplay("-5", "0005")).toBe(false);
        const accountId = await newAccount();
        const rows = [{ Date: "2026-03-10", Description: "Synthetic r7", Amount: "-1", Reference: "000123" }];
        const res = await execute(accountId, rows, mapping, [], [{ row: 1, column: "Reference", text: "0123" }]);
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain("The Reference cells do not match this file's rows");
        expect(await ledger(accountId)).toEqual([]);
      });

      it("refuses a hidden stored amount in a merged non-anchor cell in preview and execute, though its format adds a Reference-only issue (r6 P1)", async () => {
        const workbook = buildWorkbook({ padFormat: "0.00", sheets: [{ name: "S", mergeCells: ["C2:C3"], rows: [header,
          ["2026-03-10", "Synthetic merged anchor", { n: "-10" }, "R-MRG-1"],
          ["2026-03-10", "Synthetic merged hidden", { n: "25.5", padded: true }, "R-MRG-2"],
        ] }] });
        const parsed = await upload(workbook, "merged-hidden.xlsx").expect(200);
        // Both issues are kept: the Reference-only display issue no longer hides the merge.
        expect(parsed.body.cellIssues).toEqual(expect.arrayContaining([
          { row: 2, column: "Amount", issue: "part of the merged cells C2:C3" },
          expect.objectContaining({ row: 2, column: "Amount", field: "reference" }),
        ]));
        const reason = "Column Amount holds part of the merged cells C2:C3; fix the cell and upload again";
        const accountId = await newAccount();
        const preview = (await previewOf(accountId, parsed.body).expect(200)).body;
        expect(preview.errors).toEqual([expect.objectContaining({ rowIndex: 2, reason })]);
        const res = await executeParsed(accountId, parsed.body).expect(200);
        expect(res.body).toMatchObject({ imported: 1, failed: 1, errors: [expect.objectContaining({ rowIndex: 2, reason })] });
        expect(await ledger(accountId)).toEqual([{ date: "2026-03-10", name: "Synthetic merged anchor", amount: "10.00", type: "expense" }]);
      });

      it("reads every field but the Reference from the stored decimal, so a padded 123.000 Amount is refused as in CSV (r6 P1)", async () => {
        const parsed = await upload(one(rowsOf("123.000").map((row, r) => (r ? [row[0], row[1], { n: "123.000", padded: true }, row[3]] : row))),
          "padded-amount.xlsx").expect(200);
        expect(parsed.body.rows).toEqual([{ Date: "2026-03-10", Description: "Synthetic r6", Amount: "123.000", Reference: "R-R6-1" }]);
        expect(parsed.body.referenceDisplays).toEqual([{ row: 1, column: "Amount", text: "000123" }]);
        const csv = await upload(Buffer.from("Date,Description,Amount,Reference\n2026-03-10,Synthetic r6,123.000,R-R6-1"), "padded-amount.csv").expect(200);
        const accountId = await newAccount();
        const fromXlsx = (await executeParsed(accountId, parsed.body).expect(200)).body;
        const fromCsv = (await execute(accountId, csv.body.rows).expect(200)).body;
        expect(fromXlsx).toMatchObject({ imported: 0, failed: 1 });
        expect(fromXlsx.errors).toEqual(fromCsv.errors);
        expect(fromXlsx.errors[0].reason).toContain("more than 2 decimal places");
        expect(await ledger(accountId)).toEqual([]);
        // Displays are checked against the rows: another column, another value or a repeated row refuses the request.
        const stale = "The Reference cells do not match this file's rows";
        const refs = await upload(one([header, ["2026-03-11", "Synthetic display", { n: "-1" }, { n: "123", padded: true }]]), "display.xlsx").expect(200);
        for (const referenceDisplays of [
          [{ row: 1, column: "Amount", text: "-0001" }],
          [{ row: 1, column: "Reference", text: "000124" }],
          [{ row: 1, column: "Reference", text: "000123" }, { row: 1, column: "Reference", text: "0123" }],
        ]) {
          const res = await execute(accountId, refs.body.rows, mapping, [], referenceDisplays);
          expect(res.status, JSON.stringify(referenceDisplays)).toBe(400);
          expect(JSON.stringify(res.body)).toContain(stale);
        }
        // The two readers are compared as decimals: Excel's 17-digit spellings and over-long integers still match their double.
        expect(isSameStoredNumber("0.10000000000000001", 0.1)).toBe(true);
        expect(isSameStoredNumber("1234567890123456789", 1234567890123456789)).toBe(true);
        expect(isSameStoredNumber("0.2", 0.1)).toBe(false);
        expect(isSameStoredNumber("12.50", 12.5)).toBe(true);
      });

      it("bounds content types, relationships, the sheet list and number formats before any tree is built (r6 P1)", async () => {
        const good = one(rowsOf("-1"));
        const overrides = Array.from({ length: 1001 }, (_, i) => `<Override PartName="/synthetic/p${i}.xml" ContentType="application/xml"/>`).join("");
        await refusedQuickly(edited(good, "[Content_Types].xml", text => text.replace("</Types>", `${overrides}</Types>`)),
          "it declares more than 1000 content-type overrides", "content-type override flood");
        const stored = partsOf(good);
        stored.set("xl/_rels/workbook.xml.rels", Buffer.from((stored.get("xl/_rels/workbook.xml.rels") ?? Buffer.alloc(0)).toString("utf8")
          .replace("<Relationship ", `${" ".repeat(1_100_000)}<Relationship `)));
        await refusedQuickly(writeZip(Array.from(stored, ([name, data]) => ({ name, data, deflate: false }))),
          "the part xl/_rels/workbook.xml.rels is larger than 1048576 bytes", "oversized relationships part");
        await refusedQuickly(edited(good, "xl/_rels/workbook.xml.rels", text => text.replace("</Relationships>", `${"<x/>".repeat(1200)}</Relationships>`)),
          "has more than 1001 elements", "relationships element flood");
        await refusedQuickly(edited(good, "xl/styles.xml", text => text.replace("</numFmts>",
          `${Array.from({ length: 1001 }, (_, i) => `<numFmt numFmtId="${200 + i}" formatCode="0"/>`).join("")}</numFmts>`)),
          "has more than 1000 numFmt elements", "number-format flood");
        // A number format outside <numFmts> (a conditional-format <dxf>) is not SheetJS's to read, and does not count.
        const dxf = await upload(edited(good, "xl/styles.xml", text => text.replace("</styleSheet>",
          `<dxfs count="1"><dxf><numFmt numFmtId="300" formatCode="0.0"/></dxf></dxfs></styleSheet>`)), "dxf.xlsx").expect(200);
        expect(dxf.body.rows).toHaveLength(1);
        // A quoted ">" or "/>" in the section's start tag cannot cut it short.
        const quoted = edited(good, "xl/styles.xml", text => text.replace('<numFmts count="2">', '<numFmts count="2" x="/>">')
          .replace('formatCode="000000"', `formatCode="${"0".repeat(300)}"`));
        await refusedQuickly(quoted, "a number format is longer than Excel allows", "quoted end inside the numFmts tag");
        await refusedQuickly(edited(good, "xl/workbook.xml", text => text.replace("</sheets>",
          `${Array.from({ length: 1000 }, (_, i) => `<sheet name="X${i}" sheetId="${i + 2}" r:id="rIdX${i}"/>`).join("")}</sheets>`)),
          "has more than 1000 sheet elements", "sheet flood");
        await refusedQuickly(edited(good, "[Content_Types].xml", text => text.replace("</Types>", "<![CDATA[x]]></Types>")),
          "contains CDATA", "CDATA in content types");
      });

      it("refuses local headers and data descriptors that disagree with the directory, and reads a consistent descriptor (r6 P1)", async () => {
        const good = one(rowsOf("-1"), { store: true });
        // Local flags differ from the central record.
        const flags = Buffer.from(good);
        let local = -1;
        for (let at = flags.indexOf(Buffer.from(SHEET)); at >= 0 && local < 0; at = flags.indexOf(Buffer.from(SHEET), at + 1)) {
          if (at >= 30 && flags.readUInt32LE(at - 30) === 0x04034b50) local = at - 30;
        }
        expect(local).toBeGreaterThan(0);
        flags.writeUInt16LE(flags.readUInt16LE(local + 6) | 0x2, local + 6);
        await refusedQuickly(flags, "a part header disagrees with the directory", "local flags");
        // The sheet as a data-descriptor entry: correct, then with a wrong CRC, then a wrong size.
        const withDescriptor = (tamper: (descriptor: Buffer) => void) => {
          const parts = Array.from(precheckZip(good), ([name, data]) => ({ name, data }));
          const locals: Buffer[] = [];
          const centrals: Buffer[] = [];
          let offset = 0;
          for (const { name, data } of parts) {
            const deferred = name === SHEET;
            const nameBytes = Buffer.from(name);
            const crc = crc32(data);
            const head = Buffer.alloc(30);
            head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(deferred ? 0x808 : 0x800, 6);
            if (!deferred) { head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); }
            head.writeUInt16LE(nameBytes.length, 26);
            const descriptor = Buffer.alloc(deferred ? 16 : 0);
            if (deferred) {
              descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc, 4);
              descriptor.writeUInt32LE(data.length, 8); descriptor.writeUInt32LE(data.length, 12);
              tamper(descriptor);
            }
            const central = Buffer.alloc(46);
            central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
            central.writeUInt16LE(deferred ? 0x808 : 0x800, 8); central.writeUInt32LE(crc, 16);
            central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
            central.writeUInt32LE(offset, 42);
            const entry = Buffer.concat([head, nameBytes, data, descriptor]);
            locals.push(entry);
            centrals.push(Buffer.concat([central, nameBytes]));
            offset += entry.length;
          }
          const directory = Buffer.concat(centrals);
          const end = Buffer.alloc(22);
          end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10);
          end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
          return Buffer.concat([...locals, directory, end]);
        };
        const consistent = await upload(withDescriptor(() => undefined), "descriptor.xlsx").expect(200);
        expect(consistent.body.rows).toEqual([{ Date: "2026-03-10", Description: "Synthetic r6", Amount: "-1", Reference: "R-R6-1" }]);
        await refusedQuickly(withDescriptor(descriptor => descriptor.writeUInt32LE((descriptor.readUInt32LE(4) ^ 1) >>> 0, 4)),
          "a part header disagrees with the directory", "descriptor CRC");
        await refusedQuickly(withDescriptor(descriptor => descriptor.writeUInt32LE(descriptor.readUInt32LE(12) + 1, 12)),
          "a part header disagrees with the directory", "descriptor size");
      });

      it("reads a sheet only when its relationship and content type make it a worksheet, and validates parts by what they are (r6 P2)", async () => {
        const good = one(rowsOf("-1"));
        const notWorksheet = 'the sheet \\"S\\" is not a worksheet';
        await refusedQuickly(edited(good, "[Content_Types].xml", text => text.replace(SHEET_CT, "application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml")),
          notWorksheet, "worksheet with a chartsheet content type");
        await refusedQuickly(edited(good, "xl/_rels/workbook.xml.rels", text => text.replace(`${REL}/worksheet`, `${REL}/chartsheet`)),
          notWorksheet, "worksheet with a chartsheet relationship");
        // An XML worksheet under another name is validated as XML too (truncated: refused as not well-formed). Well-formed,
        // SheetJS reads it by its name as a binary sheet, and the cell join refuses it.
        const renamed = (sheetText: (text: string) => string) => {
          const parts = partsOf(good);
          const text = (parts.get(SHEET) ?? Buffer.alloc(0)).toString("utf8");
          parts.delete(SHEET);
          parts.set("xl/worksheets/sheet1.bin", Buffer.from(sheetText(text)));
          const ct = (parts.get("[Content_Types].xml") ?? Buffer.alloc(0)).toString("utf8").replace("/xl/worksheets/sheet1.xml", "/xl/worksheets/sheet1.bin");
          parts.set("[Content_Types].xml", Buffer.from(ct));
          const rels = (parts.get("xl/_rels/workbook.xml.rels") ?? Buffer.alloc(0)).toString("utf8").replace("worksheets/sheet1.xml", "worksheets/sheet1.bin");
          parts.set("xl/_rels/workbook.xml.rels", Buffer.from(rels));
          return rezip(parts);
        };
        await refusedQuickly(renamed(text => text), "its cells could not be read consistently", "worksheet under another name");
        await refusedQuickly(renamed(text => text.replace("</worksheet>", "")), "is not well-formed XML", "truncated worksheet under another name");
        // A sheet named __proto__ is never read from the prototype.
        const proto = await upload(buildWorkbook({ sheets: [{ name: "__proto__", rows: rowsOf("-1") }] }), "proto.xlsx");
        expect(proto.status).toBe(400);
        expect(JSON.stringify(proto.body)).toContain("could not be read consistently");
      });
    });
  });
});
