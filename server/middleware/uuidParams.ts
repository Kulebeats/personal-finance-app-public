import type { NextFunction, Request, Response, Router } from "express";
import { ValidationError } from "../core/errors";

/** Canonical 8-4-4-4-12 form, which is the only form any id column here is ever written in. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `router.param` handler: a malformed id is a client error (400 VALIDATION_ERROR), caught before
 * it can reach Postgres as an invalid uuid and surface as a 500.
 */
export function uuidParam(req: Request, _res: Response, next: NextFunction, value: string, name: string): void {
  if (UUID_PATTERN.test(value)) return next();
  next(new ValidationError(`Invalid ${name}: expected a UUID`, [{ field: name, message: "Must be a valid UUID" }]));
}

/**
 * Apply the uuid check to the named path params of existing routers. Every id column on these
 * routers is a uuid primary key; routers whose params are not uuids are deliberately not listed.
 * Applied here (not inside each router) so routers mounted directly in unit tests are unchanged.
 */
export function registerUuidParams(routers: ReadonlyArray<{ router: Router; params: readonly string[] }>): void {
  for (const { router, params } of routers) {
    for (const name of params) router.param(name, uuidParam);
  }
}
