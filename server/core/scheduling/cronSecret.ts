import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../errors";
import { logger } from "../../utils/logger";

/**
 * CRON_SECRET check for the HTTP cron door (OPS-003).
 *
 * Both values are hashed to a fixed length before `timingSafeEqual`, so the
 * comparison takes the same time whatever the guess and leaks no length. There
 * is no development bypass: without a configured secret the door stays shut
 * (every request is a 403). Production refuses to boot without it
 * (utils/validateEnv.ts, OPS-003); in dev/test a missing secret only shuts the door.
 */
const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

export function cronSecretMatches(provided: unknown, expected: string | undefined): boolean {
  if (!expected || typeof provided !== "string" || provided.length === 0) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

export function verifyCronSecret(req: Request, _res: Response, next: NextFunction): void {
  if (!cronSecretMatches(req.headers["x-cron-secret"], process.env.CRON_SECRET)) {
    next(new ForbiddenError("Invalid cron secret"));
    return;
  }
  next();
}

/**
 * Log one startup warning when the HTTP cron door is mounted without a secret.
 * Returns whether the door is shut for that reason.
 */
export function warnIfCronSecretMissing(env: Readonly<Record<string, unknown>> = process.env): boolean {
  if (env.CRON_SECRET) return false;
  logger.warn("CRON_SECRET is not set; every /api/cron request will be refused", { route: "/api/cron" });
  return true;
}
