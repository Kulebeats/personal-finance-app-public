/**
 * CSV import dedupe keys — pure functions, no database access.
 *
 * Extracted from `services/ImportService.ts` during the Rule 2 LOC burn-down.
 * Behaviour is pinned by
 * `services/__tests__/import.dedupe.characterization.test.ts`, including a
 * GOLDEN idempotency-key value derived from the pre-split implementation.
 *
 * `buildImportIdempotencyKey` feeds `transactions.idempotencyKey`, which is
 * UNIQUE at schema level and is what makes re-running the same CSV a no-op
 * rather than a duplicate-ledger event. Changing this derivation silently
 * invalidates every previously-imported row's key. Treat it as frozen.
 *
 * NEW-17 (D13) migration: new imports no longer WRITE this key. They write the
 * v2 identity in `identity.ts` (provider reference, else batch fingerprint plus
 * row ordinal). Rows already in the ledger keep this v1 key; there is no
 * backfill. The preview still derives it so a row imported by the old engine
 * is shown as a strong duplicate candidate instead of being re-imported unseen.
 */
import { createHash } from "crypto";
import type { ImportOptions, ParsedImportRow } from "./types";

/** Lowercase hex alphabet, indexed to convert a digest nibble to its value. */
const HEX_DIGITS = "0123456789abcdef";

/**
 * Duplicate-CANDIDATE key. Keyed on date+type+amount only: a ledger row with
 * the same amount on the same day is offered for review in the preview. Since
 * NEW-17 it never decides on its own that a row is a duplicate.
 */
export function importRowKey(row: ParsedImportRow): string {
  return ledgerDedupeKey(row.dateString, row.type, row.amount);
}

/** The same key for a stored ledger row. */
export function ledgerDedupeKey(dateString: string, type: string, amount: { toString(): string }): string {
  return `${dateString}_${type}_${amount.toString()}`;
}

/**
 * Deterministic, UUID-v4-shaped idempotency key for an imported row.
 *
 * Household-scoped, NOT user-scoped: two members importing the same statement
 * must collide (and therefore skip) rather than each creating their own copy.
 * Fields are joined with the unit delimiter (U+001F) so a value containing a
 * delimiter cannot forge another row's key.
 */
export function buildImportIdempotencyKey(
  options: ImportOptions,
  targetAccountId: string,
  row: ParsedImportRow,
): string {
  const hash = createHash("sha256")
    .update(
      [
        "csv_import",
        options.householdId,
        targetAccountId,
        row.dateString,
        row.type,
        row.amount.toString(),
        row.merchantName,
        row.categoryName ?? "",
        row.notes ?? "",
      ].join(""),
    )
    .digest("hex");

  // Force the RFC 4122 variant nibble (10xx) so the digest is a valid UUID for
  // the uuid-typed column. HEX_DIGITS.indexOf replaces the original radix-16
  // integer parse; for the lowercase [0-9a-f] a hex digest emits they are
  // exactly equivalent, and the golden-value test pins the output byte-for-byte.
  const variant = ((HEX_DIGITS.indexOf(hash[16]) & 0x3) | 0x8).toString(16);

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${variant}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}
