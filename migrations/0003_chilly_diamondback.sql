-- SCP-335 follow-up: enforce that a transaction carries a given tag at most once.
--
-- Pre-existing data may already contain duplicate (transaction_id, tag_id) rows: the
-- legacy add-tag path ran INSERT ... onConflictDoNothing() while NO unique index existed,
-- so re-tagging silently inserted duplicate links. Creating the unique index below would
-- FAIL on any such duplicate and abort the whole migration/deploy.
--
-- Deduplicate first, keeping exactly one row per (transaction_id, tag_id) pair (the one
-- with the smallest ctid). This is a no-op on a fresh database (the table is empty), and
-- on a populated database it removes only redundant links. NOTE: tags.usage_count may have
-- been inflated by these historical duplicates; reconciling that counter is intentionally
-- left as a separate follow-up and is not required for the unique index to apply.
DELETE FROM "transaction_tags" t
USING "transaction_tags" dup
WHERE t."transaction_id" = dup."transaction_id"
  AND t."tag_id" = dup."tag_id"
  AND t.ctid > dup.ctid;
--> statement-breakpoint
CREATE UNIQUE INDEX "unique_transaction_tag" ON "transaction_tags" USING btree ("transaction_id","tag_id");