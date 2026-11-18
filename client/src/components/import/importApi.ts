/**
 * CSV import wizard API helpers.
 *
 * Both endpoints are state-changing, so they go through apiCall to pick up the
 * x-csrf-token header (raw fetch 403s in a real browser session). Unlike most
 * of the API these routes return raw JSON, not the V7 envelope — see
 * server/routes/import.ts `res.json(result)` — so the body passes through
 * unchanged.
 */
import { apiCall } from "@/lib/api";
import type { ImportMapping, ParsedData } from "./ImportWizardContext";

export interface ExecuteImportPayload {
  targetAccountId: string | null;
  strategy: "prioritize_coppercoin" | "prioritize_csv";
  mapping: ImportMapping;
  categoryMapping: Record<string, string>;
  rows: ParsedData["rows"] | undefined;
}

export interface ImportExecutionResult {
  imported: number;
  skipped: number;
  deleted: number;
}

export async function parseImportCsv(file: File): Promise<ParsedData> {
  const formData = new FormData();
  formData.append("file", file);

  return apiCall<ParsedData>("/import/parse", {
    method: "POST",
    body: formData,
  });
}

export async function executeImport(
  payload: ExecuteImportPayload,
): Promise<ImportExecutionResult> {
  return apiCall<ImportExecutionResult>("/import/execute", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
