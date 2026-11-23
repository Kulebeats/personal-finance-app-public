/**
 * Personal-data export archive (A-27): a stored (uncompressed) ZIP written by
 * the app's shared writer (server/core/zipWriter.ts), with the export's own
 * stricter name policy on top.
 *
 * Entry names must be plain relative ASCII paths, so the UTF-8 name flag is
 * never set and no name can escape the archive root. An archive the classic
 * format cannot hold (an entry or the whole file at 4 GiB or more, more than
 * 65,535 entries) is refused with a clear 413 before any byte is returned, so
 * the caller never writes a partial file. Every entry carries the writer's
 * fixed timestamp, so the same content always produces the same bytes.
 */
import { HttpError } from "../../core/errors";
import { writeZip, ZipLimitError } from "../../core/zipWriter";

export interface ArchiveEntryInput {
  name: string;
  data: Buffer;
}

/** The export is too large for a classic ZIP; nothing was written. */
export class ArchiveLimitError extends HttpError {
  readonly statusCode = 413;
  readonly code = "EXPORT_TOO_LARGE";
  constructor(detail: string) {
    super(`This export is too large to package as one file (${detail}).`);
    this.name = "ArchiveLimitError";
  }
}

/** A name the export will not store; a programming error, never user data. */
export class ArchiveNameError extends Error {
  constructor(message: string) {
    super(`Personal export archive refused: ${message}`);
    this.name = "ArchiveNameError";
  }
}

const SAFE_NAME = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function checkNames(entries: readonly ArchiveEntryInput[]): void {
  const seen = new Set<string>();
  for (const { name } of entries) {
    if (!SAFE_NAME.test(name) || name.split("/").some(part => part === "." || part === "..")) {
      throw new ArchiveNameError(`entry name ${JSON.stringify(name)} is not a plain relative ASCII path`);
    }
    if (seen.has(name)) throw new ArchiveNameError(`duplicate entry ${name}`);
    seen.add(name);
  }
}

/** The whole archive in memory; throws before returning anything it cannot represent. */
export function buildStoredZip(entries: readonly ArchiveEntryInput[]): Buffer {
  checkNames(entries);
  try {
    return writeZip(entries);
  } catch (error) {
    if (error instanceof ZipLimitError) throw new ArchiveLimitError(error.detail);
    throw error;
  }
}
