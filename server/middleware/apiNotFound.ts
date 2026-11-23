import type { NextFunction, Request, Response } from "express";
import { NotFoundError } from "../core/errors";

/**
 * Catch-all for `/api`. Mounted once, after every API router and before the error
 * middleware and the SPA/static fallback, so an unknown API path (any method) answers the
 * V7 JSON 404 instead of the SPA's index.html (prod) or Express's HTML "Cannot GET" (dev).
 */
export function apiNotFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError("API route"));
}
