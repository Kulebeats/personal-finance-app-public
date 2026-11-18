/**
 * Authenticated, ownership-checked handler for /uploads/* files.
 *
 * SEC-327 (CWE-639): Previously `/uploads` was mounted with `express.static`,
 * so ANY caller (authenticated or not) could fetch ANY household's
 * receipts/goal-images by guessing the path. Uploads are written under
 * household-scoped paths:
 *   - uploads/goals/{householdId}/...
 *   - uploads/receipts/{householdId}/...
 *   - uploads/banners/{householdId}/...
 *   - uploads/profile-pictures/{householdId}/...
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
 * @module middleware/uploadsAuth
 */

import * as path from "path";
import { type Request, type Response } from "express";
import { logger } from "../utils/logger";

/** Absolute root of the uploads directory (matches the write paths). */
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

/**
 * Upload prefixes whose second path segment is the owning householdId.
 * Anything not under one of these prefixes is rejected.
 */
const HOUSEHOLD_SCOPED_PREFIXES = [
  "goals",
  "receipts",
  "banners",
  "profile-pictures",
] as const;

/**
 * Express handler for GET /uploads/* — authenticated and ownership-checked.
 *
 * Pre-requisites (applied as route middleware): requireAuth populates req.user;
 * householdGuard populates req.householdContext. By the time this runs both are
 * guaranteed present.
 */
export function serveUpload(req: Request, res: Response): void {
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

  res.sendFile(resolvedPath, (err) => {
    if (err) {
      // sendFile errors after headers are sent cannot be recovered.
      if (res.headersSent) {
        return;
      }
      const status =
        (err as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500;
      res.status(status).json({
        success: false,
        error: {
          code: status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
          message: status === 404 ? "File not found" : "Failed to serve file",
        },
      });
    }
  });
}
