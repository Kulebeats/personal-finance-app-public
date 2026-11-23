import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { durableJobAttempts, durableJobItems } from "@shared/durable-jobs-schema";
import { db } from "../../../../db";
import { assertJobFence, type JobFence } from "../fence";
import { FIXTURE_NAME, cleanupWitness, createWitnessRelation, fixtureStore, requestFor, runSyntheticChunk } from "./fixtures";
import type { DurableExecutor } from "../store";

describe("R14 transaction fence (protected disposable PostgreSQL)", () => {
  const runId = `${process.env.TEST_RUN_ID ?? "unprotected"}:${randomUUID()}`;
  const store = fixtureStore(db);
  const owned: string[] = [];
  const add = async (count: number) => {
    const result = await store.enqueue(requestFor(`event:${randomUUID()}`, count));
    owned.push(result.item.id);
    return result.item.id;
  };
  const claim = async () => (await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "fence-worker", limit: 1 })).claims[0];
  const effects = async (itemId: string) => (await db.execute(sql`SELECT effect_key FROM r14_fixture_effects WHERE item_id = ${itemId} ORDER BY effect_key`)).rows.map(row => Number(row.effect_key));
  beforeAll(async () => {
    if (!process.env.TEST_RUN_ID || process.env.PFA_TEST_MODE !== "database") throw new Error("PROTECTED_DATABASE_MODE_REQUIRED");
    await createWitnessRelation(db);
  });
  afterEach(async () => {
    await cleanupWitness(db, runId);
    for (const id of owned.splice(0)) {
      await db.delete(durableJobAttempts).where(eq(durableJobAttempts.itemId, id));
      await db.delete(durableJobItems).where(eq(durableJobItems.id, id));
    }
  });

  it("commits 100 plus checkpoint, then a new store finishes effect 101 exactly once", async () => {
    const id = await add(101);
    const first = await claim();
    expect(first.itemId).toBe(id);
    expect((await store.withClaimedTransaction(first, (tx, fence) => runSyntheticChunk(tx, fence, runId))).kind).toBe("yield");
    expect(await effects(id)).toHaveLength(100);
    const restarted = fixtureStore(db);
    const second = (await restarted.claimReady({ jobNames: [FIXTURE_NAME], workerId: "restart", limit: 1 })).claims[0];
    expect(second.itemId).toBe(id);
    expect(second.generation).toBe("2");
    expect((await restarted.withClaimedTransaction(second, (tx, fence) => runSyntheticChunk(tx, fence, runId))).kind).toBe("complete");
    expect(await effects(id)).toEqual(Array.from({ length: 101 }, (_, n) => n));
    const row = (await db.select().from(durableJobItems).where(eq(durableJobItems.id, id)))[0];
    expect(row.state).toBe("succeeded");
    expect(row.checkpointVersion.toString()).toBe("1");
    expect(row.result).toEqual({ processed: 101 });
    expect((await restarted.claimReady({ jobNames: [FIXTURE_NAME], workerId: "third", limit: 1 })).claims).toHaveLength(0);
  });

  it("rolls back effect, result and checkpoint after false completion or final lease expiry", async () => {
    const id = await add(1);
    const current = await claim();
    await expect(store.withClaimedTransaction(current, async (tx, fence) => {
      await runSyntheticChunk(tx, fence, runId);
      return { kind: "complete", result: { processed: 0 }, processedCount: 0 };
    })).rejects.toThrow("INVALID_SYNTHETIC_TRANSITION");
    expect(await effects(id)).toHaveLength(0);
    await expect(store.withClaimedTransaction(current, async (tx, fence) => {
      const transition = await runSyntheticChunk(tx, fence, runId);
      await tx.execute(sql`UPDATE durable_job_items SET lease_until = clock_timestamp() WHERE id = ${id}`);
      return transition;
    })).rejects.toThrow("STALE_JOB_FENCE_FINAL_CHECK");
    expect(await effects(id)).toHaveLength(0);
    const row = (await db.select().from(durableJobItems).where(eq(durableJobItems.id, id)))[0];
    expect(row.state).toBe("running");
    expect(row.result).toBeNull();
    expect(row.checkpoint).toBeNull();
    expect((await store.withClaimedTransaction(current, (tx, fence) => runSyntheticChunk(tx, fence, runId))).kind).toBe("complete");
    expect(await effects(id)).toEqual([0]);
  });

  it("refuses a missing pre-effect attempt and rolls back callback damage with its effect", async () => {
    const id = await add(1);
    const current = await claim();
    await db.execute(sql`DELETE FROM durable_job_attempts WHERE item_id = ${id}`);
    let invoked = false;
    await expect(store.withClaimedTransaction(current, async () => {
      invoked = true;
      return { kind: "complete", result: { processed: 1 }, processedCount: 1 };
    })).rejects.toThrow("INVALID_STORED_CLAIM");
    expect(invoked).toBe(false);
    await db.execute(sql`INSERT INTO durable_job_attempts (item_id,generation,token,worker_id,claimed_at,last_lease_at,outcome,checkpoint_version_before)
      SELECT id,generation,claim_token,worker_id,claimed_at,claimed_at,'running',checkpoint_version FROM durable_job_items WHERE id = ${id}`);
    await expect(store.withClaimedTransaction(current, async (tx, fence) => {
      const transition = await runSyntheticChunk(tx, fence, runId);
      await tx.execute(sql`DELETE FROM durable_job_attempts WHERE item_id = ${id}`);
      return transition;
    })).rejects.toThrow("INVALID_STORED_CLAIM");
    expect(await effects(id)).toHaveLength(0);
    expect((await db.select().from(durableJobAttempts).where(eq(durableJobAttempts.itemId, id)))[0].outcome).toBe("running");
    expect((await store.withClaimedTransaction(current, (tx, fence) => runSyntheticChunk(tx, fence, runId))).kind).toBe("complete");
    expect(await effects(id)).toEqual([0]);
  });

  it("rejects zero-progress, backward and oversized transitions", async () => {
    const id = await add(101);
    const current = await claim();
    await expect(store.withClaimedTransaction(current, async () => ({ kind: "yield", checkpoint: { next: 0 }, result: { processed: 0 }, processedCount: 0 }))).rejects.toThrow("INVALID_JOB_TRANSITION");
    await expect(store.withClaimedTransaction(current, async () => ({ kind: "complete", result: { processed: 101 }, processedCount: 101 }))).rejects.toThrow("INVALID_JOB_TRANSITION");
    await store.withClaimedTransaction(current, (tx, fence) => runSyntheticChunk(tx, fence, runId));
    const next = await claim();
    await expect(store.withClaimedTransaction(next, async () => ({ kind: "yield", checkpoint: { next: 50 }, result: { processed: 50 }, processedCount: 1 }))).rejects.toThrow("INVALID_SYNTHETIC_TRANSITION");
    expect(await effects(id)).toEqual(Array.from({ length: 100 }, (_, n) => n));
  });

  it("a failed effect 101 leaves the committed first 100 and retries only the last effect", async () => {
    const id = await add(101);
    const first = await claim();
    await store.withClaimedTransaction(first, (tx, fence) => runSyntheticChunk(tx, fence, runId));
    const second = await claim();
    await expect(store.withClaimedTransaction(second, async (tx, fence) => {
      await runSyntheticChunk(tx, fence, runId);
      throw new Error("synthetic callback failure after write");
    })).rejects.toThrow("JOB_TRANSACTION_FAILED");
    expect(await effects(id)).toEqual(Array.from({ length: 100 }, (_, n) => n));
    expect((await store.recordFailure(second, { kind: "retryable", code: "SYNTHETIC_WRITE_FAILED" })).kind).toBe("retry_wait");
    const third = await claim();
    expect(third.generation).toBe("3");
    expect((await store.withClaimedTransaction(third, (tx, fence) => runSyntheticChunk(tx, fence, runId))).kind).toBe("complete");
    expect(await effects(id)).toEqual(Array.from({ length: 101 }, (_, n) => n));
    const row = (await db.select().from(durableJobItems).where(eq(durableJobItems.id, id)))[0];
    expect(row.failureCount).toBe(1);
    expect(row.claimCount.toString()).toBe("3");
  });

  it("recovers a committed effect after a simulated lost COMMIT acknowledgment", async () => {
    const id = await add(1);
    const current = await claim();
    let loseAck = true;
    const ambiguous = {
      execute: db.execute.bind(db),
      transaction: async (callback: Parameters<typeof db.transaction>[0], config: Parameters<typeof db.transaction>[1]) => {
        const result = await db.transaction(callback, config);
        if (loseAck) { loseAck = false; throw new Error("simulated connection acknowledgment loss"); }
        return result;
      },
    } as DurableExecutor;
    const restarted = fixtureStore(ambiguous);
    const result = await restarted.withClaimedTransaction(current, (tx, fence) => runSyntheticChunk(tx, fence, runId));
    expect(result.kind).toBe("complete");
    expect(result.result).toEqual({ processed: 1 });
    expect(await effects(id)).toEqual([0]);
    expect((await db.select().from(durableJobAttempts).where(eq(durableJobAttempts.itemId, id))).map(x => x.outcome)).toEqual(["succeeded"]);
  });

  it("rejects cloned, other-transaction and escaped fences", async () => {
    const id = await add(1);
    const current = await claim();
    let escaped: JobFence | undefined;
    await store.withClaimedTransaction(current, async (tx, fence) => {
      escaped = fence;
      await expect(assertJobFence(tx, { ...fence })).rejects.toThrow("INVALID_JOB_FENCE");
      await expect(db.transaction(other => assertJobFence(other, fence))).rejects.toThrow("INVALID_JOB_FENCE");
      return runSyntheticChunk(tx, fence, runId);
    });
    await expect(db.transaction(other => assertJobFence(other, escaped!))).rejects.toThrow("INVALID_JOB_FENCE");
    expect(await effects(id)).toEqual([0]);
  });

  it("a held effect row lock prevents a concurrent reclaimer from granting a newer generation", async () => {
    const raceStore = fixtureStore(db, { leaseMs: 5_000, maxClaimLifetimeMs: 12_000,
      retryFailureLimit: 2, retryDelaysMs: [60_000] });
    const item = await raceStore.enqueue(requestFor(`event:${randomUUID()}`, 1));
    const id = item.item.id;
    owned.push(id);
    const current = (await raceStore.claimReady({ jobNames: [FIXTURE_NAME], workerId: "effect-owner", limit: 1 })).claims[0];
    expect(current.itemId).toBe(id);
    const shortened = await db.execute(sql`UPDATE durable_job_items
      SET lease_until = clock_timestamp() + interval '2 seconds' WHERE id = ${id}
      RETURNING lease_until::text AS old_lease`);
    const oldLease = shortened.rows[0].old_lease as string;
    let release!: () => void;
    let entered!: () => void;
    let failEntry!: (error: unknown) => void;
    const enteredPromise = new Promise<void>((resolve, reject) => { entered = resolve; failEntry = reject; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const pending = raceStore.withClaimedTransaction(current, async (tx, fence) => {
      const transition = await runSyntheticChunk(tx, fence, runId);
      entered();
      await hold;
      return transition;
    });
    void pending.catch(failEntry);
    const entryTimer = setTimeout(() => failEntry(new Error("EFFECT_ENTRY_TIMEOUT")), 4000);
    try {
      await enteredPromise;
      let crossed = false;
      const deadline = performance.now() + 4000;
      while (performance.now() < deadline) {
        const clock = await db.execute(sql`SELECT ${oldLease}::timestamptz <= clock_timestamp() AS expired`);
        if (clock.rows[0].expired === true) { crossed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(crossed).toBe(true);
      const visible = await db.execute(sql`SELECT state = 'running' AND lease_until <= clock_timestamp() AS eligible
        FROM durable_job_items WHERE id = ${id}`);
      expect(visible.rows[0].eligible).toBe(true);
      const contender = await raceStore.claimReady({ jobNames: [FIXTURE_NAME], workerId: "contender", limit: 1 });
      expect(contender.claims).toHaveLength(0);
      expect(contender.visitedCount).toBe(0);
      expect(contender.moreEligible).toBe(true);
    } finally {
      clearTimeout(entryTimer);
      release();
      await pending.catch(() => undefined);
    }
    await expect(pending).rejects.toThrow("STALE_JOB_FENCE_FINAL_CHECK");
    expect(await effects(id)).toHaveLength(0);
    const beforeExpiry = await db.execute(sql`SELECT state, generation::text AS generation,
      failure_count AS failures, lease_until <= clock_timestamp() AS expired
      FROM durable_job_items WHERE id = ${id}`);
    expect(beforeExpiry.rows[0]).toMatchObject({ state: "running", generation: "1", failures: 0, expired: true });
    const expired = await raceStore.claimReady({ jobNames: [FIXTURE_NAME], workerId: "contender", limit: 1 });
    expect(expired.claims).toHaveLength(0);
    expect(expired.visitedCount).toBe(1);
    const readback = await db.execute(sql`SELECT item.state, item.generation::text AS generation,
      item.failure_count AS failures, item.ready_at > clock_timestamp() + interval '50 seconds' AS backed_off,
      count(attempt.id)::int AS attempts, bool_and(attempt.outcome = 'expired') AS only_expired
      FROM durable_job_items AS item JOIN durable_job_attempts AS attempt ON attempt.item_id = item.id
      WHERE item.id = ${id} GROUP BY item.id`);
    expect(readback.rows[0]).toMatchObject({ state: "retry_wait", generation: "1", failures: 1,
      backed_off: true, attempts: 1, only_expired: true });
    expect((await raceStore.renew(current)).kind).toBe("stale");
  });

  it("expired pre-effect claim and a newer generation refuse the old fenced effect", async () => {
    const id = await add(1);
    const old = await claim();
    await db.execute(sql`UPDATE durable_job_items SET lease_until = clock_timestamp() WHERE id = ${id}`);
    await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "expiry", limit: 1 });
    await db.execute(sql`UPDATE durable_job_items SET ready_at = clock_timestamp() - interval '1 second' WHERE id = ${id}`);
    const next = await claim();
    expect(next.generation).toBe("2");
    expect((await store.withClaimedTransaction(old, (tx, fence) => runSyntheticChunk(tx, fence, runId))).kind).toBe("stale");
    expect((await store.holdUnknown(old, "SYNTHETIC_UNKNOWN")).kind).toBe("stale");
    expect((await store.recordFailure(old, { kind: "retryable", code: "KNOWN_TEST_FAILURE" })).kind).toBe("stale");
    expect((await store.withClaimedTransaction(next, (tx, fence) => runSyntheticChunk(tx, fence, runId))).kind).toBe("complete");
    expect(await effects(id)).toEqual([0]);
  });
});
