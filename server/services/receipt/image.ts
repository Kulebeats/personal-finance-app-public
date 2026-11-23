/**
 * Receipt Image Processing
 *
 * Image validation, optimization, and thumbnail generation.
 *
 * @module services/receipt/image
 */

import sharp from "sharp";
import { createHash } from "crypto";
import { ValidationError } from "../../core/errors";
import { logger } from "../../utils/logger";

// Constants
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB for receipts
const MAX_IMAGE_DIMENSION = 2000; // Resize images larger than 2000px
const THUMBNAIL_SIZE = 200;

export interface ReceiptUpload {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  size: number;
}

/**
 * Calculate SHA-256 hash of image for duplicate detection
 */
export function calculateImageHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Validate uploaded file (security checks)
 */
export async function validateFile(upload: ReceiptUpload): Promise<void> {
  // Size check
  if (upload.size > MAX_FILE_SIZE) {
    throw new ValidationError(
      `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    );
  }

  // MIME type check
  if (!ALLOWED_MIME_TYPES.includes(upload.mimeType)) {
    throw new ValidationError(
      "Invalid file type. Allowed types: JPEG, PNG, WebP",
    );
  }

  // Magic byte validation using file-type
  const { fileTypeFromBuffer } = await import("file-type");
  const detected = await fileTypeFromBuffer(upload.buffer);
  if (!detected || !ALLOWED_MIME_TYPES.includes(detected.mime)) {
    throw new ValidationError(
      `Invalid file type. Detected: ${detected?.mime || "unknown"}`,
    );
  }
}

/**
 * Run an in-memory sharp decode step, turning a decode failure into a 400.
 * Only wrap steps that read from a Buffer and return a Buffer/metadata: those
 * cannot fail on disk or database I/O, so a failure here means the bytes are
 * not a decodable image. Do not wrap file writes.
 */
async function rejectUndecodable<T>(decode: () => Promise<T>): Promise<T> {
  try {
    return await decode();
  } catch (err) {
    // Pass the error as the logger's error argument: context fields other than
    // the known ones are not serialized, so it would otherwise be dropped.
    logger.warn(
      "Receipt image could not be decoded",
      undefined,
      err instanceof Error ? err : new Error(String(err)),
    );
    throw new ValidationError(
      "Invalid image. The file is corrupt or cannot be read.",
    );
  }
}

/**
 * Optimize image by resizing if dimensions exceed MAX_IMAGE_DIMENSION.
 * Returns `buffer` itself when no resize is needed (its type is unchanged);
 * a resized image is always re-encoded as JPEG. The upload service relies on
 * both to record the stored type.
 */
export async function optimizeImage(buffer: Buffer): Promise<Buffer> {
  const metadata = await rejectUndecodable(() => sharp(buffer).metadata());

  const needsResize =
    (metadata.width && metadata.width > MAX_IMAGE_DIMENSION) ||
    (metadata.height && metadata.height > MAX_IMAGE_DIMENSION);

  if (!needsResize) {
    return buffer;
  }

  return rejectUndecodable(() =>
    sharp(buffer)
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer(),
  );
}

/**
 * Generate thumbnail for receipt list view
 */
export async function generateThumbnail(buffer: Buffer): Promise<Buffer> {
  return rejectUndecodable(() =>
    sharp(buffer)
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
        fit: "cover",
        position: "top",
      })
      .jpeg({ quality: 80 })
      .toBuffer(),
  );
}

/**
 * Preprocess image for better OCR accuracy
 */
export async function preprocessForOcr(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .greyscale()
    .normalize()
    .sharpen()
    .modulate({ brightness: 1.1 })
    .toBuffer();
}
