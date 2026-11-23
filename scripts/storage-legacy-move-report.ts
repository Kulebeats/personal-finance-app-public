import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LegacyMoveReport } from "../server/core/storage/legacy-move";

const FORMAT = "legacy-move-v1";

type SavedMove = { runId: string; state: "started" | "complete" } | { keys: string[] };

function syncReportDirectory(file: string): void {
  if (process.platform === "win32") return;
  const directory = openSync(dirname(file), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

export function startLegacyMoveReport(file: string): string {
  const runId = randomUUID();
  writeFileSync(file, JSON.stringify({ format: FORMAT, state: "started", runId }) + "\n", { flag: "wx", flush: true, mode: 0o600 });
  syncReportDirectory(file);
  return runId;
}

export function finishLegacyMoveReport(file: string, runId: string, report: LegacyMoveReport): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const finished = { ...report, format: FORMAT, state: "complete", runId };
  writeFileSync(temporary, JSON.stringify(finished, null, 2) + "\n", { flag: "wx", flush: true, mode: 0o600 });
  try {
    renameSync(temporary, file);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* Keep the original rename error. */ }
    throw error;
  }
  syncReportDirectory(file);
}

export function readLegacyMoveReport(file: string): SavedMove {
  const contents = readFileSync(file, "utf8");
  if (!contents.trim()) throw new Error("Empty move report has no rollback membership");
  const saved = JSON.parse(contents) as Partial<LegacyMoveReport> & { format?: string; state?: string; runId?: string } | null;
  if (saved?.format === FORMAT && typeof saved.runId === "string" && (saved.state === "started" || saved.state === "complete")) {
    return { runId: saved.runId, state: saved.state };
  }
  if (saved?.format !== undefined || saved?.applied !== true || !Array.isArray(saved.moved)
    || !saved.moved.every(entry => typeof entry?.key === "string")) {
    throw new Error("Not an applied move report");
  }
  return { keys: saved.moved.map(entry => entry.key) };
}
