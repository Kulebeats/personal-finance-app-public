/**
 * Personal-data export storage readiness (R07.1, AH-08).
 *
 * The export directory (PERSONAL_EXPORT_DIR) must exist or be creatable, be
 * writable by the app user, and sit outside `uploads/` so `/uploads/*` can
 * never serve it. Boot logs a clear error when it is not; the app still starts
 * and POST /privacy/export answers 503 EXPORT_STORAGE_UNAVAILABLE instead of a
 * generic 500. Nothing is written to the database before the check passes.
 */
import { constants as fsConstants } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { HttpError } from "../../core/errors";
import { logger } from "../../utils/logger";
import { personalExportRoot } from "./settings.privacy-export.files";

const DIRECTORY_MODE = 0o700;
/** Write failures that mean the store is unusable, not that this export is bad. */
const STORAGE_WRITE_ERRNO = new Set(["EACCES", "EPERM", "EROFS", "ENOSPC", "EDQUOT", "ENOTDIR", "ENOENT"]);

export class ExportStorageUnavailableError extends HttpError {
  readonly statusCode = 503;
  readonly code = "EXPORT_STORAGE_UNAVAILABLE";
  constructor() { super("Data exports are temporarily unavailable. Please try again later."); }
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Why the export directory is unusable, or null when it is ready. */
export async function personalExportStorageProblem(): Promise<string | null> {
  const root = personalExportRoot();
  if (isInside(root, path.resolve(process.cwd(), "uploads"))) {
    return "PERSONAL_EXPORT_DIR is inside uploads/, which /uploads/* serves";
  }
  try {
    await fs.mkdir(root, { recursive: true, mode: DIRECTORY_MODE });
    await fs.access(root, fsConstants.W_OK | fsConstants.X_OK);
    return null;
  } catch (error) {
    return `cannot create or write the directory (${(error as NodeJS.ErrnoException).code ?? "unknown error"})`;
  }
}

/** Boot: log a clear operator error when exports cannot work. Never throws. */
export async function checkPersonalExportStorageAtBoot(): Promise<boolean> {
  try {
    const problem = await personalExportStorageProblem();
    if (problem) {
      logger.error("Personal-data exports are unavailable: set PERSONAL_EXPORT_DIR to a persistent directory the app user owns (mode 0700)",
        { root: personalExportRoot(), problem });
    }
    return problem === null;
  } catch (error) {
    logger.error("Personal-data export storage check failed", {}, error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

/** Request path: refuse before any database work when the store is unusable. */
export async function assertPersonalExportStorage(): Promise<void> {
  const problem = await personalExportStorageProblem();
  if (!problem) return;
  logger.error("Personal-data export refused: storage unavailable", { root: personalExportRoot(), problem });
  throw new ExportStorageUnavailableError();
}

/** A file write that failed for a storage reason becomes the same 503; anything else is unchanged. */
export function asStorageFailure(error: unknown): unknown {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (!code || !STORAGE_WRITE_ERRNO.has(code)) return error;
  logger.error("Personal-data export file write failed", { root: personalExportRoot(), code });
  return new ExportStorageUnavailableError();
}
