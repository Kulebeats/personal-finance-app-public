import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { TransactionType } from "../../../../utils/withTransaction";
import { assertJobFence, type JobFence } from "../fence";
import { createDurableJobStore, type DurableExecutor } from "../store";
import { assertClosed, fail, type DueItemRequest, type JobTransition } from "../contracts";
import type { RunnableDefinition } from "../catalog";

export const FIXTURE_NAME = "fixture.r14.ordered-events";
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 1000;
export function syntheticDefinition(policy = { leaseMs: 30_000, maxClaimLifetimeMs: 120_000, retryFailureLimit: 3, retryDelaysMs: [0, 0] }): RunnableDefinition {
  return {
    name: FIXTURE_NAME, version: "v1", resourceTypes: ["synthetic"], dueKinds: ["event"], policy,
    knownFailureCodes: ["KNOWN_TEST_FAILURE", "SYNTHETIC_WRITE_FAILED"], unknownHoldReasons: ["SYNTHETIC_UNKNOWN"],
    validateInput(request) {
      const payload = request.payload;
      if (!payload || typeof payload !== "object") fail("INVALID_SYNTHETIC_INPUT");
      assertClosed(payload as object, ["count", "eventKey"], "INVALID_SYNTHETIC_INPUT");
      const p = payload as { count: unknown; eventKey: unknown };
      if (request.due.kind !== "event" || !isCount(p.count) || p.eventKey !== request.due.key) fail("INVALID_SYNTHETIC_INPUT");
    },
    validateCheckpoint(checkpoint) {
      if (checkpoint === null) return;
      if (!checkpoint || typeof checkpoint !== "object") fail("INVALID_SYNTHETIC_CHECKPOINT");
      assertClosed(checkpoint as object, ["next"], "INVALID_SYNTHETIC_CHECKPOINT");
      if (!Number.isSafeInteger((checkpoint as { next: unknown }).next) || (checkpoint as { next: number }).next < 1) fail("INVALID_SYNTHETIC_CHECKPOINT");
    },
    validateResult(result) {
      if (!result || typeof result !== "object") fail("INVALID_SYNTHETIC_RESULT");
      assertClosed(result as object, ["processed"], "INVALID_SYNTHETIC_RESULT");
      if (!Number.isSafeInteger((result as { processed: unknown }).processed) || (result as { processed: number }).processed < 0) fail("INVALID_SYNTHETIC_RESULT");
    },
    validateTransition({ request, previousCheckpoint, previousResult, transition }) {
      const total = (request.payload as { count: number }).count;
      const before = previousCheckpoint === null ? 0 : (previousCheckpoint as { next: number }).next;
      const after = transition.kind === "yield" ? (transition.checkpoint as { next: number })?.next : before + transition.processedCount;
      if (!Number.isSafeInteger(after) || after < before || after > total ||
          after - before !== transition.processedCount ||
          (transition.kind === "yield" && (after === before || after === total)) ||
          (transition.kind === "complete" && after !== total) ||
          (transition.result as { processed?: unknown })?.processed !== after ||
          (previousResult !== null && (previousResult as { processed: number }).processed !== before)) fail("INVALID_SYNTHETIC_TRANSITION");
    },
    continuationReadyAt({ dueAt }) { return dueAt; },
  };
}
export function fixtureStore(executor: DurableExecutor, policy?: Parameters<typeof syntheticDefinition>[0]) {
  return createDurableJobStore(executor, [syntheticDefinition(policy)]);
}
export function requestFor(eventKey = `event:${randomUUID()}`, count = 1, scope: DueItemRequest["scope"] = { kind: "global" }, dueAt = "2000-01-01T00:00:00.000Z"): DueItemRequest {
  return { jobName: FIXTURE_NAME, definitionVersion: "v1", scope, due: { kind: "event", key: eventKey }, dueAt, payload: { count, eventKey } };
}
export async function createWitnessRelation(executor: DurableExecutor): Promise<void> {
  await executor.execute(sql`CREATE TABLE IF NOT EXISTS r14_fixture_effects (run_id text NOT NULL, item_id uuid NOT NULL, effect_key integer NOT NULL, PRIMARY KEY (item_id, effect_key))`);
}
export async function cleanupWitness(executor: DurableExecutor, runId: string): Promise<void> {
  await executor.execute(sql`DELETE FROM r14_fixture_effects WHERE run_id = ${runId}`);
}
export async function runSyntheticChunk(tx: TransactionType, fence: JobFence, runId: string): Promise<JobTransition> {
  const row = await assertJobFence(tx, fence);
  const count = (fence.request.payload as { count: number }).count;
  const before = fence.checkpoint === null ? 0 : (fence.checkpoint as { next: number }).next;
  const after = Math.min(count, before + 100);
  for (let i = before; i < after; i++) {
    await tx.execute(sql`INSERT INTO r14_fixture_effects (run_id, item_id, effect_key) VALUES (${runId}, ${row.id}, ${i})`);
  }
  return after === count
    ? { kind: "complete", result: { processed: after }, processedCount: after - before }
    : { kind: "yield", checkpoint: { next: after }, result: { processed: after }, processedCount: after - before };
}
