/** Personal-data export contract shared by server and client (R07.1, AH-08). */

/**
 * `data_exports.export_type` of a personal-data export. Kept dependency-free so
 * the erasure path can name it without loading the export data module.
 */
export const PERSONAL_EXPORT_TYPE = "personal_data";

/** `revoked`: the requester can no longer read the household it was taken from. */
export type PersonalExportStatus = "ready" | "failed" | "expired" | "revoked";

export interface PersonalExportSections {
  profile: number;
  memberships: number;
  preferences: number;
  accounts: number;
  transactions: number;
  categories: number;
  securityEvents: number;
  // Version 2 sections (A-27); absent on version 1 manifests.
  goals?: number;
  budgets?: number;
  recurringRules?: number;
  holdings?: number;
  grzBonds?: number;
  grzBondPayments?: number;
  grzTBills?: number;
  receipts?: number;
  tags?: number;
}

/** Version 2 (A-27): one ZIP holding the JSON document and one CSV per section. */
export const PERSONAL_EXPORT_ARCHIVE_VERSION = 2;
export const PERSONAL_EXPORT_JSON_ENTRY = "personal-data.json";
export const PERSONAL_EXPORT_CSV_SECTIONS = [
  "profile", "memberships", "preferences", "accounts", "transactions", "categories", "securityEvents",
  "goals", "budgets", "recurringRules", "holdings", "grzBonds", "grzBondPayments", "grzTBills", "receipts", "tags",
] as const;
export type PersonalExportCsvSection = (typeof PERSONAL_EXPORT_CSV_SECTIONS)[number];
export function personalExportCsvEntry(section: PersonalExportCsvSection): string {
  return `csv/${section}.csv`;
}

/**
 * An amount in a version 2 section, always with its own currency. A null
 * amount is unavailable or withheld (never zero); a null currency means the
 * unit is unproven. CSV writes either null as {@link PERSONAL_EXPORT_UNAVAILABLE}.
 * A field that does not apply (an unsold bond's sale price, a budget with no
 * default amount) is null itself, not an amount, and CSV writes
 * {@link PERSONAL_EXPORT_NONE}.
 */
export interface PersonalExportAmount {
  amount: string | null;
  currency: string | null;
}
export const PERSONAL_EXPORT_UNAVAILABLE = "unavailable";
export const PERSONAL_EXPORT_NONE = "none";

export interface PersonalExportItem {
  id: string;
  status: PersonalExportStatus;
  fileFormat: string;
  /** ISO 8601 UTC. */
  createdAt: string | null;
  /** ISO 8601 UTC; after this the download answers 410. */
  expiresAt: string | null;
  sizeBytes: number | null;
  recordCount: number | null;
  sections: PersonalExportSections | null;
  /** Present only while the export is ready. */
  downloadUrl: string | null;
}
