/**
 * CSV import wizard API helpers.
 *
 * All three endpoints are POSTs, so they go through apiCall to pick up the
 * x-csrf-token header (raw fetch 403s in a real browser session). Unlike most
 * of the API these routes return raw JSON, not the V7 envelope — see
 * server/routes/import.ts `res.json(result)` — so the body passes through
 * unchanged.
 */
import { apiCall } from "@/lib/api";
import type { ImportMapping, ParsedData } from "./ImportWizardContext";
import type { ImportDateFormat } from "@shared/import-date";

export type ImportStrategy = "prioritize_coppercoin" | "prioritize_csv";

export interface ImportPreviewPayload {
  targetAccountId: string | null;
  strategy: ImportStrategy;
  mapping: ImportMapping;
  dateFormat?: ImportDateFormat;
  categoryMapping: Record<string, string>;
  rows: ParsedData["rows"] | undefined;
  /** Excel cell issues from /parse, beside the rows: a mapped one is a row error. */
  cellIssues?: ParsedData["cellIssues"];
  /** Leading-zero displays of the column mapped as Reference only (the server refuses any other). */
  referenceDisplays?: ParsedData["referenceDisplays"];
}

/** The Excel displays the Reference reads: those of the column mapped as Reference, none when it is not mapped. */
export function referenceDisplaysFor(parsedData: ParsedData | null | undefined, mapping: ImportMapping): NonNullable<ParsedData["referenceDisplays"]> {
  const column = mapping.reference;
  if (!column) return [];
  return (parsedData?.referenceDisplays ?? []).filter(display => display.column === column);
}

/** A-02: a row the preview showed a "CSV wins" import removing, at the version the user reviewed. */
export interface ReviewedRemoval { id: string; version: string }

/** A-01: a duplicate candidate the user chose to import, naming the ledger row it was shown against. */
export interface CandidatePostDecision { ordinal: number; candidateId: string }

export interface ExecuteImportPayload extends ImportPreviewPayload {
  batchId: string;
  skipRowOrdinals: number[];
  reviewedRemovals: ReviewedRemoval[];
  postRows: CandidatePostDecision[];
  /** R2-01: skipped candidates, each naming the ledger row it was shown against. */
  skipRows: CandidatePostDecision[];
  /** R2 P2: the account currency the preview showed. */
  previewCurrency?: string;
  fileName?: string;
}

/** Mirrors server/services/import/types.ts ExecuteImportResult. */
export interface ImportExecutionResult {
  importId: string;
  replayed: boolean;
  imported: number;
  duplicate: number;
  skipped: number;
  failed: number;
  deleted: number;
}

export type ImportPreviewStatus = "new" | "duplicate" | "candidate" | "conflict";

/** Mirrors server/services/import/preview.ts ImportPreviewRow. */
export interface ImportPreviewRow {
  ordinal: number;
  date: string;
  type: "income" | "expense";
  amount: string;
  merchant: string;
  notes: string | null;
  reference: string | null;
  status: ImportPreviewStatus;
  /** Conflicts with an earlier row of this file that has the same reference but different content. */
  repeatsOrdinal?: number;
  candidate?: { id: string; name: string; date: string; amount: string; reason: "legacy_import" | "same_merchant" | "same_date_amount" };
}

export interface ImportPreviewResult {
  identityVersion: string;
  fingerprint: string;
  dateFormat: ImportDateFormat;
  strategy: ImportStrategy;
  rows: ImportPreviewRow[];
  errors: Array<{ rowIndex: number; field: string; reason: string; value?: string }>;
  counts: Record<ImportPreviewStatus | "failed", number>;
  /** Mirrors server/services/import/overwrite.ts OverwriteRemoval: what a "CSV wins" import removes. */
  removals: Array<ReviewedRemoval & { date: string; name: string; type: string; amount: { amount: string; currency: string } }>;
  /** R2 P2: the account currency the preview's amounts are in. */
  accountCurrency: string;
}

/** IMP-01 downloadable templates (GET, session cookie; no CSRF token needed). */
export const IMPORT_TEMPLATE_URLS = {
  csv: "/api/import/template.csv",
  xlsx: "/api/import/template.xlsx",
} as const;

/** Parses a CSV or .xlsx upload; `sheet` picks an Excel sheet (default: the first). */
export async function parseImportCsv(file: File, sheet?: string): Promise<ParsedData> {
  const formData = new FormData();
  formData.append("file", file);
  if (sheet) formData.append("sheet", sheet);

  return apiCall<ParsedData>("/import/parse", {
    method: "POST",
    body: formData,
  });
}

export async function previewImport(payload: ImportPreviewPayload): Promise<ImportPreviewResult> {
  return apiCall<ImportPreviewResult>("/import/preview", {
    method: "POST",
    body: JSON.stringify(payload),
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
