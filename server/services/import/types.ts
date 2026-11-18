/**
 * Shared types for the CSV import pipeline.
 *
 * Extracted from the former single-file `services/ImportService.ts` (759 LOC)
 * as part of the Rule 2 LOC burn-down. Behaviour is unchanged.
 */
import type { Money } from "../../core/money";

export interface ImportMapping {
  date: string;
  amount: string;
  merchant?: string;
  category?: string;
  account?: string;
  description?: string;
  notes?: string;
  tags?: string;
}

export interface ParsedImportRow {
  rowIndex: number;
  date: Date;
  dateString: string;
  signedAmount: Money;
  amount: Money;
  type: "income" | "expense";
  merchantName: string;
  categoryName?: string;
  accountName?: string;
  notes?: string;
  raw: Record<string, string>;
}

export interface ImportRowError {
  rowIndex: number;
  field: "amount" | "date" | "row";
  reason: string;
  value?: string;
}

export interface ImportOptions {
  userId: string;
  householdId: string;
  targetAccountId?: string;
  strategy: "prioritize_coppercoin" | "prioritize_csv";
  mapping: ImportMapping;
  categoryMapping: Record<string, string>;
  ipAddress?: string;
}

export interface ExecuteImportResult {
  imported: number;
  skipped: number;
  deleted: number;
  errors: ImportRowError[];
}
