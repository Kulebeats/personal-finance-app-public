/**
 * IMP-01 downloadable import templates (CSV and .xlsx), built from the shared
 * template definition so the importer, the wizard and the files agree.
 */
import { TEMPLATE_COLUMNS, TEMPLATE_INSTRUCTIONS } from "@shared/import-template";
import { calendarDateToSerial } from "./xlsx/cells";
import { writeZip } from "../../core/zipWriter";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const STYLE_DATE = 1;
const STYLE_HEADER = 2;
/** Text format (@): a typed 000123 stays text, never the number 123 (review r4 P2). */
export const STYLE_TEXT = 3;

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function columnLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function textCell(reference: string, text: string, style = 0): string {
  const styleAttribute = style ? ` s="${style}"` : "";
  return `<c r="${reference}" t="inlineStr"${styleAttribute}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function exampleCell(reference: string, field: string, example: string): string {
  if (!example) return "";
  if (field === "date") return `<c r="${reference}" s="${STYLE_DATE}"><v>${calendarDateToSerial(example)}</v></c>`;
  if (field === "amount") return `<c r="${reference}"><v>${example}</v></c>`;
  return textCell(reference, example);
}

function worksheet(rows: string[], widths: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${MAIN_NS}">${widths}<sheetData>${rows.join("")}</sheetData></worksheet>`;
}

function transactionsSheet(): string {
  const headers = TEMPLATE_COLUMNS.map((column, index) => textCell(`${columnLetter(index)}1`, column.header, STYLE_HEADER));
  const example = TEMPLATE_COLUMNS.map((column, index) => exampleCell(`${columnLetter(index)}2`, column.field, column.example));
  const widths = `<cols>${TEMPLATE_COLUMNS.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="22" customWidth="1"${
    column.field === "reference" ? ` style="${STYLE_TEXT}"` : ""}/>`).join("")}</cols>`;
  return worksheet([`<row r="1">${headers.join("")}</row>`, `<row r="2">${example.join("")}</row>`], widths);
}

function instructionsSheet(): string {
  const rows = TEMPLATE_INSTRUCTIONS.map((line, index) =>
    `<row r="${index + 1}">${textCell(`A${index + 1}`, line, index === 0 ? STYLE_HEADER : 0)}</row>`);
  return worksheet(rows, `<cols><col min="1" max="1" width="120" customWidth="1"/></cols>`);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="Transactions" sheetId="1" r:id="rId1"/><sheet name="Instructions" sheetId="2" r:id="rId2"/></sheets></workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;

// Style 1: built-in date format 14; style 2: bold header; style 3: text (built-in format 49).
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${MAIN_NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function buildXlsxTemplate(): Buffer {
  const part = (name: string, xml: string) => ({ name, data: Buffer.from(xml, "utf8") });
  return writeZip([
    part("[Content_Types].xml", CONTENT_TYPES),
    part("_rels/.rels", ROOT_RELS),
    part("xl/workbook.xml", WORKBOOK),
    part("xl/_rels/workbook.xml.rels", WORKBOOK_RELS),
    part("xl/styles.xml", STYLES),
    part("xl/worksheets/sheet1.xml", transactionsSheet()),
    part("xl/worksheets/sheet2.xml", instructionsSheet()),
  ]);
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
}

export function buildCsvTemplate(): string {
  const header = TEMPLATE_COLUMNS.map(column => csvField(column.header)).join(",");
  const example = TEMPLATE_COLUMNS.map(column => csvField(column.example)).join(",");
  return `${header}\r\n${example}\r\n`;
}
