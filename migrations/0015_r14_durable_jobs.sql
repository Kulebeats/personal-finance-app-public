-- Additive R14 foundation; policy validation function must precede table CHECKs.
CREATE FUNCTION r14_durable_policy_valid(input text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  policy jsonb;
  part jsonb;
  lease_ms numeric;
  lifetime_ms numeric;
  failure_limit numeric;
  delay_ms numeric;
BEGIN
  IF input IS NULL THEN RETURN FALSE; END IF;
  IF octet_length(input) > 2048 THEN RETURN FALSE; END IF;
  policy := input::jsonb;
  IF jsonb_typeof(policy) IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
  IF policy <> jsonb_build_object('leaseMs',policy->'leaseMs','maxClaimLifetimeMs',policy->'maxClaimLifetimeMs',
       'retryFailureLimit',policy->'retryFailureLimit','retryDelaysMs',policy->'retryDelaysMs') THEN RETURN FALSE; END IF;
  IF jsonb_typeof(policy->'leaseMs') IS DISTINCT FROM 'number' OR
     jsonb_typeof(policy->'maxClaimLifetimeMs') IS DISTINCT FROM 'number' OR
     jsonb_typeof(policy->'retryFailureLimit') IS DISTINCT FROM 'number' OR
     jsonb_typeof(policy->'retryDelaysMs') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
  lease_ms := (policy->>'leaseMs')::numeric;
  lifetime_ms := (policy->>'maxClaimLifetimeMs')::numeric;
  failure_limit := (policy->>'retryFailureLimit')::numeric;
  IF lease_ms <> trunc(lease_ms) OR lease_ms NOT BETWEEN 100 AND 300000 OR
     lifetime_ms <> trunc(lifetime_ms) OR lifetime_ms NOT BETWEEN lease_ms AND 900000 OR
     failure_limit <> trunc(failure_limit) OR failure_limit NOT BETWEEN 1 AND 10 OR
     jsonb_array_length(policy->'retryDelaysMs') <> failure_limit - 1 THEN RETURN FALSE; END IF;
  FOR part IN SELECT value FROM jsonb_array_elements(policy->'retryDelaysMs') AS delays(value) LOOP
    IF jsonb_typeof(part) IS DISTINCT FROM 'number' THEN RETURN FALSE; END IF;
    delay_ms := (part #>> '{}')::numeric;
    IF delay_ms <> trunc(delay_ms) OR delay_ms NOT BETWEEN 0 AND 3600000 THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;
--> statement-breakpoint
CREATE TABLE "durable_job_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"generation" bigint NOT NULL,
	"token" uuid NOT NULL,
	"worker_id" varchar(128) NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"last_lease_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" varchar(24) NOT NULL,
	"error_code" varchar(96),
	"checkpoint_version_before" bigint NOT NULL,
	"checkpoint_version_after" bigint,
	CONSTRAINT "durable_job_attempts_outcome" CHECK ((generation > 0 AND octet_length(worker_id) BETWEEN 1 AND 128 AND isfinite(claimed_at) AND isfinite(last_lease_at) AND last_lease_at >= claimed_at AND checkpoint_version_before >= 0 AND outcome IN ('running','yielded','succeeded','retryable_failed','permanent_failed','expired','unknown') AND ((outcome = 'running' AND finished_at IS NULL AND checkpoint_version_after IS NULL AND error_code IS NULL) OR (outcome <> 'running' AND finished_at IS NOT NULL AND isfinite(finished_at) AND finished_at >= last_lease_at AND checkpoint_version_after IS NOT NULL AND checkpoint_version_after >= checkpoint_version_before AND ((outcome IN ('yielded','succeeded') AND error_code IS NULL) OR (outcome IN ('retryable_failed','permanent_failed','expired','unknown') AND error_code ~ '^[A-Z][A-Z0-9_]{0,95}$'))))) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE "durable_job_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" varchar(96) NOT NULL,
	"scope_key" varchar(512) NOT NULL,
	"scope" jsonb NOT NULL,
	"due_kind" varchar(16) NOT NULL,
	"due_key" varchar(512) NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"definition_version" varchar(96) NOT NULL,
	"payload_text" text NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"policy_text" text NOT NULL,
	"policy_hash" varchar(64) NOT NULL,
	"state" varchar(24) DEFAULT 'queued' NOT NULL,
	"ready_at" timestamp with time zone NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"claim_token" uuid,
	"worker_id" varchar(128),
	"claimed_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"claim_count" bigint DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb,
	"checkpoint_version" bigint DEFAULT 0 NOT NULL,
	"result" jsonb,
	"last_error_code" varchar(96),
	"last_attempt_at" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "durable_job_items_scope_due_bounds" CHECK (octet_length(job_name) BETWEEN 1 AND 96 AND octet_length(scope_key) BETWEEN 1 AND 512 AND octet_length(due_key) BETWEEN 1 AND 512 AND octet_length(job_name) + octet_length(scope_key) + octet_length(due_key) <= 1024 AND due_kind IN ('business-date','period','event') AND jsonb_typeof(scope) = 'object'),
	CONSTRAINT "durable_job_items_scope_canonical" CHECK (
    ((scope = '{"kind":"global"}'::jsonb AND scope_key = '["global"]') OR
    (scope->>'kind' = 'household' AND scope = jsonb_build_object('kind','household','householdId',scope->>'householdId') AND scope->>'householdId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND scope_key = format('["household","%s"]',scope->>'householdId')) OR
    (scope->>'kind' = 'user' AND scope = jsonb_build_object('kind','user','userId',scope->>'userId') AND scope->>'userId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND scope_key = format('["user","%s"]',scope->>'userId')) OR
    (scope->>'kind' = 'household-resource' AND scope = jsonb_build_object('kind','household-resource','householdId',scope->>'householdId','resourceType',scope->>'resourceType','resourceId',scope->>'resourceId') AND scope->>'householdId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND scope->>'resourceId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND scope->>'resourceType' ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,63}$' AND scope_key = format('["household-resource","%s","%s","%s"]',scope->>'householdId',scope->>'resourceType',scope->>'resourceId'))) IS TRUE
  ),
	CONSTRAINT "durable_job_items_payload_policy_bounds" CHECK ((octet_length(payload_text) <= 65536 AND payload_hash ~ '^[0-9a-f]{64}$' AND octet_length(policy_text) <= 2048 AND policy_hash ~ '^[0-9a-f]{64}$' AND jsonb_typeof(payload_text::jsonb) IN ('object','array','string','number','boolean','null') AND r14_durable_policy_valid(policy_text)) IS TRUE),
	CONSTRAINT "durable_job_items_state_claim" CHECK ((state IN ('queued','running','retry_wait','succeeded','dead','outcome_unknown') AND ((state = 'running' AND generation > 0 AND claim_count = generation AND claim_token IS NOT NULL AND worker_id IS NOT NULL AND claimed_at IS NOT NULL AND lease_until IS NOT NULL AND isfinite(claimed_at) AND isfinite(lease_until) AND claimed_at < lease_until AND octet_length(worker_id) BETWEEN 1 AND 128) OR (state <> 'running' AND claim_token IS NULL AND worker_id IS NULL AND claimed_at IS NULL AND lease_until IS NULL))) IS TRUE),
	CONSTRAINT "durable_job_items_counts" CHECK (generation >= 0 AND claim_count >= 0 AND claim_count = generation AND failure_count >= 0 AND checkpoint_version >= 0 AND (checkpoint IS NULL OR (jsonb_typeof(checkpoint) = 'object' AND octet_length(checkpoint::text) <= 16384)) AND (result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 16384))),
	CONSTRAINT "durable_job_items_terminal" CHECK (((state IN ('succeeded','dead','outcome_unknown')) = (terminal_at IS NOT NULL)) AND (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,95}$'))
);
--> statement-breakpoint
ALTER TABLE "durable_job_attempts" ADD CONSTRAINT "durable_job_attempts_item_id_durable_job_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."durable_job_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "durable_job_attempts_generation_key" ON "durable_job_attempts" USING btree ("item_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "durable_job_attempts_token_key" ON "durable_job_attempts" USING btree ("item_id","token");--> statement-breakpoint
CREATE UNIQUE INDEX "durable_job_items_natural_identity" ON "durable_job_items" USING btree ("job_name","scope_key","due_kind","due_key");--> statement-breakpoint
CREATE INDEX "durable_job_items_eligibility_idx" ON "durable_job_items" USING btree (coalesce(lease_until, ready_at),"due_at","id") WHERE state IN ('queued','retry_wait','running');--> statement-breakpoint
CREATE INDEX "durable_job_items_name_eligibility_idx" ON "durable_job_items" USING btree ("job_name",coalesce(lease_until, ready_at),"due_at","id") WHERE state IN ('queued','retry_wait','running');