/**
 * A tiny synthetic .xlsx for import e2e specs, laid out like the downloadable
 * template (server/services/import/template.ts): one "Transactions" sheet,
 * the template's header row, inline-string text, real date cells (built-in
 * format 14) and plain number amounts. Built with the importer's own ZIP
 * writer, so nothing here is real data and no file is checked in.
 */
import { TEMPLATE_COLUMNS, type TemplateMappingField } from "../../shared/import-template";
import { calendarDateToSerial } from "../../server/services/import/xlsx/cells";
import { writeZip } from "../../server/core/zipWriter";

/** One row: values by template field; missing fields stay empty cells. */
export type ImportRow = Partial<Record<TemplateMappingField, string>>;

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const DATE_STYLE = 1;

const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const column = (index: number): string => String.fromCharCode(65 + index);
const text = (ref: string, value: string): string =>
  `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;

function cell(ref: string, field: TemplateMappingField, value: string | undefined): string {
  if (!value) return "";
  if (field === "date") return `<c r="${ref}" s="${DATE_STYLE}"><v>${calendarDateToSerial(value)}</v></c>`;
  if (field === "amount" || field === "debit" || field === "credit") return `<c r="${ref}"><v>${value}</v></c>`;
  return text(ref, value);
}

function sheetXml(rows: readonly ImportRow[]): string {
  const header = TEMPLATE_COLUMNS.map((col, index) => text(`${column(index)}1`, col.header)).join("");
  const body = rows.map((row, r) => `<row r="${r + 2}">${TEMPLATE_COLUMNS
    .map((col, index) => cell(`${column(index)}${r + 2}`, col.field, row[col.field])).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${MAIN_NS}"><sheetData><row r="1">${header}</row>${body}</sheetData></worksheet>`;
}

export function buildImportWorkbook(rows: readonly ImportRow[]): Buffer {
  const part = (name: string, xml: string) => ({ name, data: Buffer.from(xml, "utf8"), deflate: true });
  return writeZip([
    part("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    part("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    part("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="Transactions" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    part("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`),
    part("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${MAIN_NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`),
    part("xl/worksheets/sheet1.xml", sheetXml(rows)),
  ]);
}
