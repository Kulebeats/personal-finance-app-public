/**
 * IMP-01 workbook structure, resolved strictly before SheetJS reads the file
 * (owner decision N2). It names the part behind each sheet, so the strict
 * worksheet pass checks the same part SheetJS reads. It also refuses:
 * - macro-enabled packages;
 * - more than one workbook part;
 * - duplicate relationship ids;
 * - relationship targets outside the package;
 * - format codes longer than Excel allows;
 * - an oversized shared-string table;
 * - a sheet whose part is not a worksheet by relationship and content type.
 *
 * Metadata is bounded before any tree is built (review r6 P1): the content
 * types and relationships by bytes and element count, and the workbook and
 * styles parts are parsed only for their sheet list and number formats.
 */
import { posix } from "node:path";
import { XLSX_ZIP_LIMITS } from "./zipPrecheck";
import {
  asNode, assertWellFormedPart, attributeOf, countStartTags, decodePart, listOf, parseBounded, parseSection, refuse,
  type PartBounds, type XmlNode,
} from "./xmlParts";

const WORKBOOK_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
]);
const STYLES_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml";
const SHARED_STRINGS_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml";
const WORKSHEET_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const REL_OFFICE_DOCUMENT = "/officeDocument";
const REL_STYLES = "/styles";
const REL_SHARED_STRINGS = "/sharedStrings";
const REL_WORKSHEET = "/worksheet";
/** A content type that names an XML part, validated whatever the part's name (review r6 P2). */
const XML_CONTENT_TYPE = /[+/]xml$/i;
/** Relationships and sheets per part; Excel writes a handful of each. */
const MAX_RELATIONSHIPS = 1000;
const MAX_SHEETS = 1000;
/** One override per part at most; a Default per extension. */
const MAX_CONTENT_TYPE_OVERRIDES = XLSX_ZIP_LIMITS.maxEntries;
const MAX_CONTENT_TYPE_DEFAULTS = 100;
const METADATA_PART_BYTES = 1024 * 1024;
const CONTENT_TYPES_BOUNDS: PartBounds = {
  maxBytes: METADATA_PART_BYTES, maxElements: MAX_CONTENT_TYPE_OVERRIDES + MAX_CONTENT_TYPE_DEFAULTS + 1,
};
const RELATIONSHIPS_BOUNDS: PartBounds = { maxBytes: METADATA_PART_BYTES, maxElements: MAX_RELATIONSHIPS + 1 };
const MAX_PACKAGE_ATTRIBUTE_LENGTH = 2048;
/** Longest relationship id (also a sheet's r:id). */
const MAX_RELATIONSHIP_ID_LENGTH = 255;
/** Excel caps a number format code at 255 characters and a workbook at a few hundred custom formats. */
export const MAX_FORMAT_CODE_LENGTH = 255;
const MAX_NUMBER_FORMATS = 1000;
/** Strings SheetJS materialises from the shared-string table (it is also capped at 32 MiB as a part). */
export const MAX_SHARED_STRINGS = 1_000_000;

export interface WorkbookSheetPart {
  /** Package path of the sheet's part, or undefined when its relationship is not to a part. */
  part: string | undefined;
  /** Excel hides the sheet (state hidden or veryHidden). */
  hidden: boolean;
}

interface Relationship { type: string; target: string | undefined }

/** Part names are case-insensitive in OPC; this finds the stored spelling. */
class PartIndex {
  private readonly byLowerName = new Map<string, string>();
  constructor(readonly parts: Map<string, Buffer>) {
    for (const name of parts.keys()) this.byLowerName.set(name.toLowerCase(), name);
  }
  find(name: string): string | undefined {
    return this.byLowerName.get(name.toLowerCase());
  }
  /** The stored name and bytes of a part that must exist. */
  part(name: string): [string, Buffer] {
    const stored = this.find(name) ?? refuse(`the part ${name.slice(0, 80)} is missing`);
    return [stored, this.parts.get(stored) ?? Buffer.alloc(0)];
  }
  parse(name: string, bounds: PartBounds): XmlNode {
    return parseBounded(...this.part(name), bounds);
  }
  section(name: string, section: string, child: string, limits: { maxChildren: number; exclusive: boolean }): XmlNode {
    return parseSection(...this.part(name), section, child, limits);
  }
  text(name: string): string {
    return decodePart(...this.part(name));
  }
}

/** Content types by part: an Override by part name, else a Default by extension. */
class ContentTypes {
  private readonly overrides = new Map<string, string>();
  private readonly defaults = new Map<string, string>();
  constructor(readonly overrideNodes: XmlNode[], defaultNodes: XmlNode[]) {
    for (const node of overrideNodes) {
      this.overrides.set((attributeOf(node, "PartName") ?? "").replace(/^\//, "").toLowerCase(), attributeOf(node, "ContentType") ?? "");
    }
    for (const node of defaultNodes) {
      this.defaults.set((attributeOf(node, "Extension") ?? "").toLowerCase(), attributeOf(node, "ContentType") ?? "");
    }
  }
  of(part: string): string {
    const key = part.toLowerCase();
    return this.overrides.get(key) ?? this.defaults.get(posix.extname(key).slice(1)) ?? "";
  }
}

function bounded(node: XmlNode, name: string, maxLength = MAX_PACKAGE_ATTRIBUTE_LENGTH): string {
  const value = attributeOf(node, name) ?? "";
  if (value.length > maxLength) refuse(`an ${name} attribute is longer than ${maxLength} characters`);
  return value;
}

/** A relationship target as a package path; a target above the package root is refused. */
function resolveTarget(sourcePart: string, target: string): string {
  const resolved = target.startsWith("/") ? posix.normalize(target.slice(1)) : posix.normalize(posix.join(posix.dirname(sourcePart), target));
  if (resolved === ".." || resolved.startsWith("../") || posix.isAbsolute(resolved)) refuse("a relationship points outside the file");
  return resolved;
}

/** A part's relationships by id; ids must be unique, as SheetJS and Excel would otherwise disagree. */
function relationshipsOf(index: PartIndex, sourcePart: string): Map<string, Relationship> {
  const relsName = posix.join(posix.dirname(sourcePart), "_rels", `${posix.basename(sourcePart)}.rels`);
  const byId = new Map<string, Relationship>();
  if (!index.find(relsName)) return byId;
  // Counted on the raw text before the parser builds the list (review r6 P1).
  if (countStartTags(index.text(relsName), "Relationship") > MAX_RELATIONSHIPS) refuse(`a part has more than ${MAX_RELATIONSHIPS} relationships`);
  const list = listOf(asNode(index.parse(relsName, RELATIONSHIPS_BOUNDS).Relationships).Relationship);
  for (const rel of list) {
    const id = bounded(rel, "Id", MAX_RELATIONSHIP_ID_LENGTH);
    if (byId.has(id)) refuse(`two relationships share the id ${id.slice(0, 40)}`);
    const isExternal = attributeOf(rel, "TargetMode") === "External";
    byId.set(id, { type: bounded(rel, "Type"), target: isExternal ? undefined : resolveTarget(sourcePart, bounded(rel, "Target")) });
  }
  return byId;
}

function relationshipOfType(rels: Map<string, Relationship>, suffix: string): string | undefined {
  return Array.from(rels.values()).find(rel => rel.type.endsWith(suffix))?.target;
}

/** Part names (lower case) the content types declare with a matching type. */
function declaredParts(overrides: XmlNode[], isType: (contentType: string) => boolean): string[] {
  return overrides.filter(item => isType(attributeOf(item, "ContentType") ?? ""))
    .map(item => (attributeOf(item, "PartName") ?? "").replace(/^\//, "").toLowerCase());
}

/**
 * SheetJS finds the workbook, styles and shared strings by content type,
 * Excel by relationship. Both must name the same part (or none), so SheetJS
 * never reads numbers without their formats (a 000123 reference as 123) or
 * strings from another part.
 */
function assertDeclaredAlike(overrides: XmlNode[], isType: (contentType: string) => boolean, related: string | undefined, label: string): void {
  const declared = declaredParts(overrides, isType);
  const expected = related === undefined ? [] : [related.toLowerCase()];
  if (declared.length !== expected.length || declared.some((name, i) => name !== expected[i])) {
    refuse(`its ${label} part is declared inconsistently`);
  }
}

function contentTypes(index: PartIndex): ContentTypes {
  if (!index.find("[Content_Types].xml")) refuse("it is not an .xlsx workbook");
  // Counted on the raw text before the parser builds the list (review r6 P1).
  if (countStartTags(index.text("[Content_Types].xml"), "Override") > MAX_CONTENT_TYPE_OVERRIDES) {
    refuse(`it declares more than ${MAX_CONTENT_TYPE_OVERRIDES} content-type overrides`);
  }
  const types = asNode(index.parse("[Content_Types].xml", CONTENT_TYPES_BOUNDS).Types);
  const declared = new ContentTypes(listOf(types.Override), listOf(types.Default));
  const isMacro = declared.overrideNodes.some(item => /macroEnabled/i.test(attributeOf(item, "ContentType") ?? ""))
    || Array.from(index.parts.keys()).some(name => /vbaProject\.bin$/i.test(name));
  if (isMacro) refuse("macro-enabled workbooks (.xlsm) are not accepted; save it as an .xlsx workbook first");
  return declared;
}

/** Every part declared as XML is validated, whatever its name (review r6 P2). */
function validateDeclaredXml(index: PartIndex, types: ContentTypes): void {
  for (const [name, bytes] of index.parts) {
    if (XML_CONTENT_TYPE.test(types.of(name))) assertWellFormedPart(name, bytes);
  }
}

function workbookPart(index: PartIndex, overrides: XmlNode[]): string {
  const related = relationshipOfType(relationshipsOf(index, ""), REL_OFFICE_DOCUMENT) ?? refuse("it has no workbook part");
  assertDeclaredAlike(overrides, type => WORKBOOK_TYPES.has(type), related, "workbook");
  return index.find(related) ?? refuse("it has no workbook part");
}

function checkStyles(index: PartIndex, stylesPart: string | undefined): void {
  if (!stylesPart || !index.find(stylesPart)) return;
  // Only the number formats SheetJS reads are parsed (a <dxf> may hold its own <numFmt>); the rest of the styles part
  // never becomes a tree here.
  const formats = listOf(index.section(stylesPart, "numFmts", "numFmt", { maxChildren: MAX_NUMBER_FORMATS, exclusive: false }).numFmt);
  if (formats.some(format => (attributeOf(format, "formatCode") ?? "").length > MAX_FORMAT_CODE_LENGTH)) {
    refuse("a number format is longer than Excel allows");
  }
}

function checkSharedStrings(index: PartIndex, sharedStringsPart: string | undefined): void {
  if (!sharedStringsPart || !index.find(sharedStringsPart)) return;
  // Counted on the raw text: SheetJS materialises the whole table before any cell budget applies.
  if (countStartTags(index.text(sharedStringsPart), "si") > MAX_SHARED_STRINGS) {
    refuse(`its shared-string table has more than ${MAX_SHARED_STRINGS} entries`);
  }
}

/** A sheet's part, only when its relationship and its content type both make it a worksheet (review r6 P2). */
function worksheetPart(index: PartIndex, types: ContentTypes, relationship: Relationship | undefined): string | undefined {
  if (!relationship?.type.endsWith(REL_WORKSHEET) || relationship.target === undefined) return undefined;
  const part = index.find(relationship.target);
  return part !== undefined && types.of(part) === WORKSHEET_TYPE ? part : undefined;
}

/** Each sheet's part, in workbook order (the order SheetJS lists sheet names). */
export function resolveWorkbookParts(parts: Map<string, Buffer>): WorkbookSheetPart[] {
  const index = new PartIndex(parts);
  const types = contentTypes(index);
  validateDeclaredXml(index, types);
  const workbook = workbookPart(index, types.overrideNodes);
  const rels = relationshipsOf(index, workbook);
  assertDeclaredAlike(types.overrideNodes, type => type === STYLES_TYPE, relationshipOfType(rels, REL_STYLES), "styles");
  assertDeclaredAlike(types.overrideNodes, type => type === SHARED_STRINGS_TYPE, relationshipOfType(rels, REL_SHARED_STRINGS), "shared-string");
  // Only the sheet list is parsed; defined names and the rest of the workbook part never become a tree here.
  const sheets = listOf(index.section(workbook, "sheets", "sheet", { maxChildren: MAX_SHEETS, exclusive: true }).sheet);
  if (sheets.length === 0) refuse("it has no worksheets");
  checkStyles(index, relationshipOfType(rels, REL_STYLES));
  checkSharedStrings(index, relationshipOfType(rels, REL_SHARED_STRINGS));
  return sheets.map(sheet => ({
    part: worksheetPart(index, types, rels.get(bounded(sheet, "id", MAX_RELATIONSHIP_ID_LENGTH))),
    hidden: (attributeOf(sheet, "state") ?? "visible") !== "visible",
  }));
}
