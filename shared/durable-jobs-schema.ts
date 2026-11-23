import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

/** Additive R14 ledger. The legacy `jobs` table remains independent. */
export const durableJobItems = pgTable("durable_job_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobName: varchar("job_name", { length: 96 }).notNull(),
  scopeKey: varchar("scope_key", { length: 512 }).notNull(),
  scope: jsonb("scope").$type<Record<string, unknown>>().notNull(),
  dueKind: varchar("due_kind", { length: 16 }).notNull(),
  dueKey: varchar("due_key", { length: 512 }).notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  definitionVersion: varchar("definition_version", { length: 96 }).notNull(),
  payloadText: text("payload_text").notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  policyText: text("policy_text").notNull(),
  policyHash: varchar("policy_hash", { length: 64 }).notNull(),
  state: varchar("state", { length: 24 }).notNull().default("queued"),
  readyAt: timestamp("ready_at", { withTimezone: true }).notNull(),
  generation: bigint("generation", { mode: "bigint" }).notNull().default(sql`0`),
  claimToken: uuid("claim_token"),
  workerId: varchar("worker_id", { length: 128 }),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  claimCount: bigint("claim_count", { mode: "bigint" }).notNull().default(sql`0`),
  failureCount: integer("failure_count").notNull().default(0),
  checkpoint: jsonb("checkpoint"),
  checkpointVersion: bigint("checkpoint_version", { mode: "bigint" }).notNull().default(sql`0`),
  result: jsonb("result"),
  lastErrorCode: varchar("last_error_code", { length: 96 }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastSucceededAt: timestamp("last_succeeded_at", { withTimezone: true }),
  terminalAt: timestamp("terminal_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, table => [
  uniqueIndex("durable_job_items_natural_identity").on(table.jobName, table.scopeKey, table.dueKind, table.dueKey),
  index("durable_job_items_eligibility_idx").on(sql`coalesce(lease_until, ready_at)`, table.dueAt, table.id).where(sql`state IN ('queued','retry_wait','running')`),
  index("durable_job_items_name_eligibility_idx").on(table.jobName, sql`coalesce(lease_until, ready_at)`, table.dueAt, table.id).where(sql`state IN ('queued','retry_wait','running')`),
  check("durable_job_items_scope_due_bounds", sql`octet_length(job_name) BETWEEN 1 AND 96 AND octet_length(scope_key) BETWEEN 1 AND 512 AND octet_length(due_key) BETWEEN 1 AND 512 AND octet_length(job_name) + octet_length(scope_key) + octet_length(due_key) <= 1024 AND due_kind IN ('business-date','period','event') AND jsonb_typeof(scope) = 'object'`),
  check("durable_job_items_scope_canonical", sql`
    ((scope = '{"kind":"global"}'::jsonb AND scope_key = '["global"]') OR
    (scope->>'kind' = 'household' AND scope = jsonb_build_object('kind','household','householdId',scope->>'householdId') AND scope->>'householdId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND scope_key = format('["household","%s"]',scope->>'householdId')) OR
    (scope->>'kind' = 'user' AND scope = jsonb_build_object('kind','user','userId',scope->>'userId') AND scope->>'userId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND scope_key = format('["user","%s"]',scope->>'userId')) OR
    (scope->>'kind' = 'household-resource' AND scope = jsonb_build_object('kind','household-resource','householdId',scope->>'householdId','resourceType',scope->>'resourceType','resourceId',scope->>'resourceId') AND scope->>'householdId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND scope->>'resourceId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND scope->>'resourceType' ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,63}$' AND scope_key = format('["household-resource","%s","%s","%s"]',scope->>'householdId',scope->>'resourceType',scope->>'resourceId'))) IS TRUE
  `),
  // The migration must preserve the reviewed immutable function preamble; Drizzle emits only this CHECK reference.
  check("durable_job_items_payload_policy_bounds", sql`(octet_length(payload_text) <= 65536 AND payload_hash ~ '^[0-9a-f]{64}$' AND octet_length(policy_text) <= 2048 AND policy_hash ~ '^[0-9a-f]{64}$' AND jsonb_typeof(payload_text::jsonb) IN ('object','array','string','number','boolean','null') AND r14_durable_policy_valid(policy_text)) IS TRUE`),
  check("durable_job_items_state_claim", sql`(state IN ('queued','running','retry_wait','succeeded','dead','outcome_unknown') AND ((state = 'running' AND generation > 0 AND claim_count = generation AND claim_token IS NOT NULL AND worker_id IS NOT NULL AND claimed_at IS NOT NULL AND lease_until IS NOT NULL AND isfinite(claimed_at) AND isfinite(lease_until) AND claimed_at < lease_until AND octet_length(worker_id) BETWEEN 1 AND 128) OR (state <> 'running' AND claim_token IS NULL AND worker_id IS NULL AND claimed_at IS NULL AND lease_until IS NULL))) IS TRUE`),
  check("durable_job_items_counts", sql`generation >= 0 AND claim_count >= 0 AND claim_count = generation AND failure_count >= 0 AND checkpoint_version >= 0 AND (checkpoint IS NULL OR (jsonb_typeof(checkpoint) = 'object' AND octet_length(checkpoint::text) <= 16384)) AND (result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 16384))`),
  check("durable_job_items_terminal", sql`((state IN ('succeeded','dead','outcome_unknown')) = (terminal_at IS NOT NULL)) AND (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,95}$')`),
]);

export const durableJobAttempts = pgTable("durable_job_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id").notNull().references(() => durableJobItems.id),
  generation: bigint("generation", { mode: "bigint" }).notNull(),
  token: uuid("token").notNull(),
  workerId: varchar("worker_id", { length: 128 }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
  lastLeaseAt: timestamp("last_lease_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  outcome: varchar("outcome", { length: 24 }).notNull(),
  errorCode: varchar("error_code", { length: 96 }),
  checkpointVersionBefore: bigint("checkpoint_version_before", { mode: "bigint" }).notNull(),
  checkpointVersionAfter: bigint("checkpoint_version_after", { mode: "bigint" }),
}, table => [
  uniqueIndex("durable_job_attempts_generation_key").on(table.itemId, table.generation),
  uniqueIndex("durable_job_attempts_token_key").on(table.itemId, table.token),
  check("durable_job_attempts_outcome", sql`(generation > 0 AND octet_length(worker_id) BETWEEN 1 AND 128 AND isfinite(claimed_at) AND isfinite(last_lease_at) AND last_lease_at >= claimed_at AND checkpoint_version_before >= 0 AND outcome IN ('running','yielded','succeeded','retryable_failed','permanent_failed','expired','unknown') AND ((outcome = 'running' AND finished_at IS NULL AND checkpoint_version_after IS NULL AND error_code IS NULL) OR (outcome <> 'running' AND finished_at IS NOT NULL AND isfinite(finished_at) AND finished_at >= last_lease_at AND checkpoint_version_after IS NOT NULL AND checkpoint_version_after >= checkpoint_version_before AND ((outcome IN ('yielded','succeeded') AND error_code IS NULL) OR (outcome IN ('retryable_failed','permanent_failed','expired','unknown') AND error_code ~ '^[A-Z][A-Z0-9_]{0,95}$'))))) IS TRUE`),
]);

export type DurableJobItem = typeof durableJobItems.$inferSelect;
export type DurableJobAttempt = typeof durableJobAttempts.$inferSelect;
