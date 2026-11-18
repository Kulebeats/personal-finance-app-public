/**
 * Unit tests for shared upload helpers.
 *
 * @module core/__tests__/uploads
 */

import { describe, it, expect } from "vitest";
import {
  assertAllowedImageContent,
  sanitizeUploadExtension,
} from "../uploads";
import { ValidationError } from "../errors";

const MIME_EXTENSION_MAP = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
} as const;

const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];

const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("sanitizeUploadExtension", () => {
  it("returns the mapped extension for allowed mimetypes", () => {
    expect(sanitizeUploadExtension("image/png", MIME_EXTENSION_MAP)).toBe(
      ".png",
    );
    expect(sanitizeUploadExtension("image/jpeg", MIME_EXTENSION_MAP)).toBe(
      ".jpg",
    );
    expect(sanitizeUploadExtension("image/webp", MIME_EXTENSION_MAP)).toBe(
      ".webp",
    );
  });

  it("throws a 400 ValidationError for unknown mimetypes", () => {
    expect(() =>
      sanitizeUploadExtension("text/html", MIME_EXTENSION_MAP),
    ).toThrow(ValidationError);

    try {
      sanitizeUploadExtension("application/octet-stream", MIME_EXTENSION_MAP);
      expect.unreachable("expected sanitizer to reject unknown mimetype");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).statusCode).toBe(400);
      expect((error as ValidationError).fields[0].field).toBe("mimeType");
    }
  });

  it("does not resolve inherited object properties as mimetypes", () => {
    for (const key of [
      "toString",
      "constructor",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(() => sanitizeUploadExtension(key, MIME_EXTENSION_MAP)).toThrow(
        ValidationError,
      );
    }
  });
});

describe("assertAllowedImageContent", () => {
  it("accepts real image bytes for an allowed image type", async () => {
    await expect(
      assertAllowedImageContent(PNG_BUFFER, ALLOWED_IMAGE_MIMES),
    ).resolves.toBeUndefined();
  });

  it("rejects non-image bytes even when the declared mimetype is image-like", async () => {
    await expect(
      assertAllowedImageContent(
        Buffer.from("<html><script>alert(1)</script></html>"),
        ALLOWED_IMAGE_MIMES,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects real image bytes when the type is outside the allowlist", async () => {
    await expect(
      assertAllowedImageContent(PNG_BUFFER, ["image/jpeg", "image/webp"]),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
