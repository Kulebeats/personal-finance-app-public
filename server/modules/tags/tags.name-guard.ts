/**
 * Tags Module - household tag-name lock (NEW-36)
 *
 * Tag names are unique per household regardless of case: "Groceries" and "groceries" are
 * one name. The unique index uq_tags_household_name (NEW-39) is the database backstop.
 * For the friendly 409, user-driven create and rename take this per-household advisory
 * lock, then check for a clash (TagRepository.findByName, which compares
 * case-insensitively) inside the same write transaction. Two concurrent writers of one
 * name run one after the other, so the second sees the first's row and gets a 409.
 * The statement import takes the lock too and reuses the tag it finds. The receipt match
 * cannot take it (it runs after its account lock), so it inserts with ON CONFLICT DO
 * NOTHING and re-reads; a create that loses to it maps the index error to the same 409.
 *
 * @module modules/tags/name-guard
 */

import { sql } from "drizzle-orm";
import { ConflictError, ValidationError } from "../../core/errors";
import { isPostgresError } from "../../utils/postgresError";
import type { TransactionType } from "../../utils/withTransaction";

export const TAG_NAME_TAKEN = "A tag with this name already exists in your household";

/**
 * The form a tag name is checked and stored in (N5): trimmed and NFC-normalised, so "Food "
 * and "Food", or an NFD and an NFC "Café", are one name. Existing rows are not rewritten.
 */
export function normalizeTagName(name: string): string {
  const normalized = name.trim().normalize("NFC");
  if (!normalized) throw new ValidationError("Tag name is required");
  return normalized;
}

/** Advisory-lock namespace for a household's tag names ("tagn"). */
const TAG_NAME_LOCK_NAMESPACE = 0x7461676e;

/** Serialise tag-name writes for this household until the transaction ends. */
export async function lockTagNames(tx: TransactionType, householdId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${TAG_NAME_LOCK_NAMESPACE}::int4, hashtext(${householdId}))`,
  );
}

/**
 * A write that lost the race to the unique index uq_tags_household_name (NEW-39) is the same
 * 409 as the locked check, never a raw database error.
 */
export function rethrowTagNameClash(error: unknown): never {
  if (isPostgresError(error, "23505", "uq_tags_household_name")) throw new ConflictError(TAG_NAME_TAKEN);
  throw error;
}
