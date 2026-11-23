/**
 * IMP-01: the import preview and execute bodies carry up to 5,000 rows (the
 * parse budget is 16 Mi characters of cell text) plus up to 10,000 cell
 * issues, far past the app-wide 100 kb JSON limit. These two routes parse
 * their own body, after auth and their rate limit (routes/import.ts). Every
 * other route, and any other spelling of these paths, keeps the global limit.
 */
import express, { type Request } from "express";

/** 16 Mi characters of ASCII text plus JSON keys and punctuation, with room for some multi-byte text. */
export const IMPORT_JSON_LIMIT_BYTES = 32 * 1024 * 1024;

const IMPORT_JSON_PATHS = new Set(["/api/import/preview", "/api/import/execute"]);

export const importJson = express.json({ limit: IMPORT_JSON_LIMIT_BYTES });

/** Whether the app-wide JSON parser leaves this request to `importJson`. */
export function parsesOwnJsonBody(req: Request): boolean {
  return req.method === "POST" && IMPORT_JSON_PATHS.has(req.path);
}
