/**
 * IMP-01 strict XML layer (owner decision N2), on fast-xml-parser.
 *
 * Every XML part of the upload is validated as well-formed BEFORE SheetJS
 * reads the file, so a truncated or damaged part is a 400, never rows that
 * SheetJS silently drops. A part that declares a DTD or entities is refused,
 * so entity expansion can never run, and entity processing is off in the
 * parser too: this layer reads only structure, addresses, types and raw
 * values, never display text.
 */
import { XMLParser, XMLValidator, type X2jOptions } from "fast-xml-parser";
import { ValidationError } from "../../../core/errors";

/** Elements read as lists even when a part holds only one. */
const LIST_ELEMENTS = new Set(["row", "c", "mergeCell", "sheet", "Relationship", "Override", "Default", "numFmt"]);

const PARSER_OPTIONS: X2jOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
  htmlEntities: false,
  // Inline and formula content is never read here; keeping it unparsed keeps the node count to rows and cells.
  stopNodes: ["*.is", "*.f", "*.extLst"],
  isArray: (name, _path, _isLeaf, isAttribute) => !isAttribute && LIST_ELEMENTS.has(name),
};

export type XmlNode = Record<string, unknown>;

export const refuse = (reason: string): never => {
  throw new ValidationError(`This Excel file cannot be imported: ${reason}`);
};

const isXmlPart = (name: string) => /\.(xml|rels|vml)$/i.test(name);

/** The part's text, checked for a DTD; UTF-8 is the only encoding OOXML parts use here. */
function partText(name: string, bytes: Buffer): string {
  const text = bytes.toString("utf8").replace(/^﻿/, "");
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) refuse(`${name.slice(0, 80)} declares a DTD or entities`);
  // Excel never writes comments or processing instructions inside a part, and SheetJS reads markup inside a
  // comment as data (review r1 P2), so both are refused; only the leading XML declaration is allowed.
  if (text.includes("<!--") || /<\?(?!xml[\s?])/.test(text) || text.indexOf("<?xml", 1) > 0) {
    refuse(`${name.slice(0, 80)} contains XML comments or processing instructions; open the file in Excel and save it again`);
  }
  return text;
}

/** Parts already validated in this process; the verified part buffers are never mutated. */
const validatedParts = new WeakSet<Buffer>();

/** A part's text, validated as well-formed XML once, whatever its name (review r6 P2). */
function validatedText(name: string, bytes: Buffer): string {
  const text = partText(name, bytes);
  if (validatedParts.has(bytes)) return text;
  const result = XMLValidator.validate(text);
  if (result !== true) {
    refuse(`the part ${name.slice(0, 80)} is not well-formed XML (line ${result.err.line}): it is damaged or incomplete`);
  }
  validatedParts.add(bytes);
  return text;
}

export function assertWellFormedPart(name: string, bytes: Buffer): void {
  validatedText(name, bytes);
}

/**
 * Refuse the upload unless every part named as XML is well-formed. Parts
 * declared as XML under another name, and every part this reader parses, are
 * validated as well (workbookParts.ts, decodePart, parseBounded).
 */
export function assertWellFormedParts(parts: Map<string, Buffer>): void {
  for (const [name, bytes] of parts) {
    if (isXmlPart(name)) validatedText(name, bytes);
  }
}

/** A validated part's text parsed to nodes. */
export function parseText(text: string): XmlNode {
  const parsed: unknown = new XMLParser(PARSER_OPTIONS).parse(text);
  return asNode(parsed);
}

/** A start tag's attributes, each value quoted, then optional space. */
const QUOTED_ATTRIBUTES = String.raw`(?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*`;

export interface PartBounds {
  maxBytes: number;
  maxElements: number;
}

/** Metadata text with no CDATA, so tags counted and sections cut from it are real elements. */
function metadataText(name: string, bytes: Buffer): string {
  const text = validatedText(name, bytes);
  if (text.includes("<![CDATA[")) refuse(`${name.slice(0, 80)} contains CDATA, which Excel never writes there`);
  return text;
}

/**
 * A metadata part parsed to nodes, after its size and element count are
 * checked on the raw text, before the parser builds any tree (review r6 P1).
 */
export function parseBounded(name: string, bytes: Buffer, bounds: PartBounds): XmlNode {
  if (bytes.length > bounds.maxBytes) refuse(`the part ${name.slice(0, 80)} is larger than ${bounds.maxBytes} bytes`);
  const text = metadataText(name, bytes);
  if (countAllStartTags(text) > bounds.maxElements) refuse(`the part ${name.slice(0, 80)} has more than ${bounds.maxElements} elements`);
  return parseText(text);
}

/**
 * One section of a large metadata part (the workbook's sheet list, the
 * styles' number formats), parsed alone so the rest of the part is never
 * built into a tree. Its child count is checked on the raw text first.
 *
 * The part is well-formed, with no CDATA or comments, so the cut is exact:
 * attributes are matched as quoted values (a quoted ">" cannot end the start
 * tag), and "<" cannot appear in an attribute, so the first closing tag ends
 * the section. With `exclusive`, the child element appears nowhere else in
 * the part, and the cut must hold every one of them.
 */
export function parseSection(name: string, bytes: Buffer, section: string, child: string,
  limits: { maxChildren: number; exclusive: boolean }): XmlNode {
  const text = metadataText(name, bytes);
  if (countStartTags(text, section) > 1) refuse("an element that may appear only once appears twice");
  const match = new RegExp(`<(?:[\\w.-]+:)?${section}${QUOTED_ATTRIBUTES}(?:/>|>[\\s\\S]*?</(?:[\\w.-]+:)?${section}\\s*>)`).exec(text);
  const cut = match?.[0] ?? "";
  const children = countStartTags(cut, child);
  if (children > limits.maxChildren) refuse(`the part ${name.slice(0, 80)} has more than ${limits.maxChildren} ${child} elements`);
  if (limits.exclusive && countStartTags(text, child) !== children) refuse(`the part ${name.slice(0, 80)} could not be read consistently`);
  if (!cut) return {};
  if (countAllStartTags(cut) > limits.maxChildren * 4 + 1) refuse(`the part ${name.slice(0, 80)} has too many elements`);
  try {
    return asNode(parseText(cut)[section]);
  } catch {
    return refuse(`the part ${name.slice(0, 80)} could not be read consistently`);
  }
}

export function parsePart(name: string, bytes: Buffer): XmlNode {
  return parseText(validatedText(name, bytes));
}

/** An element as a node; an empty element without attributes parses as "", which reads as no children. */
export function asNode(value: unknown): XmlNode {
  if (Array.isArray(value)) return refuse("an element that may appear only once appears twice");
  return typeof value === "object" && value !== null ? value as XmlNode : {};
}

export function listOf(value: unknown): XmlNode[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(asNode);
}

/** An element's text content, or undefined when the element is absent. */
export function textOf(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return refuse("an element that may appear only once appears twice");
  if (typeof value === "string") return value;
  const text = asNode(value)["#text"];
  return typeof text === "string" ? text : "";
}

export function attributeOf(node: XmlNode, name: string): string | undefined {
  const value = node[`@_${name}`];
  return typeof value === "string" ? value : undefined;
}

/** Occurrences of a start tag (any namespace prefix), counted on the raw text before it is parsed. */
export function countStartTags(text: string, tag: string): number {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${tag}[\\s/>]`, "g");
  let count = 0;
  while (pattern.exec(text)) count += 1;
  return count;
}

/**
 * Every start tag, whatever its name's script: in well-formed XML without
 * CDATA, a "<" not followed by "/", "!" or "?" opens an element (final pass P1).
 */
export function countAllStartTags(text: string): number {
  const pattern = /<[^/!?]/g;
  let count = 0;
  while (pattern.exec(text)) count += 1;
  return count;
}

/** A part's text, validated as well-formed XML (cached), for the strict worksheet pass. */
export function decodePart(name: string, bytes: Buffer): string {
  return validatedText(name, bytes);
}
