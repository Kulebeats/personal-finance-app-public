import { eq, sql } from "drizzle-orm";
import { durableJobAttempts, durableJobItems, type DurableJobItem } from "@shared/durable-jobs-schema";
import type { TransactionType } from "../../../utils/withTransaction";
import { canonicalJson, fail, MAX_GENERATION, type Claim, type DueItemRequest, type JobTransition } from "./contracts";
import { assertCurrentAttempt, exactOwner, validOwner, type Definitions } from "./claims";

export interface JobFence {
  readonly request: Readonly<DueItemRequest>;
  readonly checkpoint: unknown;
  readonly result: unknown;
  readonly checkpointVersion: string;
}
interface PrivateFence { tx: TransactionType; claim: Claim; active: boolean; rowId: string }
const liveFences = new WeakMap<JobFence, PrivateFence>();
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Same transaction, same object, live callback and fresh DB lease are all required. */
export async function assertJobFence(tx: TransactionType, fence: JobFence): Promise<DurableJobItem> {
  const binding = liveFences.get(fence);
  if (!binding || !binding.active || binding.tx !== tx) return fail("INVALID_JOB_FENCE");
  const result = await tx.execute(sql`SELECT id FROM ${durableJobItems} WHERE id = ${binding.rowId} AND state = 'running' AND claim_token = ${binding.claim.token} AND generation = ${BigInt(binding.claim.generation)} AND worker_id = ${binding.claim.workerId} AND lease_until > clock_timestamp()`);
  if (result.rows.length !== 1) return fail("STALE_JOB_FENCE");
  const [row] = await tx.select().from(durableJobItems).where(eq(durableJobItems.id, binding.rowId));
  if (!row || !exactOwner(row, binding.claim)) fail("STALE_JOB_FENCE");
  await assertCurrentAttempt(tx, row);
  return row;
}
function validInstant(value: string): boolean {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export async function runFencedInTx(tx: TransactionType, definitions: Definitions, claim: Claim,
  callback: (tx: TransactionType, fence: JobFence) => Promise<JobTransition>) {
  const owned = await validOwner(tx, claim, definitions);
  if (!owned) return { kind: "stale" as const };
  const { row, definition, request } = owned;
  const fence: JobFence = Object.freeze({ request: deepFreeze(request), checkpoint: deepFreeze(row.checkpoint), result: deepFreeze(row.result), checkpointVersion: row.checkpointVersion.toString() });
  const binding: PrivateFence = { tx, claim, active: true, rowId: row.id };
  liveFences.set(fence, binding);
  try {
    const transition = await callback(tx, fence);
    if (!transition || !["complete", "yield"].includes(transition.kind) || !Number.isInteger(transition.processedCount) || transition.processedCount < (transition.kind === "yield" ? 1 : 0) || transition.processedCount > 100) fail("INVALID_JOB_TRANSITION");
    definition.validateTransition({ request, previousCheckpoint: row.checkpoint, previousResult: row.result, transition });
    definition.validateResult(transition.result);
    const resultText = canonicalJson(transition.result, 16_384);
    let checkpointText: string | null = null;
    let readyAt: string | null = null;
    if (transition.kind === "yield") {
      if (row.checkpointVersion >= MAX_GENERATION) fail("CHECKPOINT_VERSION_EXHAUSTED");
      definition.validateCheckpoint(transition.checkpoint);
      checkpointText = canonicalJson(transition.checkpoint, 16_384);
      readyAt = definition.continuationReadyAt({ dueAt: request.dueAt, checkpoint: transition.checkpoint, result: transition.result });
      if (!validInstant(readyAt)) fail("INVALID_CONTINUATION_TIME");
    }
    // The callback can mutate its own attempt in this transaction. Refuse and
    // roll back the effect before changing the item if it broke claim integrity.
    await assertCurrentAttempt(tx, row);
    // This is the linearization point. The retained row lock prevents any newer
    // generation until commit; final fresh DB time refuses an already expired lease.
    const updated = transition.kind === "yield"
      ? await tx.execute(sql`UPDATE ${durableJobItems} SET state = 'queued', checkpoint = ${checkpointText}::jsonb, checkpoint_version = checkpoint_version + 1, result = ${resultText}::jsonb, ready_at = ${readyAt}::timestamptz, claim_token = NULL, worker_id = NULL, claimed_at = NULL, lease_until = NULL, last_error_code = NULL, updated_at = clock_timestamp() WHERE id = ${row.id} AND state = 'running' AND claim_token = ${claim.token} AND generation = ${BigInt(claim.generation)} AND lease_until > clock_timestamp() RETURNING id`)
      : await tx.execute(sql`UPDATE ${durableJobItems} SET state = 'succeeded', result = ${resultText}::jsonb, claim_token = NULL, worker_id = NULL, claimed_at = NULL, lease_until = NULL, last_error_code = NULL, last_succeeded_at = clock_timestamp(), terminal_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = ${row.id} AND state = 'running' AND claim_token = ${claim.token} AND generation = ${BigInt(claim.generation)} AND lease_until > clock_timestamp() RETURNING id`);
    if (updated.rows.length !== 1) fail("STALE_JOB_FENCE_FINAL_CHECK");
    const finished = await tx.execute(sql`UPDATE ${durableJobAttempts}
      SET outcome = ${transition.kind === "yield" ? "yielded" : "succeeded"}, finished_at = clock_timestamp(),
        checkpoint_version_after = ${row.checkpointVersion + (transition.kind === "yield" ? 1n : 0n)}
      WHERE item_id = ${row.id} AND generation = ${row.generation} AND token = ${claim.token}
        AND worker_id = ${claim.workerId} AND outcome = 'running' AND finished_at IS NULL RETURNING id`);
    if (finished.rows.length !== 1) fail("INVALID_STORED_CLAIM");
    return { kind: transition.kind, itemId: row.id, result: JSON.parse(resultText), checkpointVersion: (row.checkpointVersion + (transition.kind === "yield" ? 1n : 0n)).toString() };
  } finally {
    binding.active = false;
    liveFences.delete(fence);
  }
}
