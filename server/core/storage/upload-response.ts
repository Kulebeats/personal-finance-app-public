/**
 * Send a stored upload over HTTP (OPS-001). The bytes come from
 * `readUploadObject`, already household- and checksum-checked; this only sets
 * the type and writes them. A legacy file has no recorded media type, so its
 * extension decides, as `res.sendFile` did before.
 *
 * @module core/storage/upload-response
 */
import * as path from "node:path";
import type { Response } from "express";
import type { UploadObjectContent } from "./upload-objects";

export function sendUploadContent(res: Response, content: UploadObjectContent, name: string, contentType?: string): void {
  if (contentType) res.setHeader("Content-Type", contentType);
  else if (content.mediaType) res.type(content.mediaType);
  else res.type(path.extname(name) || "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (content.sha256) res.setHeader("ETag", `"${content.sha256}"`);
  res.send(content.bytes);
}
