/**
 * Shared upload helpers.
 *
 * Keep file-extension and content checks in one place so stored-XSS hardening is
 * not reimplemented differently by each upload controller.
 *
 * @module core/uploads
 */

import { ValidationError } from "./errors";

/**
 * Derive the on-disk file extension for an upload solely from its validated
 * mimetype.
 *
 * Never use the attacker-controlled original filename for the stored extension.
 * A multipart part can declare an allowed image mimetype while naming itself
 * "evil.html"; if that extension reaches disk, the authenticated uploads
 * handler may serve it as HTML.
 */
export function sanitizeUploadExtension(
  mimetype: string,
  extensionMap: Readonly<Record<string, string>>,
): string {
  const ext = Object.prototype.hasOwnProperty.call(extensionMap, mimetype)
    ? extensionMap[mimetype]
    : undefined;

  if (!ext) {
    throw new ValidationError("Invalid file type", [
      {
        field: "mimeType",
        message: `Allowed types: ${Object.keys(extensionMap).join(", ")}`,
      },
    ]);
  }

  return ext;
}

/**
 * Assert that a buffer's real content type, detected from magic bytes, is one of
 * the allowed image types.
 */
export async function assertAllowedImageContent(
  buffer: Buffer,
  allowedMimeTypes: readonly string[],
): Promise<void> {
  const { fileTypeFromBuffer } = await import("file-type");
  const detected = await fileTypeFromBuffer(buffer);

  if (!detected || !allowedMimeTypes.includes(detected.mime)) {
    throw new ValidationError("Invalid file type", [
      {
        field: "file",
        message: `File content must be one of: ${allowedMimeTypes.join(", ")} (detected: ${
          detected?.mime ?? "unknown"
        })`,
      },
    ]);
  }
}
