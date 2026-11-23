/**
 * Merchants Module - Logo image preparation
 *
 * Turns an uploaded logo into the only bytes this server ever stores for it: a
 * freshly encoded 512x512 PNG. Nothing the user sent is written to disk as-is.
 *
 * SVG decision: SVG is accepted and RASTERISED to PNG, never stored or served
 * as SVG. A stored user SVG is a stored-XSS vector (it can carry script and is
 * rendered as a document when opened directly). Rasterising keeps the owner's
 * real workflow (their logos are SVG files) while the served file is a PNG the
 * server produced, so no user markup ever reaches a browser.
 *
 * Type is decided by content, never by the filename or the client's MIME type:
 * - raster uploads must carry JPEG/PNG/WebP magic bytes (file-type);
 * - SVG uploads must be plain (not gzip) UTF-8 vector markup that passes the
 *   content policy (merchants.svg-guard) and parses as SVG in sharp.
 * The declared MIME type only selects which check applies, and must be on the
 * allow-list (sanitizeUploadExtension) or the upload is refused.
 *
 * @module modules/merchants/logo-image
 */

import sharp from "sharp";
import { ValidationError } from "../../core/errors";
import {
  assertAllowedImageContent,
  sanitizeUploadExtension,
} from "../../core/uploads";
import { logger } from "../../utils/logger";
import { assertSvgWithinPolicy } from "./merchants.svg-guard";

/** Upload size cap enforced by multer before any decoding happens. */
export const LOGO_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Edge length of the stored square PNG. */
export const LOGO_OUTPUT_EDGE_PX = 512;

/** Decompression-bomb guard: refuse inputs that decode to more pixels. */
const LOGO_MAX_INPUT_PIXELS = 4096 * 4096;

const SVG_MIME_TYPE = "image/svg+xml";
const RASTER_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Allowed declared MIME types. Every accepted type is re-encoded to PNG, so
 * the stored extension is always ".png" whatever was uploaded.
 */
const LOGO_MIME_EXTENSION_MAP: Readonly<Record<string, string>> = {
  "image/jpeg": ".png",
  "image/png": ".png",
  "image/webp": ".png",
  [SVG_MIME_TYPE]: ".png",
};

export interface LogoUploadInput {
  buffer: Buffer;
  mimetype: string;
}

export interface PreparedLogo {
  buffer: Buffer;
  extension: string;
  sourceMimeType: string;
}

function undecodableImageError(err: unknown): ValidationError {
  logger.warn(
    "Merchant logo could not be decoded",
    undefined,
    err instanceof Error ? err : new Error(String(err)),
  );
  return new ValidationError("Invalid image. The file is corrupt or cannot be read.", [
    { field: "logo", message: "The file could not be read as an image" },
  ]);
}

/** sharp's default SVG density; an SVG's metadata size is measured at it. */
const SVG_BASE_DENSITY = 72;
const SVG_MAX_DENSITY = 2400;
const SVG_TEXT_SNIFF_BYTES = 1024;

/**
 * SVG must arrive as plain markup. librsvg also inflates gzip (SVGZ) on its
 * own, which would let a 2 MB upload expand into a far larger document, so a
 * gzip stream is refused before sharp sees it.
 */
function isPlainSvgText(buffer: Buffer): boolean {
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return false;
  }
  const head = buffer
    .subarray(0, SVG_TEXT_SNIFF_BYTES)
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  return head.startsWith("<");
}

/** Density that renders the SVG's longest edge at about the output size. */
function svgRenderDensity(width?: number, height?: number): number {
  const longest = Math.max(width ?? 0, height ?? 0);
  if (longest <= 0) {
    return SVG_BASE_DENSITY;
  }
  const density = (SVG_BASE_DENSITY * LOGO_OUTPUT_EDGE_PX) / longest;
  return Math.min(SVG_MAX_DENSITY, Math.max(1, density));
}

/** Confirm the bytes are an SVG and return the density to render it at. */
async function assertSvgContent(buffer: Buffer): Promise<number> {
  if (!isPlainSvgText(buffer)) {
    throw new ValidationError("Invalid file type", [
      { field: "logo", message: "File content is not an SVG image" },
    ]);
  }
  // Size cap and the vector-only content policy run before librsvg parses anything.
  assertSvgWithinPolicy(buffer);
  // The metadata type is inferred: sharp 0.35's typings no longer expose a
  // `sharp.Metadata` namespace member.
  const metadata = await sharp(buffer)
    .metadata()
    .catch((err: unknown) => {
      throw undecodableImageError(err);
    });
  if (metadata.format !== "svg") {
    throw new ValidationError("Invalid file type", [
      {
        field: "logo",
        message: `File content is not an SVG image (detected: ${metadata.format ?? "unknown"})`,
      },
    ]);
  }
  return svgRenderDensity(metadata.width, metadata.height);
}

async function rasterise(buffer: Buffer, density?: number): Promise<Buffer> {
  try {
    return await sharp(buffer, {
      limitInputPixels: LOGO_MAX_INPUT_PIXELS,
      ...(density === undefined ? {} : { density }),
    })
      .rotate()
      .resize(LOGO_OUTPUT_EDGE_PX, LOGO_OUTPUT_EDGE_PX, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
  } catch (err) {
    throw undecodableImageError(err);
  }
}

/**
 * Validate an uploaded logo by content and return the PNG to store.
 * Throws ValidationError (400) for a disallowed, disguised or undecodable file.
 */
export async function prepareLogoImage(
  file: LogoUploadInput,
): Promise<PreparedLogo> {
  const extension = sanitizeUploadExtension(
    file.mimetype,
    LOGO_MIME_EXTENSION_MAP,
  );

  let svgDensity: number | undefined;
  if (file.mimetype === SVG_MIME_TYPE) {
    svgDensity = await assertSvgContent(file.buffer);
  } else {
    await assertAllowedImageContent(file.buffer, RASTER_MIME_TYPES);
  }

  const buffer = await rasterise(file.buffer, svgDensity);
  return { buffer, extension, sourceMimeType: file.mimetype };
}
