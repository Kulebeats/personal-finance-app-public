/**
 * Merchants Module - SVG logo content policy
 *
 * SVG logos are VECTOR ONLY. librsvg decodes every embedded raster at full
 * size, outside sharp's limitInputPixels, so embedded rasters are not
 * supported at all: a raster logo is uploaded as PNG/JPEG/WebP directly.
 *
 * The policy is a deny-list over the raw bytes, case-insensitive, matching
 * anywhere (comments and CDATA included). It does not try to parse references,
 * because a text scan that interprets markup can be fooled by markup it
 * misreads. A byte scan only works if the bytes ARE the markup, so the
 * encoding is pinned first: no NUL bytes (UTF-16/32), no UTF-16/32 byte-order
 * mark, and an XML declaration may only declare UTF-8 (UTF-7 can spell
 * "<image" as "+ADw-image").
 *
 * Refused: <image, <feImage, data:, base64, comments, CDATA sections,
 * processing instructions other than a leading XML declaration, entity
 * declarations, @import, backslashes (CSS escapes can spell "url(" or
 * "data:"), numeric character references (XML resolves "&#x64;ata:" to
 * "data:" after the scan), and any url(...) that is not url(#fragment).
 * Other named entities cannot appear: declarations are refused and an
 * undeclared entity fails the parse.
 *
 * The rendered canvas is still bounded by limitInputPixels and an explicit
 * render density in merchants.logo-image.
 *
 * @module modules/merchants/svg-guard
 */

import { ValidationError } from "../../core/errors";

/** SVG uploads are capped well below the general 2 MB logo cap. */
export const SVG_MAX_UPLOAD_BYTES = 512 * 1024;

const UTF8_BOM = "\uFEFF";
/** A leading XML declaration; its encoding, if declared, must be UTF-8. */
const XML_DECLARATION = /^<\?xml\s[^?]*\?>/i;
const DECLARED_ENCODING = /encoding\s*=\s*["']([^"']*)["']/i;
const UTF8_ENCODING_NAME = /^utf-?8$/i;
const CSS_URL = /url\(([^)]*)\)?/gi;
/** Checked after the leading XML declaration is removed. */
const PROCESSING_INSTRUCTION = /<\?/;

const DENIED_CONSTRUCTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/<image/i, "SVG logos may not embed images; upload a PNG, JPEG or WebP instead"],
  [/<feimage/i, "SVG logos may not embed images; upload a PNG, JPEG or WebP instead"],
  [/data:/i, "SVG logos may not contain data: URLs"],
  [/base64/i, "SVG logos may not contain base64 content"],
  [/<!--/, "SVG logos may not contain comments; export the SVG without them"],
  [/<!\[CDATA\[/i, "SVG logos may not contain CDATA sections"],
  [/<!ENTITY/i, "SVG logos may not declare XML entities"],
  [/@import/i, "SVG logos may not import stylesheets"],
  [/\\/, "SVG logos may not contain backslash escapes"],
  // XML resolves numeric character references after this byte scan, so
  // "&#x64;ata:" would spell "data:" (and "url(" targets) past every rule.
  [/&#/, "SVG logos may not contain character references"],
];

function refuse(message: string): ValidationError {
  return new ValidationError("Invalid SVG logo", [{ field: "logo", message }]);
}

function hasUtf16Or32ByteOrderMark(buffer: Buffer): boolean {
  const first = buffer[0];
  const second = buffer[1];
  return (first === 0xfe && second === 0xff) || (first === 0xff && second === 0xfe);
}

/** Strip a UTF-8 XML declaration; refuse a declaration of any other encoding. */
function bodyAfterDeclaration(text: string): string {
  const declaration = XML_DECLARATION.exec(text);
  if (!declaration) {
    return text;
  }
  const encoding = DECLARED_ENCODING.exec(declaration[0]);
  if (encoding && !UTF8_ENCODING_NAME.test(encoding[1].trim())) {
    throw refuse("SVG logos must be UTF-8 encoded");
  }
  return text.slice(declaration[0].length);
}

function assertOnlyFragmentUrls(text: string): void {
  for (const match of text.matchAll(CSS_URL)) {
    const target = match[1].trim().replace(/^["']|["']$/g, "").trim();
    if (!target.startsWith("#")) {
      throw refuse("SVG logos may only use url(#id) references");
    }
  }
}

/** Throw ValidationError (400) unless the SVG is plain UTF-8 vector markup. */
export function assertSvgWithinPolicy(buffer: Buffer): void {
  if (buffer.length > SVG_MAX_UPLOAD_BYTES) {
    throw refuse(`SVG logos may be at most ${SVG_MAX_UPLOAD_BYTES / 1024} KB`);
  }
  if (buffer.includes(0) || hasUtf16Or32ByteOrderMark(buffer)) {
    throw refuse("SVG logos must be UTF-8 encoded");
  }

  const decoded = buffer.toString("utf8");
  const text = decoded.startsWith(UTF8_BOM) ? decoded.slice(UTF8_BOM.length) : decoded;
  for (const [pattern, message] of DENIED_CONSTRUCTS) {
    if (pattern.test(text)) {
      throw refuse(message);
    }
  }
  if (PROCESSING_INSTRUCTION.test(bodyAfterDeclaration(text))) {
    throw refuse("SVG logos may not contain processing instructions");
  }
  assertOnlyFragmentUrls(text);
}
