import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { durableJobAttempts, durableJobItems, type DurableJobItem } from "@shared/durable-jobs-schema";
import type { TransactionType } from "../../../utils/withTransaction";
import { fail, MAX_GENERATION, sha256, validateCode, validateRequest, type Claim, type DueItemRequest, type KnownFailure } from "./contracts";
import type { DefinitionSnapshot } from "./catalog";

export type Definitions = ReadonlyMap<string, DefinitionSnapshot>;
export async function databaseNow(tx: TransactionType): Promise<Date> {
  const response = await tx.execute(sql`SELECT clock_timestamp() AS current_time`);
  return new Date(response.rows[0].current_time as string);
}
export async function ownedTransactionSettings(tx: TransactionType): Promise<void> {
  await tx.execute(sql`SET LOCAL statement_timeout = '8s'`);
  await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
  await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '12s'`);
}
export function currentDefinition(row: DurableJobItem, definitions: Definitions): { definition: DefinitionSnapshot; request: DueItemRequest } {
  const definition = definitions.get(row.jobName);
  if (!definition || row.definitionVersion !== definition.version || row.policyText !== definition.policyText || row.policyHash !== definition.policyHash || !definition.dueKinds.includes(row.dueKind as DueItemRequest["due"]["kind"])) return fail("UNSUPPORTED_STORED_DEFINITION");
  const request: DueItemRequest = { jobName: row.jobName, definitionVersion: row.definitionVersion, scope: row.scope as unknown as DueItemRequest["scope"], due: { kind: row.dueKind as DueItemRequest["due"]["kind"], key: row.dueKey }, dueAt: row.dueAt.toISOString(), payload: JSON.parse(row.payloadText) };
  const validated = validateRequest(request, definition.resourceTypes);
  if (validated.scopeKey !== row.scopeKey || validated.payloadText !== row.payloadText || sha256(row.payloadText) !== row.payloadHash) fail("INVALID_STORED_REQUEST");
  definition.validateInput(validated);
  definition.validateCheckpoint(row.checkpoint);
  if (row.result !== null) definition.validateResult(row.result);
  return { definition, request };
}
export function exactOwner(row: DurableJobItem, claim: Claim): boolean {
  return row.state === "running" && row.id === claim.itemId && row.claimToken === claim.token && row.generation.toString() === claim.generation && row.workerId === claim.workerId;
}
export async function lockItem(tx: TransactionType, id: string): Promise<DurableJobItem | undefined> {
  const [row] = await tx.select().from(durableJobItems).where(eq(durableJobItems.id, id)).for("update");
  return row;
}
/** Call only after the item lock; retain both locks until the transaction ends. */
export async function assertCurrentAttempt(tx: TransactionType, row: DurableJobItem): Promise<void> {
  if (row.state !== "running" || !row.claimToken || !row.workerId) return fail("INVALID_STORED_CLAIM");
  const attempt = await tx.select({ id: durableJobAttempts.id }).from(durableJobAttempts).where(and(
    eq(durableJobAttempts.itemId, row.id), eq(durableJobAttempts.generation, row.generation),
    eq(durableJobAttempts.token, row.claimToken))).for("update");
  if (attempt.length !== 1) fail("INVALID_STORED_CLAIM");
  const match = await tx.execute(sql`SELECT EXISTS (
    SELECT 1 FROM ${durableJobItems} AS item JOIN ${durableJobAttempts} AS attempt ON attempt.item_id = item.id
    WHERE item.id = ${row.id} AND item.state = 'running' AND item.generation > 0
      AND item.claim_count = item.generation AND attempt.generation = item.generation
      AND attempt.token = item.claim_token AND attempt.worker_id = item.worker_id
      AND attempt.claimed_at = item.claimed_at AND attempt.outcome = 'running'
      AND attempt.finished_at IS NULL AND attempt.checkpoint_version_after IS NULL
      AND attempt.error_code IS NULL AND attempt.checkpoint_version_before = item.checkpoint_version
  ) AS coherent`);
  if (match.rows[0]?.coherent !== true) fail("INVALID_STORED_CLAIM");
}
async function assertPreviousAttempt(tx: TransactionType, row: DurableJobItem): Promise<void> {
  if (row.generation === 0n) return;
  const previous = await tx.select({ id: durableJobAttempts.id }).from(durableJobAttempts).where(and(
    eq(durableJobAttempts.itemId, row.id), eq(durableJobAttempts.generation, row.generation))).for("update");
  if (previous.length !== 1) fail("INVALID_STORED_CLAIM");
  const match = await tx.execute(sql`SELECT EXISTS (SELECT 1 FROM ${durableJobAttempts} AS attempt
    WHERE attempt.item_id = ${row.id} AND attempt.generation = ${row.generation}
      AND attempt.finished_at IS NOT NULL AND attempt.checkpoint_version_after = ${row.checkpointVersion}
      AND ((${row.state} = 'queued' AND attempt.outcome = 'yielded') OR
           (${row.state} = 'retry_wait' AND attempt.outcome IN ('retryable_failed','expired')))) AS coherent`);
  if (match.rows[0]?.coherent !== true) fail("INVALID_STORED_CLAIM");
}
export async function validOwner(tx: TransactionType, claim: Claim, definitions: Definitions): Promise<{ row: DurableJobItem; definition: DefinitionSnapshot; request: DueItemRequest } | null> {
  const row = await lockItem(tx, claim.itemId);
  if (!row || !exactOwner(row, claim)) return null;
  await assertCurrentAttempt(tx, row);
  const { definition, request } = currentDefinition(row, definitions);
  const time = await tx.execute(sql`SELECT (${durableJobItems.leaseUntil} > clock_timestamp()) AS live FROM ${durableJobItems} WHERE ${durableJobItems.id} = ${row.id}`);
  if (time.rows[0]?.live !== true) return null;
  return { row, definition, request };
}
function retryDelay(definition: DefinitionSnapshot, nextFailureCount: number): number {
  const delay = definition.policy.retryDelaysMs[nextFailureCount - 1];
  if (delay === undefined) fail("INVALID_RETRY_POLICY");
  return delay;
}
export async function expireLocked(tx: TransactionType, row: DurableJobItem, definition: DefinitionSnapshot): Promise<"dead" | "retry_wait" | null> {
  if (row.state !== "running") return null;
  await assertCurrentAttempt(tx, row);
  const lease = await tx.execute(sql`SELECT (${durableJobItems.leaseUntil} <= clock_timestamp()) AS expired FROM ${durableJobItems} WHERE ${durableJobItems.id} = ${row.id}`);
  if (lease.rows[0]?.expired !== true) return null;
  const failures = row.failureCount + 1;
  const dead = failures >= definition.policy.retryFailureLimit;
  const delay = dead ? 0 : retryDelay(definition, failures);
  const finished = await tx.execute(sql`WITH stamp AS (SELECT clock_timestamp() AS now)
    UPDATE ${durableJobAttempts} SET outcome = 'expired', finished_at = stamp.now,
      error_code = 'LEASE_EXPIRED', checkpoint_version_after = ${row.checkpointVersion}
    FROM stamp WHERE item_id = ${row.id} AND generation = ${row.generation} AND token = ${row.claimToken}
      AND worker_id = ${row.workerId} AND outcome = 'running' AND finished_at IS NULL RETURNING id`);
  if (finished.rows.length !== 1) fail("INVALID_STORED_CLAIM");
  const changed = await tx.execute(sql`WITH stamp AS (SELECT clock_timestamp() AS now)
    UPDATE ${durableJobItems} SET state = ${dead ? "dead" : "retry_wait"}, failure_count = ${failures},
      ready_at = stamp.now + (${delay} * interval '1 millisecond'), claim_token = NULL, worker_id = NULL,
      claimed_at = NULL, lease_until = NULL, terminal_at = ${dead ? sql`stamp.now` : sql`NULL`},
      last_error_code = 'LEASE_EXPIRED', updated_at = stamp.now
    FROM stamp WHERE id = ${row.id} AND state = 'running' AND claim_token = ${row.claimToken}
      AND generation = ${row.generation} AND lease_until <= stamp.now RETURNING id`);
  if (changed.rows.length !== 1) fail("STALE_CLAIM_FINAL_CHECK");
  return dead ? "dead" : "retry_wait";
}
export interface ClaimReadyInput { jobNames: readonly string[]; workerId: string; limit: number }
export async function claimReadyInTx(tx: TransactionType, definitions: Definitions, input: ClaimReadyInput) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100 || !Array.isArray(input.jobNames) || input.jobNames.length < 1 || input.jobNames.length > 100 || input.jobNames.some(name => !definitions.has(name)) || typeof input.workerId !== "string" || new TextEncoder().encode(input.workerId).length < 1 || new TextEncoder().encode(input.workerId).length > 128) fail("INVALID_CLAIM_REQUEST");
  const names = [...new Set(input.jobNames)];
  const key = sql`coalesce(${durableJobItems.leaseUntil}, ${durableJobItems.readyAt})`;
  const discovery = await tx.execute(sql`SELECT clock_timestamp()::text AS cutoff`);
  const cutoff = discovery.rows[0].cutoff as string;
  const candidates = await tx.select().from(durableJobItems).where(and(inArray(durableJobItems.jobName, names),
    sql`${durableJobItems.state} IN ('queued','retry_wait','running')`, sql`${key} <= ${cutoff}::timestamptz`))
    .orderBy(asc(key), asc(durableJobItems.dueAt), asc(durableJobItems.id))
    .limit(input.limit).for("update", { skipLocked: true });
  const claims: Claim[] = [];
  let expiredToDead = 0;
  for (const initial of candidates) {
    const row = initial; // The row lock from candidate selection is retained.
    const { definition } = currentDefinition(row, definitions);
    if (row.state === "running") {
      if (await expireLocked(tx, row, definition) === "dead") expiredToDead++;
      continue; // The configured backoff is retained; no same-call replacement attempt.
    }
    await assertPreviousAttempt(tx, row);
    const ready = await tx.execute(sql`SELECT (${durableJobItems.readyAt} <= clock_timestamp()) AS eligible FROM ${durableJobItems} WHERE ${durableJobItems.id} = ${row.id}`);
    if (ready.rows[0]?.eligible !== true || !["queued", "retry_wait"].includes(row.state)) continue;
    if (row.generation >= MAX_GENERATION) fail("GENERATION_EXHAUSTED");
    const token = randomUUID();
    const claimed = await tx.execute(sql`WITH stamp AS (SELECT clock_timestamp() AS now)
      UPDATE ${durableJobItems} SET state = 'running', generation = generation + 1, claim_count = claim_count + 1,
        claim_token = ${token}, worker_id = ${input.workerId}, claimed_at = stamp.now,
        lease_until = stamp.now + (${definition.policy.leaseMs} * interval '1 millisecond'),
        last_attempt_at = stamp.now, terminal_at = NULL, updated_at = stamp.now
      FROM stamp WHERE id = ${row.id} AND state IN ('queued','retry_wait') AND ready_at <= stamp.now
        AND generation = ${row.generation} RETURNING generation::text`);
    if (claimed.rows.length !== 1) continue;
    const inserted = await tx.execute(sql`INSERT INTO ${durableJobAttempts}
      (item_id, generation, token, worker_id, claimed_at, last_lease_at, outcome, checkpoint_version_before)
      SELECT id, generation, claim_token, worker_id, claimed_at, claimed_at, 'running', checkpoint_version
      FROM ${durableJobItems} WHERE id = ${row.id} AND claim_token = ${token} RETURNING id`);
    if (inserted.rows.length !== 1) fail("INVALID_STORED_CLAIM");
    claims.push(Object.freeze({ itemId: row.id, generation: claimed.rows[0].generation as string, token, workerId: input.workerId }));
  }
  const probe = await tx.execute(sql`SELECT clock_timestamp()::text AS cutoff`);
  const probeCutoff = probe.rows[0].cutoff as string;
  const extra = await tx.execute(sql`SELECT EXISTS (SELECT 1 FROM ${durableJobItems}
    WHERE ${inArray(durableJobItems.jobName, names)} AND ${durableJobItems.state} IN ('queued','retry_wait','running')
      AND ${key} <= ${probeCutoff}::timestamptz LIMIT 1) AS eligible`);
  // Snapshot-visible backlog includes rows locked elsewhere; it is only a hint.
  return { claims, expiredToDead, visitedCount: candidates.length, moreEligible: extra.rows[0]?.eligible === true };
}
export async function renewInTx(tx: TransactionType, definitions: Definitions, claim: Claim) {
  const owned = await validOwner(tx, claim, definitions);
  if (!owned) return { kind: "stale" as const };
  const { row, definition } = owned;
  const response = await tx.execute(sql`UPDATE ${durableJobItems} SET lease_until = least(greatest(lease_until, clock_timestamp() + (${definition.policy.leaseMs} * interval '1 millisecond')), claimed_at + (${definition.policy.maxClaimLifetimeMs} * interval '1 millisecond')), updated_at = clock_timestamp() WHERE id = ${row.id} AND state = 'running' AND claim_token = ${claim.token} AND generation = ${BigInt(claim.generation)} AND lease_until > clock_timestamp() AND claimed_at + (${definition.policy.maxClaimLifetimeMs} * interval '1 millisecond') > clock_timestamp() RETURNING lease_until`);
  if (response.rows.length !== 1) return { kind: "stale" as const };
  const updatedAttempt = await tx.execute(sql`UPDATE ${durableJobAttempts} SET last_lease_at = clock_timestamp()
    WHERE item_id = ${row.id} AND generation = ${row.generation} AND token = ${claim.token}
      AND worker_id = ${claim.workerId} AND outcome = 'running' AND finished_at IS NULL RETURNING id`);
  if (updatedAttempt.rows.length !== 1) fail("INVALID_STORED_CLAIM");
  return { kind: "renewed" as const, leaseUntil: new Date(response.rows[0].lease_until as string).toISOString() };
}
export async function failureInTx(tx: TransactionType, definitions: Definitions, claim: Claim, failure: KnownFailure) {
  if (!failure || !["retryable", "permanent"].includes(failure.kind)) fail("INVALID_FAILURE");
  validateCode(failure.code);
  const owned = await validOwner(tx, claim, definitions);
  if (!owned) return { kind: "stale" as const };
  const { row, definition } = owned;
  if (!definition.knownFailureCodes.includes(failure.code)) fail("UNREGISTERED_FAILURE_CODE");
  const failures = row.failureCount + 1;
  const dead = failure.kind === "permanent" || failures >= definition.policy.retryFailureLimit;
  const delay = dead ? 0 : retryDelay(definition, failures);
  const finished = await tx.execute(sql`UPDATE ${durableJobAttempts}
    SET outcome = ${failure.kind === "permanent" ? "permanent_failed" : "retryable_failed"},
      finished_at = clock_timestamp(), error_code = ${failure.code}, checkpoint_version_after = ${row.checkpointVersion}
    WHERE item_id = ${row.id} AND generation = ${row.generation} AND token = ${claim.token}
      AND worker_id = ${claim.workerId} AND outcome = 'running' AND finished_at IS NULL RETURNING id`);
  if (finished.rows.length !== 1) fail("INVALID_STORED_CLAIM");
  const response = await tx.execute(sql`UPDATE ${durableJobItems} SET state = ${dead ? "dead" : "retry_wait"}, failure_count = ${failures}, ready_at = clock_timestamp() + (${delay} * interval '1 millisecond'), claim_token = NULL, worker_id = NULL, claimed_at = NULL, lease_until = NULL, terminal_at = ${dead ? sql`clock_timestamp()` : sql`NULL`}, last_error_code = ${failure.code}, updated_at = clock_timestamp() WHERE id = ${row.id} AND state = 'running' AND claim_token = ${claim.token} AND generation = ${BigInt(claim.generation)} AND lease_until > clock_timestamp() RETURNING id`);
  if (response.rows.length !== 1) fail("STALE_CLAIM_FINAL_CHECK");
  return { kind: dead ? "dead" as const : "retry_wait" as const };
}
export async function holdUnknownInTx(tx: TransactionType, definitions: Definitions, claim: Claim, reason: string) {
  validateCode(reason);
  const owned = await validOwner(tx, claim, definitions);
  if (!owned) return { kind: "stale" as const };
  const { row, definition } = owned;
  if (!definition.unknownHoldReasons.includes(reason)) fail("UNREGISTERED_UNKNOWN_REASON");
  const finished = await tx.execute(sql`UPDATE ${durableJobAttempts} SET outcome = 'unknown',
      finished_at = clock_timestamp(), error_code = ${reason}, checkpoint_version_after = ${row.checkpointVersion}
    WHERE item_id = ${row.id} AND generation = ${row.generation} AND token = ${claim.token}
      AND worker_id = ${claim.workerId} AND outcome = 'running' AND finished_at IS NULL RETURNING id`);
  if (finished.rows.length !== 1) fail("INVALID_STORED_CLAIM");
  const response = await tx.execute(sql`UPDATE ${durableJobItems} SET state = 'outcome_unknown', claim_token = NULL, worker_id = NULL, claimed_at = NULL, lease_until = NULL, terminal_at = clock_timestamp(), last_error_code = ${reason}, updated_at = clock_timestamp() WHERE id = ${row.id} AND state = 'running' AND claim_token = ${claim.token} AND generation = ${BigInt(claim.generation)} AND lease_until > clock_timestamp() RETURNING id`);
  if (response.rows.length !== 1) fail("STALE_CLAIM_FINAL_CHECK");
  return { kind: "outcome_unknown" as const };
}
