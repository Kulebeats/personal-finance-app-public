/**
 * Personal-data export CSV (A-27): one sheet per section, beside the JSON.
 *
 * Every sheet starts with its header row, even with no rows
 * (settings.privacy-export.columns.ts). Text cells go through the shared CSV
 * sanitiser, so a value a spreadsheet would run as a formula (`=`, `+`, `-`,
 * `@`, …) is written as text. An amount becomes two columns, `<field>` and
 * `<field>Currency`, and a two-decimal amount, negative ones included, stays a
 * numeric cell (validated, never re-parsed). A withheld or missing amount or
 * an unproven unit is written "unavailable"; an amount that does not apply to
 * the row is written "none". Neither is ever zero.
 */
import {
  PERSONAL_EXPORT_CSV_SECTIONS, PERSONAL_EXPORT_NONE, PERSONAL_EXPORT_UNAVAILABLE, personalExportCsvEntry,
  type PersonalExportAmount, type PersonalExportCsvSection,
} from "@shared/personal-data-export";
import { CsvDecimal, createCsv } from "../../core/csv";
import type { ArchiveEntryInput } from "./settings.privacy-export.archive";
import { SECTION_COLUMNS, type SectionColumns } from "./settings.privacy-export.columns";
import type { PersonalExportDocument } from "./settings.privacy-export.data";

const TWO_DECIMALS = /^-?\d+\.\d{2}$/;
const CURRENCY_SUFFIX = "Currency";

function isAmount(value: unknown): value is PersonalExportAmount {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 2 && keys[0] === "amount" && keys[1] === "currency";
}

function amountCell(amount: string | null): unknown {
  if (amount === null) return PERSONAL_EXPORT_UNAVAILABLE;
  return TWO_DECIMALS.test(amount) ? new CsvDecimal(amount) : amount;
}

function cell(value: unknown): unknown {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function rowsOf(document: PersonalExportDocument, section: PersonalExportCsvSection): Record<string, unknown>[] {
  if (section === "profile") return [document.profile];
  if (section === "preferences") return document.preferences ? [document.preferences] : [];
  return document[section];
}

/** A raw decimal string with its currency in another column becomes an amount; null does not apply. */
function rawAmount(row: Record<string, unknown>, key: string, currencyKey: string): PersonalExportAmount | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  const currency = row[currencyKey];
  return { amount: String(value), currency: typeof currency === "string" ? currency : null };
}

function amountCells(value: unknown): unknown[] {
  if (isAmount(value)) return [amountCell(value.amount), value.currency ?? PERSONAL_EXPORT_UNAVAILABLE];
  return [PERSONAL_EXPORT_NONE, ""];
}

/** One section as CSV: the spec's columns, then any other key a row has; each amount split into value and currency. */
export function sectionCsv(rows: readonly Record<string, unknown>[], spec: SectionColumns): string {
  const columns = [...spec.columns];
  const amountKeys = new Set([...spec.amounts, ...Object.keys(spec.amountCurrency ?? {})]);
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (isAmount(value)) amountKeys.add(key);
      if (!columns.includes(key)) columns.push(key);
    }
  }
  const headers = columns.flatMap(key => amountKeys.has(key) ? [key, `${key}${CURRENCY_SUFFIX}`] : [key]);
  const body = rows.map(row => columns.flatMap(key => {
    const currencyKey = spec.amountCurrency?.[key];
    if (currencyKey) return amountCells(rawAmount(row, key, currencyKey));
    if (amountKeys.has(key)) return amountCells(row[key]);
    const value = row[key];
    const label = spec.nullLabel?.[key];
    if ((value === null || value === undefined) && label) return [label(row)];
    return [cell(value)];
  }));
  return `${createCsv(headers, body)}\n`;
}

/** `csv/<section>.csv` for every section, in the shared order. */
export function buildCsvEntries(document: PersonalExportDocument): ArchiveEntryInput[] {
  return PERSONAL_EXPORT_CSV_SECTIONS.map(section => ({
    name: personalExportCsvEntry(section),
    data: Buffer.from(sectionCsv(rowsOf(document, section), SECTION_COLUMNS[section]), "utf8"),
  }));
}
