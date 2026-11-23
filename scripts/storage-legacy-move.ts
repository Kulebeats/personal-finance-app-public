/**
 * Operator CLI for the legacy upload move (OPS-001). Run with the app stopped.
 *
 *   npx tsx scripts/storage-legacy-move.ts                      dry run: what would move
 *   npx tsx scripts/storage-legacy-move.ts --apply --report <f>  move, writing the move manifest to <f>
 *   npx tsx scripts/storage-legacy-move.ts --apply --resume --report <f>  continue an interrupted move
 *   npx tsx scripts/storage-legacy-move.ts --rollback <f>        undo the move recorded in <f>
 *
 * The report holds logical names, households, sha256 and sizes, no file
 * contents and no credentials. Legacy files under uploads/ are never deleted.
 */
import { writeFileSync } from "node:fs";
import { moveLegacyUploads, rollbackLegacyMove, rollbackLegacyMoveRun, type LegacyMoveReport } from "../server/core/storage/legacy-move";
import { pool } from "../server/db";
import { finishLegacyMoveReport, readLegacyMoveReport, startLegacyMoveReport } from "./storage-legacy-move-report";

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a file path`);
  return value;
}

function summary(report: LegacyMoveReport): Record<string, number | boolean> {
  return { applied: report.applied, moved: report.moved.length, pending: report.pending.length,
    alreadyStored: report.alreadyStored, missing: report.missing.length, refused: report.refused.length };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const resume = process.argv.includes("--resume");
  const rollbackFile = argument("--rollback");
  if (rollbackFile) {
    if (apply || resume) throw new Error("Use --rollback separately from --apply or --resume");
    const report = readLegacyMoveReport(rollbackFile);
    const result = "runId" in report ? await rollbackLegacyMoveRun(report.runId) : await rollbackLegacyMove(report.keys);
    console.log(JSON.stringify(result));
    // An object whose manifest row is already gone: rerun with the same report.
    if (result.pendingCleanup.length) process.exitCode = 1;
    return;
  }
  const reportFile = argument("--report");
  if (resume && !apply) throw new Error("--resume needs --apply and --report <file>");
  if (!apply) {
    const report = await moveLegacyUploads({ apply: false });
    if (reportFile) writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify(summary(report)));
    return;
  }
  if (!reportFile) throw new Error("--apply needs --report <file> so the move can be rolled back");
  let runId: string;
  if (resume) {
    const report = readLegacyMoveReport(reportFile);
    if (!("runId" in report) || report.state !== "started") throw new Error("Use an interrupted move report with --resume");
    runId = report.runId;
  } else {
    runId = startLegacyMoveReport(reportFile);
  }
  const report = await moveLegacyUploads({ apply: true, runId });
  finishLegacyMoveReport(reportFile, runId, report);
  console.log(JSON.stringify(summary(report)));
}

main()
  .catch((error: unknown) => {
    console.error(`Legacy upload move failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
