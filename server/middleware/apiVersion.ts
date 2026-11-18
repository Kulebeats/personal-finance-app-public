/**
 * API Version Router
 *
 * Provides API versioning support with backwards compatibility.
 * Current version: v1
 *
 * Usage:
 * - New clients should use /api/v1/*
 * - Legacy clients can use /api/* (redirected to v1)
 *
 * @module middleware/apiVersion
 */

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { logger } from "../utils/logger";

// Current API version
export const CURRENT_API_VERSION = "v1";

// Routes that should NOT be versioned (health checks, auth token)
const UNVERSIONED_ROUTES = ["/health", "/healthz", "/csrf-token"];

/**
 * Creates a versioned API router.
 * Routes mounted on this router will be accessible at /api/v1/*
 */
export function createVersionedRouter(): Router {
  return Router();
}

/**
 * Middleware to redirect legacy /api/* requests to /api/v1/*
 * Logs deprecation warning for monitoring.
 */
export function legacyApiRedirect(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip if already versioned
  if (req.path.startsWith("/v1")) {
    return next();
  }

  // Skip unversioned routes
  for (const route of UNVERSIONED_ROUTES) {
    if (req.path === route || req.path.startsWith(route)) {
      return next();
    }
  }

  // Log deprecation warning (rate-limited per path)
  // logger.warn("Deprecated unversioned API call", {
  //   path: req.path,
  //   method: req.method,
  //   deprecation: "Use /api/v1/* instead of /api/*",
  // });

  // Set deprecation header
  res.setHeader("Deprecation", "true");
  res.setHeader("Sunset", "2026-12-31");
  res.setHeader("Link", `</api/v1${req.path}>; rel="successor-version"`);

  // Continue with request (don't break existing clients)
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
