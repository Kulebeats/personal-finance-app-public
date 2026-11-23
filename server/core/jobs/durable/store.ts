import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { durableJobAttempts, durableJobItems, type DurableJobItem } from "@shared/durable-jobs-schema";
import type { db } from "../../../db";
import type { TransactionType } from "../../../utils/withTransaction";
import { canonicalJson, DurableJobError, fail, validateRequest, type Claim, type DueItemRequest, type KnownFailure } from "./contracts";
import { snapshotDefinitions, type RunnableDefinition } from "./catalog";
import { claimReadyInTx, databaseNow, failureInTx, holdUnknownInTx, ownedTransactionSettings, renewInTx, type ClaimReadyInput } from "./claims";
import { runFencedInTx, type JobFence } from "./fence";
import type { JobTransition } from "./contracts";

export type DurableExecutor = Pick<typeof db, "transaction" | "execute">;
export type DueIdentity = Pick<DueItemRequest, "jobName" | "scope" | "due">;
export interface StatusFilter { jobNames?: readonly string[]; afterId?: string; limit: number }
function view(row: DurableJobItem, lagMs?: number) {
  return { id: row.id, jobName: row.jobName, scope: row.scope, due: { kind: row.dueKind, key: row.dueKey }, dueAt: row.dueAt.toISOString(),
    readyAt: row.readyAt.toISOString(), state: row.state, generation: row.generation.toString(), claimCount: row.claimCount.toString(),
    failureCount: row.failureCount, checkpoint: row.checkpoint, checkpointVersion: row.checkpointVersion.toString(), result: row.result,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null, lastSucceededAt: row.lastSucceededAt?.toISOString() ?? null,
    terminalAt: row.terminalAt?.toISOString() ?? null, lastErrorCode: row.lastErrorCode, owner: row.workerId,
    lagMs: lagMs ?? null };
}
async function transaction<T>(executor: DurableExecutor, operation: (tx: TransactionType) => Promise<T>): Promise<T> {
  let callbackCompleted = false;
  try {
    return await executor.transaction(async tx => {
      await ownedTransactionSettings(tx as TransactionType);
      const result = await operation(tx as TransactionType);
      callbackCompleted = true;
      return result;
    }, { isolationLevel: "read committed" });
  } catch (error) {
    // A driver failure after the callback has returned may be an ambiguous COMMIT.
    // Never rerun the effect or record a known failure on this branch.
    if (callbackCompleted) throw new DurableJobError("COMMIT_UNCONFIRMED");
    if (error instanceof DurableJobError) throw error;
    throw new DurableJobError("JOB_TRANSACTION_FAILED");
  }
}
export function createDurableJobStore(executor: DurableExecutor, runnableDefinitions: readonly RunnableDefinition[]) {
  if (!executor || typeof executor.transaction !== "function" || typeof executor.execute !== "function") fail("INVALID_EXECUTOR");
  const definitions = snapshotDefinitions(runnableDefinitions);
  const definitionFor = (name: string) => definitions.get(name) ?? fail("UNSUPPORTED_DEFINITION");
  const identityParts = (identity: DueIdentity) => {
    const definition = definitionFor(identity.jobName);
    return validateRequest({ ...identity, definitionVersion: definition.version, dueAt: "2000-01-01T00:00:00.000Z", payload: null }, definition.resourceTypes);
  };
  return Object.freeze({
    async enqueue(request: DueItemRequest) {
      if (!request || typeof request !== "object") fail("INVALID_REQUEST");
      const generic = validateRequest(request, null);
      const definition = definitionFor(generic.jobName);
      if (generic.definitionVersion !== definition.version) fail("UNSUPPORTED_DEFINITION_VERSION");
      const validated = validateRequest(request, definition.resourceTypes);
      if (!definition.dueKinds.includes(validated.due.kind)) fail("UNSUPPORTED_DUE_KIND");
      definition.validateInput(validated);
      return transaction(executor, async tx => {
        const inserted = await tx.insert(durableJobItems).values({ jobName: validated.jobName, scopeKey: validated.scopeKey,
          scope: validated.scope as unknown as Record<string, unknown>, dueKind: validated.due.kind, dueKey: validated.due.key,
          dueAt: new Date(validated.dueAt), definitionVersion: validated.definitionVersion,
          payloadText: validated.payloadText, payloadHash: validated.payloadHash, policyText: definition.policyText, policyHash: definition.policyHash,
          readyAt: new Date(validated.dueAt) }).onConflictDoNothing().returning();
        if (inserted.length === 1) return { kind: "inserted" as const, item: view(inserted[0]) };
        // Separate SELECT is deliberate: a same-statement CTE may not see a row
        // whose conflicting insert committed while ON CONFLICT waited.
        const [existing] = await tx.select().from(durableJobItems).where(and(eq(durableJobItems.jobName, validated.jobName),
          eq(durableJobItems.scopeKey, validated.scopeKey), eq(durableJobItems.dueKind, validated.due.kind), eq(durableJobItems.dueKey, validated.due.key)));
        if (!existing) fail("DUE_IDENTITY_UNRESOLVED");
        if (existing.definitionVersion !== validated.definitionVersion || existing.dueAt.toISOString() !== validated.dueAt ||
            existing.payloadText !== validated.payloadText || existing.payloadHash !== validated.payloadHash ||
            existing.policyText !== definition.policyText || existing.policyHash !== definition.policyHash ||
            canonicalJson(existing.scope, 1024) !== canonicalJson(validated.scope, 1024)) fail("DUE_IDENTITY_CONFLICT");
        return { kind: "existing" as const, item: view(existing) };
      });
    },
    claimReady(input: ClaimReadyInput) {
      if (!input || !Array.isArray(input.jobNames)) fail("INVALID_CLAIM_REQUEST");
      for (const name of input.jobNames) definitionFor(name);
      return transaction(executor, tx => claimReadyInTx(tx, definitions, input));
    },
    renew(claim: Claim) { return transaction(executor, tx => renewInTx(tx, definitions, claim)); },
    recordFailure(claim: Claim, failure: KnownFailure) { return transaction(executor, tx => failureInTx(tx, definitions, claim, failure)); },
    holdUnknown(claim: Claim, reason: string) { return transaction(executor, tx => holdUnknownInTx(tx, definitions, claim, reason)); },
    async withClaimedTransaction(claim: Claim, operation: (tx: TransactionType, fence: JobFence) => Promise<JobTransition>) {
      try {
        return await transaction(executor, tx => runFencedInTx(tx, definitions, claim, operation));
      } catch (error) {
        if (!(error instanceof DurableJobError) || error.code !== "COMMIT_UNCONFIRMED") throw error;
        // The failed COMMIT acknowledgement is not a known callback failure.
        // Read only after the driver transaction has settled; never rerun effects.
        try {
          const recovered = await transaction(executor, async tx => {
            const [item] = await tx.select().from(durableJobItems).where(eq(durableJobItems.id, claim.itemId));
            const [attempt] = await tx.select().from(durableJobAttempts).where(and(eq(durableJobAttempts.itemId, claim.itemId),
              eq(durableJobAttempts.generation, BigInt(claim.generation)), eq(durableJobAttempts.token, claim.token)));
            if (!item || !attempt || item.generation.toString() !== claim.generation ||
                !["yielded", "succeeded"].includes(attempt.outcome) ||
                !((attempt.outcome === "yielded" && item.state === "queued") || (attempt.outcome === "succeeded" && item.state === "succeeded"))) return null;
            return { kind: attempt.outcome === "yielded" ? "yield" as const : "complete" as const, itemId: item.id,
              result: item.result, checkpointVersion: item.checkpointVersion.toString() };
          });
          if (recovered) return recovered;
        } catch { /* Recovery read is also uncertain; preserve the original classification. */ }
        throw error;
      }
    },
    async readByIdentity(identity: DueIdentity) {
      if (!identity || typeof identity !== "object") fail("INVALID_IDENTITY");
      const validated = identityParts(identity);
      return transaction(executor, async tx => {
        const [row] = await tx.select().from(durableJobItems).where(and(eq(durableJobItems.jobName, validated.jobName),
          eq(durableJobItems.scopeKey, validated.scopeKey), eq(durableJobItems.dueKind, validated.due.kind), eq(durableJobItems.dueKey, validated.due.key)));
        if (!row) return null;
        const now = await databaseNow(tx);
        return view(row, Math.max(0, now.getTime() - row.dueAt.getTime()));
      });
    },
    async listStatus(filter: StatusFilter) {
      if (!filter || !Number.isInteger(filter.limit) || filter.limit < 1 || filter.limit > 100 ||
          (filter.jobNames && (!Array.isArray(filter.jobNames) || filter.jobNames.length < 1 || filter.jobNames.length > 100 || filter.jobNames.some(name => !definitions.has(name)))) ||
          (filter.afterId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(filter.afterId))) fail("INVALID_STATUS_FILTER");
      return transaction(executor, async tx => {
        const rows = await tx.select().from(durableJobItems)
          .where(and(filter.jobNames ? inArray(durableJobItems.jobName, [...filter.jobNames]) : undefined,
            filter.afterId ? gt(durableJobItems.id, filter.afterId) : undefined))
          .orderBy(asc(durableJobItems.id)).limit(filter.limit);
        const now = await databaseNow(tx);
        return rows.map(row => view(row, Math.max(0, now.getTime() - row.dueAt.getTime())));
      });
    },
    async readAttemptHistory(itemId: string, limit: number) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(itemId) || !Number.isInteger(limit) || limit < 1 || limit > 100) fail("INVALID_HISTORY_FILTER");
      return transaction(executor, async tx => {
        const result = await tx.execute(sql`SELECT generation::text, worker_id, claimed_at, last_lease_at, finished_at, outcome, error_code, checkpoint_version_before::text, checkpoint_version_after::text FROM durable_job_attempts WHERE item_id = ${itemId} ORDER BY generation DESC LIMIT ${limit}`);
        return result.rows;
      });
    },
  });
}
export type DurableJobStore = ReturnType<typeof createDurableJobStore>;
