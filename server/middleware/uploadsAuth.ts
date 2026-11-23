/**
 * Authenticated, ownership-checked handler for /uploads/* files.
 *
 * SEC-327 (CWE-639): Previously `/uploads` was mounted with `express.static`,
 * so ANY caller (authenticated or not) could fetch ANY household's
 * receipts/goal-images by guessing the path. Uploads are written under
 * household-scoped paths:
 *   - uploads/goals/{householdId}/...
 *   - uploads/banners/{householdId}/...
 *   - uploads/profile-pictures/{householdId}/...
 *   - uploads/merchant-logos/{householdId}/...  (always server-encoded PNG)
 *
 * This handler requires auth + household context (the same requireAuth +
 * householdGuard the API uses), rejects path traversal, and authorizes by
 * requiring the householdId path segment to equal the caller's household.
 *
 * Transaction attachments live under uploads/transactions/{transactionId}/...
 * and are served by a dedicated authenticated API route
 * (/api/transactions/:txId/attachments/:id/download), NOT via /uploads. This
 * handler therefore only permits the household-scoped prefixes listed above
 * and 403s anything else, so a new upload type cannot accidentally become
 * public.
 *
 * Receipts (uploads/receipts/{householdId}/...) are likewise served only by
 * /api/receipts/:id/ocr-image and /thumbnail, which read the receipt row and
 * apply its linked transaction's privacy (Rule 11). Serving them here by name
 * would let a co-member read a private receipt, and a deleted receipt's
 * leftover legacy copy; through the row, a hidden or deleted receipt is a 404.
 *
 * OPS-001: the bytes come from the ObjectStore through the storage_objects
 * manifest, which re-checks the household and the sha256. A path with no
 * manifest row is a legacy file still on the old uploads/ disk and is read
 * from there until the legacy move copies it into the store.
 *
 * @module middleware/uploadsAuth
 */

import * as path from "path";
import { type Request, type Response } from "express";
import { logger } from "../utils/logger";
import { isSafeUploadSegment, readUploadObject, UploadStorageError } from "../core/storage/upload-objects";
import { sendUploadContent } from "../core/storage/upload-response";

/** Root the logical upload names are relative to (never served directly). */
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

/**
 * Upload prefixes whose second path segment is the owning householdId.
 * Anything not under one of these prefixes is rejected.
 */
const HOUSEHOLD_SCOPED_PREFIXES = [
  "goals",
  "banners",
  "profile-pictures",
  "merchant-logos",
] as const;

/**
 * uploads/merchant-logos also holds raw files the pre-P4 route saved with the
 * client's own extension (.svg, .html, ...). Serve only the server-encoded
 * PNGs the current route writes ({uuid}.png directly under the household).
 */
const SERVER_ENCODED_MERCHANT_LOGO = /^[0-9a-f-]{36}\.png$/i;

function isServableMerchantLogo(segments: readonly string[]): boolean {
  return segments.length === 3 && SERVER_ENCODED_MERCHANT_LOGO.test(segments[2]);
}

/**
 * Express handler for GET /uploads/* — authenticated and ownership-checked.
 *
 * Pre-requisites (applied as route middleware): requireAuth populates req.user;
 * householdGuard populates req.householdContext. By the time this runs both are
 * guaranteed present.
 */
export async function serveUpload(req: Request, res: Response): Promise<void> {
  const context = req.householdContext;
  if (!context) {
    // Defensive: householdGuard should have set this or already responded.
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
    return;
  }

  // The wildcard segment after /uploads/. Express has already URL-decoded this
  // (so "%2e%2e%2f" arrives as "../"); we deliberately do NOT decode again, as
  // double-decoding can re-introduce traversal sequences.
  const requestedRelative = (req.params[0] ?? "").toString();

  // One spelling only, checked BEFORE authorization: the name authorized below
  // must be exactly the name read. A backslash is a separator on Windows and a
  // filename character on Linux, so "receipts/H/..\..\transactions\T\F" would
  // authorize household H here and resolve elsewhere later. Every segment must
  // be a plain file or directory name.
  const requestedSegments = requestedRelative.split("/");
  if (/[\\\0]/.test(requestedRelative) || !requestedSegments.every(isSafeUploadSegment)) {
    logger.warn("Blocked malformed /uploads path", {
      requestId: req.requestId,
      householdId: context.householdId.substring(0, 8) + "...",
    });
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Access denied" },
    });
    return;
  }

  // Resolve against the uploads root and confirm the result stays inside it.
  // This rejects "../" traversal and absolute-path injection.
  const resolvedPath = path.resolve(UPLOADS_ROOT, requestedRelative);
  const rootWithSep = UPLOADS_ROOT + path.sep;
  if (resolvedPath !== UPLOADS_ROOT && !resolvedPath.startsWith(rootWithSep)) {
    logger.warn("Blocked path traversal attempt on /uploads", {
      requestId: req.requestId,
      householdId: context.householdId.substring(0, 8) + "...",
    });
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Access denied" },
    });
    return;
  }

  // Derive the relative segments from the resolved path so authorization is
  // based on the real on-disk location, not the (possibly tricky) raw input.
  const relativeFromRoot = path.relative(UPLOADS_ROOT, resolvedPath);
  const segments = relativeFromRoot.split(path.sep).filter(Boolean);

  // Expected shape: {type}/{householdId}/{...rest}
  const [type, householdSegment] = segments;
  if (
    !type ||
    !HOUSEHOLD_SCOPED_PREFIXES.includes(
      type as (typeof HOUSEHOLD_SCOPED_PREFIXES)[number],
    ) ||
    !householdSegment ||
    segments.length < 3
  ) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Access denied" },
    });
    return;
  }

  // Authorization: the householdId segment must belong to the caller.
  if (householdSegment !== context.householdId) {
    logger.warn("Blocked cross-household /uploads access", {
      requestId: req.requestId,
      householdId: context.householdId.substring(0, 8) + "...",
    });
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Access denied" },
    });
    return;
  }

  if (type === "merchant-logos" && !isServableMerchantLogo(segments)) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Access denied" },
    });
    return;
  }

  const name = segments.join("/");
  try {
    const content = await readUploadObject(`/uploads/${name}`, context.householdId);
    if (!content) {
      res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "File not found" },
      });
      return;
    }
    sendUploadContent(res, content, name);
  } catch (error) {
    if (res.headersSent) return;
    const isStorage = error instanceof UploadStorageError;
    if (!isStorage) {
      logger.error("Failed to serve upload", { requestId: req.requestId }, error instanceof Error ? error : new Error(String(error)));
    }
    res.status(isStorage ? error.statusCode : 500).json({
      success: false,
      error: {
        code: isStorage ? error.code : "INTERNAL_ERROR",
        message: isStorage ? error.message : "Failed to serve file",
      },
    });
  }
}
