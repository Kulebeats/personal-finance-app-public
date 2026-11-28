/**
 * API version helpers
 *
 * API versioning has NOT been introduced. The API is served at `/api/*` only;
 * there is no `/api/v1/*` alias (it answers a JSON 404), nothing is deprecated
 * and no sunset is planned. If versioning is introduced later, add the alias
 * first and update `docs/api/openapi.yaml` with it.
 *
 * @module middleware/apiVersion
 */

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";

// Current API version
export const CURRENT_API_VERSION = "v1";

/**
 * Creates a versioned API router.
 * Unused: no /api/v1 mount exists.
 */
export function createVersionedRouter(): Router {
  return Router();
}

/**
 * Pass-through kept so server/routes.ts can keep mounting it.
 *
 * It used to send Deprecation, Sunset and a /api/v1 successor Link on every
 * /api/* response. Versioning has not been introduced and /api/v1 does not
 * exist, so those headers were false and are no longer sent (NEW-33).
 */
export function legacyApiRedirect(
  _req: Request,
  _res: Response,
  next: NextFunction
): void {
  next();
}

/**
 * Get API version from request path or header.
 */
export function getApiVersion(req: Request): string {
  // Check path for version
  const pathMatch = req.path.match(/^\/v(\d+)/);
  if (pathMatch) {
    return `v${pathMatch[1]}`;
  }

  // Check header for version
  const headerVersion = req.header("X-API-Version");
  if (headerVersion) {
    return headerVersion;
  }

  // Default to current version
  return CURRENT_API_VERSION;
}

/**
 * Middleware to set API version info on response.
 */
export function apiVersionHeaders(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader("X-API-Version", CURRENT_API_VERSION);
  next();
}
