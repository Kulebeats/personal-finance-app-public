/**
 * Saved filter preset <-> TransactionFilters (R11 / ORG-010)
 *
 * A preset's `filters` is stored as JSON (`filter_presets.filters`, jsonb) and
 * comes back from the API untyped, so a Date saved as a Date arrives as an ISO
 * string. Presets are saved with dates as "YYYY-MM-DD" (the URL contract's
 * format, no timezone shift) and read back through the same URL-param parser
 * the Transactions page uses, so a preset can never hold a value the plain
 * filter would reject. Applying a preset only changes the page's URL filters:
 * the server applies its normal visibility rules to the resulting list query.
 */
import type { TransactionFilters } from "./types";
import {
  TRANSACTION_FILTER_PARAM_KEYS,
  formatDateParam,
  parseTransactionFilterParams,
} from "./transactionFilterParams";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FIELDS: ReadonlySet<keyof TransactionFilters> = new Set(["startDate", "endDate"]);

/** The JSON a preset stores for the given filters. */
export function transactionFiltersToPreset(filters: TransactionFilters): Record<string, unknown> {
  return {
    ...filters,
    tagIds: [...filters.tagIds],
    startDate: formatDateParam(filters.startDate) ?? null,
    endDate: formatDateParam(filters.endDate) ?? null,
  };
}

function toDateParam(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (DATE_ONLY.test(value)) return value;
  // Older presets serialized a Date with JSON.stringify (ISO, UTC).
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : formatDateParam(parsed) ?? null;
}

function toParam(field: keyof TransactionFilters, value: unknown): string | null {
  if (DATE_FIELDS.has(field)) return toDateParam(value);
  if (field === "tagIds") {
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string").join(",") || null
      : null;
  }
  if (typeof value === "string") return value || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Read a preset's stored JSON as filters; anything invalid falls back to its default. */
export function presetToTransactionFilters(raw: unknown): TransactionFilters {
  const params = new URLSearchParams();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record: Record<string, unknown> = { ...raw };
    const fields = Object.keys(TRANSACTION_FILTER_PARAM_KEYS) as Array<keyof TransactionFilters>;
    for (const field of fields) {
      const value = toParam(field, record[field]);
      if (value) params.set(TRANSACTION_FILTER_PARAM_KEYS[field], value);
    }
  }
  return parseTransactionFilterParams(params);
}
