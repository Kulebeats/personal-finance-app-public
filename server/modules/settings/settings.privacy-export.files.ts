/**
 * Personal-data export files (R07.1, AH-08).
 *
 * Files live outside `uploads/`, so the `/uploads/*` static route can never
 * serve them; the only way out is the authenticated download handler. The
 * path is derived from the export id alone (validated as a UUID) and the
 * export's stored format, never from request input, and files are written
 * owner-read-only and never overwritten. Version 1 exports are `<id>.json`;
 * version 2 exports (A-27) are `<id>.zip`.
 */
// The shared fs.promises object (not a namespace binding), so a test can make an
// unlink fail without relying on platform file permissions.
import fs from "fs/promises";
import * as path from "path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_MODE = 0o600;

export type PersonalExportFileFormat = "json" | "zip";
const FILE_FORMATS: readonly PersonalExportFileFormat[] = ["json", "zip"];

export function isPersonalExportFileFormat(value: unknown): value is PersonalExportFileFormat {
  return typeof value === "string" && (FILE_FORMATS as readonly string[]).includes(value);
}

/** Root directory; PERSONAL_EXPORT_DIR overrides the default. */
export function personalExportRoot(): string {
  const configured = process.env.PERSONAL_EXPORT_DIR;
  return path.resolve(configured && configured.trim() ? configured : path.join(process.cwd(), "private-exports", "personal-data"));
}

function exportFilePath(exportId: string, format: PersonalExportFileFormat): string {
  if (!UUID.test(exportId)) throw new Error("Invalid export id");
  if (!isPersonalExportFileFormat(format)) throw new Error("Invalid export file format");
  return path.join(personalExportRoot(), `${exportId.toLowerCase()}.${format}`);
}

export async function writePersonalExportFile(
  exportId: string, bytes: Buffer, format: PersonalExportFileFormat = "json",
): Promise<void> {
  const target = exportFilePath(exportId, format);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, bytes, { flag: "wx", mode: FILE_MODE });
}

function exportIdOf(name: string): string | null {
  const format = FILE_FORMATS.find(candidate => name.endsWith(`.${candidate}`));
  const exportId = format ? name.slice(0, -(format.length + 1)) : "";
  return format && UUID.test(exportId) ? exportId.toLowerCase() : null;
}

/**
 * Export files in the root (`<uuid>.json` or `<uuid>.zip` only), one entry per
 * export with its newest last-modified time; none when the root is missing.
 */
export async function listPersonalExportFiles(): Promise<{ exportId: string; modifiedAt: Date }[]> {
  let names: string[];
  try {
    names = await fs.readdir(personalExportRoot());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files = new Map<string, Date>();
  for (const name of names) {
    const exportId = exportIdOf(name);
    if (!exportId) continue;
    try {
      const stats = await fs.stat(path.join(personalExportRoot(), name));
      const seen = files.get(exportId);
      if (stats.isFile() && (!seen || stats.mtime > seen)) files.set(exportId, stats.mtime);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return [...files].map(([exportId, modifiedAt]) => ({ exportId, modifiedAt }));
}

export async function readPersonalExportFile(
  exportId: string, format: PersonalExportFileFormat = "json",
): Promise<Buffer> {
  return fs.readFile(exportFilePath(exportId, format));
}

/** Remove an export's file in every format; an already-missing file is not an error. */
export async function removePersonalExportFile(exportId: string): Promise<void> {
  for (const format of FILE_FORMATS) {
    try {
      await fs.unlink(exportFilePath(exportId, format));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
