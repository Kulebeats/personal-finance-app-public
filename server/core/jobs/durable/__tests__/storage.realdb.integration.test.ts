import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { durableJobAttempts, durableJobItems } from "@shared/durable-jobs-schema";
import { db } from "../../../../db";
import { getPostgresError } from "../../../../utils/postgresError";
import { createDurableJobStore, type DurableExecutor } from "../store";
import { snapshotDefinitions } from "../catalog";
import { claimReadyInTx, ownedTransactionSettings, renewInTx } from "../claims";
import { canonicalJson, sha256 } from "../contracts";
import { FIXTURE_NAME, fixtureStore, requestFor, syntheticDefinition } from "./fixtures";

describe("R14 durable storage (protected disposable PostgreSQL)", () => {
  const owned: string[] = [];
  const seededPrefixes: string[] = [];
  const store = fixtureStore(db);
  const register = async (request = requestFor()) => {
    const response = await store.enqueue(request);
    owned.push(response.item.id);
    return response;
  };
  beforeAll(() => { if (!process.env.TEST_RUN_ID || process.env.PFA_TEST_MODE !== "database") throw new Error("PROTECTED_DATABASE_MODE_REQUIRED"); });
  afterEach(async () => {
    for (const prefix of seededPrefixes.splice(0)) {
      await db.execute(sql`DELETE FROM durable_job_attempts WHERE item_id IN (SELECT id FROM durable_job_items WHERE due_key LIKE ${`${prefix}%`})`);
      await db.execute(sql`DELETE FROM durable_job_items WHERE due_key LIKE ${`${prefix}%`}`);
    }
    for (const id of new Set(owned.splice(0))) {
      await db.delete(durableJobAttempts).where(eq(durableJobAttempts.itemId, id));
      await db.delete(durableJobItems).where(eq(durableJobItems.id, id));
    }
  });

  it("concurrent replay has one natural row; immutable conflicts cannot reset a terminal row", async () => {
    const request = requestFor(`event:${randomUUID()}`);
    const [a, b] = await Promise.all([store.enqueue(request), store.enqueue(request)]);
    owned.push(a.item.id);
    expect(a.item.id).toBe(b.item.id);
    expect([a.kind, b.kind].sort()).toEqual(["existing", "inserted"]);
    expect(a.item).not.toHaveProperty("claimToken");
    const claim = (await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "storage-a", limit: 1 })).claims[0];
    expect(claim.itemId).toBe(a.item.id);
    expect((await store.holdUnknown(claim, "SYNTHETIC_UNKNOWN")).kind).toBe("outcome_unknown");
    expect((await store.enqueue(request)).item.id).toBe(a.item.id);
    await expect(store.enqueue({ ...request, payload: { count: 2, eventKey: request.due.key } })).rejects.toThrow("DUE_IDENTITY_CONFLICT");
    await expect(store.enqueue({ ...request, dueAt: "2001-01-01T00:00:00.000Z" })).rejects.toThrow("DUE_IDENTITY_CONFLICT");
    await expect(store.enqueue({ ...request, definitionVersion: "v2" })).rejects.toThrow("UNSUPPORTED_DEFINITION_VERSION");
    const differentPolicy = createDurableJobStore(db, [syntheticDefinition({ leaseMs: 1000, maxClaimLifetimeMs: 5000, retryFailureLimit: 3, retryDelaysMs: [0, 0] })]);
    await expect(differentPolicy.enqueue(request)).rejects.toThrow("DUE_IDENTITY_CONFLICT");
    expect((await store.readByIdentity(request))?.state).toBe("outcome_unknown");
    expect((await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "unknown-scanner", limit: 1 })).claims).toHaveLength(0);
    const otherScope = await register(requestFor(request.due.key, 1, { kind: "household", householdId: randomUUID() }));
    expect(otherScope.item.id).not.toBe(a.item.id);
    const duplicate = await db.execute(sql`SELECT count(*)::int AS n FROM durable_job_items WHERE job_name = ${FIXTURE_NAME} AND due_key = ${request.due.key} AND scope_key = '["global"]'`);
    expect(duplicate.rows[0].n).toBe(1);
    await expect(db.execute(sql`INSERT INTO durable_job_items (job_name,scope_key,scope,due_kind,due_key,due_at,definition_version,payload_text,payload_hash,policy_text,policy_hash,ready_at) SELECT job_name,scope_key,scope,due_kind,due_key,due_at,definition_version,payload_text,payload_hash,policy_text,policy_hash,ready_at FROM durable_job_items WHERE id = ${a.item.id}`)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO durable_job_items (job_name,scope_key,scope,due_kind,due_key,due_at,definition_version,payload_text,payload_hash,policy_text,policy_hash,ready_at) SELECT job_name,NULL,scope,due_kind,due_key,due_at,definition_version,payload_text,payload_hash,policy_text,policy_hash,ready_at FROM durable_job_items WHERE id = ${a.item.id}`)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO durable_job_items (job_name,scope_key,scope,due_kind,due_key,due_at,definition_version,payload_text,payload_hash,policy_text,policy_hash,ready_at) SELECT job_name,'["global",null]',scope,due_kind,due_key,due_at,definition_version,payload_text,payload_hash,policy_text,policy_hash,ready_at FROM durable_job_items WHERE id = ${a.item.id}`)).rejects.toThrow();
  });

  it("refuses inactive versions without SQL, regardless of identity occupancy or active payload rules", async () => {
    const request = requestFor();
    const noSql = createDurableJobStore({
      execute: () => { throw new Error("SQL_MUST_NOT_RUN"); },
      transaction: () => { throw new Error("TRANSACTION_MUST_NOT_RUN"); },
    } as unknown as DurableExecutor, [syntheticDefinition()]);
    const inactive = { ...request, definitionVersion: "v2", payload: { count: 0, eventKey: request.due.key } };
    await expect(noSql.enqueue(inactive)).rejects.toThrow("UNSUPPORTED_DEFINITION_VERSION");
    await expect(store.enqueue(inactive)).rejects.toThrow("UNSUPPORTED_DEFINITION_VERSION");
    const result = await db.execute(sql`SELECT count(*)::int AS n FROM durable_job_items WHERE job_name = ${FIXTURE_NAME} AND due_key = ${request.due.key}`);
    expect(result.rows[0].n).toBe(0);
    const accepted = await register(request);
    await expect(noSql.enqueue(inactive)).rejects.toThrow("UNSUPPORTED_DEFINITION_VERSION");
    await expect(store.enqueue(inactive)).rejects.toThrow("UNSUPPORTED_DEFINITION_VERSION");
    const v2 = createDurableJobStore(db, [{ ...syntheticDefinition(), version: "v2" }]);
    await expect(v2.enqueue({ ...request, definitionVersion: "v2" })).rejects.toThrow("DUE_IDENTITY_CONFLICT");
    await expect(noSql.enqueue({ ...request, payload: { count: 0, eventKey: request.due.key } })).rejects.toThrow("INVALID_SYNTHETIC_INPUT");
    expect((await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "version-control", limit: 1 })).claims[0].itemId).toBe(accepted.item.id);
  });

  it("refuses inactive admission while the same identity is uncommitted elsewhere", async () => {
    const template = await register();
    const pending = requestFor();
    const payload = canonicalJson(pending.payload, 65_536);
    let release!: () => void; let entered!: () => void;
    const enteredGate = new Promise<void>(resolve => { entered = resolve; });
    const holdGate = new Promise<void>(resolve => { release = resolve; });
    const holder = db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '5s'`);
      await tx.execute(sql`INSERT INTO durable_job_items
        (job_name,scope_key,scope,due_kind,due_key,due_at,definition_version,payload_text,payload_hash,policy_text,policy_hash,ready_at)
        SELECT job_name,scope_key,scope,due_kind,${pending.due.key},due_at,definition_version,
          ${payload},${sha256(payload)},policy_text,policy_hash,ready_at FROM durable_job_items WHERE id = ${template.item.id}`);
      entered();
      await holdGate;
    });
    await enteredGate;
    try {
      await expect(store.enqueue({ ...pending, definitionVersion: "v2", payload: { count: 0, eventKey: pending.due.key } })).rejects.toThrow("UNSUPPORTED_DEFINITION_VERSION");
    } finally { release(); await holder; }
    const row = await db.execute(sql`SELECT id FROM durable_job_items WHERE job_name = ${FIXTURE_NAME} AND due_key = ${pending.due.key}`);
    expect(row.rows).toHaveLength(1);
    owned.push(row.rows[0].id as string);
  });

  it("database checks reject JSON-null scope and invalid policy fields independently", async () => {
    const item = await register();
    const [stored] = await db.select().from(durableJobItems).where(eq(durableJobItems.id, item.item.id));
    const checks = await db.execute(sql`SELECT
      r14_durable_policy_valid(${stored.policyText}) AS valid,
      r14_durable_policy_valid(${"{}"}) AS missing,
      r14_durable_policy_valid(NULL::text) AS sql_null,
      r14_durable_policy_valid(${JSON.stringify({ leaseMs: null, maxClaimLifetimeMs: 120000, retryFailureLimit: 3, retryDelaysMs: [0, 0] })}) AS json_null,
      r14_durable_policy_valid(${JSON.stringify({ leaseMs: "30000", maxClaimLifetimeMs: 120000, retryFailureLimit: 3, retryDelaysMs: [0, 0] })}) AS wrong_type,
      r14_durable_policy_valid(${JSON.stringify({ leaseMs: 30000, maxClaimLifetimeMs: 120000, retryFailureLimit: 3, retryDelaysMs: [-1, 0] })}) AS bad_delay,
      r14_durable_policy_valid(${'x'.repeat(2049)}) AS oversized`);
    expect(checks.rows[0]).toMatchObject({ valid: true, missing: false, sql_null: false, json_null: false, wrong_type: false, bad_delay: false, oversized: false });
    const clone = sql`INSERT INTO durable_job_items (job_name,scope_key,scope,due_kind,due_key,due_at,definition_version,payload_text,payload_hash,policy_text,policy_hash,ready_at)
      SELECT job_name, ${'["household",""]'}, '{"kind":"household","householdId":null}'::jsonb, due_kind, due_key || ':null-scope', due_at, definition_version, payload_text, payload_hash, policy_text, policy_hash, ready_at
      FROM durable_job_items WHERE id = ${item.item.id}`;
    await expect(db.execute(clone)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO durable_job_items (job_name,scope_key,scope,due_kind,due_key,due_at,definition_version,payload_text,payload_hash,policy_text,policy_hash,ready_at)
      SELECT job_name, scope_key, scope, due_kind, due_key || ':null-lease', due_at, definition_version, payload_text, payload_hash,
        jsonb_set(policy_text::jsonb, '{leaseMs}', 'null'::jsonb)::text, policy_hash, ready_at
      FROM durable_job_items WHERE id = ${item.item.id}`)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO durable_job_items (job_name,scope_key,scope,due_kind,due_key,due_at,definition_version,payload_text,payload_hash,policy_text,policy_hash,ready_at)
      SELECT job_name, scope_key, scope, due_kind, due_key || ':negative-delay', due_at, definition_version, payload_text, payload_hash,
        jsonb_set(policy_text::jsonb, '{retryDelaysMs,0}', '-1'::jsonb)::text, policy_hash, ready_at
      FROM durable_job_items WHERE id = ${item.item.id}`)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO durable_job_items (job_name,scope_key,scope,due_kind,due_key,due_at,definition_version,payload_text,payload_hash,policy_text,policy_hash,ready_at)
      SELECT job_name, scope_key, scope, due_kind, due_key || ':invalid-payload', due_at, definition_version,
        'not-json', payload_hash, policy_text, policy_hash, ready_at FROM durable_job_items WHERE id = ${item.item.id}`)).rejects.toThrow();
  });

  it("rejects incoherent running-item and attempt chronology at the SQL boundary", async () => {
    const item = await register();
    const claim = (await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "constraint-owner", limit: 1 })).claims[0];
    expect(claim.itemId).toBe(item.item.id);
    const precision = await db.execute(sql`SELECT item.claimed_at = attempt.claimed_at AS exact,
      item.claimed_at::text AS item_time, attempt.claimed_at::text AS attempt_time
      FROM durable_job_items AS item JOIN durable_job_attempts AS attempt ON attempt.item_id = item.id
      WHERE item.id = ${item.item.id}`);
    expect(precision.rows[0].exact).toBe(true);
    expect(precision.rows[0].item_time).toBe(precision.rows[0].attempt_time);
    await expect(db.execute(sql`UPDATE durable_job_items SET generation = 0, claim_count = 0 WHERE id = ${item.item.id}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE durable_job_items SET claimed_at = lease_until WHERE id = ${item.item.id}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE durable_job_items SET claimed_at = 'infinity'::timestamptz WHERE id = ${item.item.id}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE durable_job_attempts SET last_lease_at = claimed_at - interval '1 microsecond' WHERE item_id = ${item.item.id}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE durable_job_attempts SET outcome = 'expired', finished_at = claimed_at - interval '1 microsecond', error_code = 'LEASE_EXPIRED', checkpoint_version_after = checkpoint_version_before WHERE item_id = ${item.item.id}`)).rejects.toThrow();
    expect((await store.renew(claim)).kind).toBe("renewed");
  });

  it("enforces distinct attempt generation and token per item at the SQL boundary", async () => {
    const item = await register();
    const claim = (await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "attempt-unique", limit: 1 })).claims[0];
    expect(claim.itemId).toBe(item.item.id);
    const expectUniqueConstraint = async (run: () => Promise<unknown>, constraint: string) => {
      let error: unknown;
      try { await run(); } catch (caught) { error = caught; }
      expect(getPostgresError(error)).toMatchObject({ code: "23505", constraint });
    };
    await expectUniqueConstraint(() => db.execute(sql`INSERT INTO durable_job_attempts
      (item_id,generation,token,worker_id,claimed_at,last_lease_at,outcome,checkpoint_version_before)
      SELECT item_id,generation,${randomUUID()},worker_id,claimed_at,last_lease_at,outcome,checkpoint_version_before
      FROM durable_job_attempts WHERE item_id = ${item.item.id}`), "durable_job_attempts_generation_key");
    await expectUniqueConstraint(() => db.execute(sql`INSERT INTO durable_job_attempts
      (item_id,generation,token,worker_id,claimed_at,last_lease_at,outcome,checkpoint_version_before)
      SELECT item_id,generation + 1,token,worker_id,claimed_at,last_lease_at,outcome,checkpoint_version_before
      FROM durable_job_attempts WHERE item_id = ${item.item.id}`), "durable_job_attempts_token_key");
    const retained = await db.select().from(durableJobAttempts).where(eq(durableJobAttempts.itemId, item.item.id));
    expect(retained).toHaveLength(1);
    expect(retained[0].generation.toString()).toBe("1");
    expect((await store.renew(claim)).kind).toBe("renewed");
  });

  it("paginates production status by UUID across names and filters registered jobs", async () => {
    const otherName = `${FIXTURE_NAME}.status-other`;
    const reads = createDurableJobStore(db, [syntheticDefinition(), { ...syntheticDefinition(), name: otherName }]);
    const first = await register();
    const second = await register();
    const third = await register();
    const other = await reads.enqueue({ ...requestFor(), jobName: otherName });
    owned.push(other.item.id);
    const claim = (await reads.claimReady({ jobNames: [otherName], workerId: "status-owner", limit: 1 })).claims[0];
    expect(claim.itemId).toBe(other.item.id);

    const expected = [first.item.id, second.item.id, third.item.id, other.item.id].sort();
    const page1 = await reads.listStatus({ jobNames: [FIXTURE_NAME, otherName], limit: 2 });
    const page2 = await reads.listStatus({ jobNames: [FIXTURE_NAME, otherName], afterId: page1[1].id, limit: 2 });
    const page3 = await reads.listStatus({ jobNames: [FIXTURE_NAME, otherName], afterId: page2[1].id, limit: 2 });
    expect(page1.map(row => row.id)).toEqual(expected.slice(0, 2));
    expect(page2.map(row => row.id)).toEqual(expected.slice(2));
    expect(page3).toEqual([]);
    expect((await reads.listStatus({ jobNames: [FIXTURE_NAME], limit: 100 })).map(row => row.id))
      .toEqual([first.item.id, second.item.id, third.item.id].sort());
    const running = [...page1, ...page2].find(row => row.id === other.item.id);
    expect(running).toMatchObject({ state: "running", owner: "status-owner", generation: "1", claimCount: "1" });
    expect(running?.lagMs).toBeGreaterThanOrEqual(0);
    expect(running).not.toHaveProperty("claimToken");
  });

  it("reads retained attempt history in descending generation order with bounded results", async () => {
    const item = await register();
    const first = (await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "history-first", limit: 1 })).claims[0];
    expect(first.itemId).toBe(item.item.id);
    expect((await store.recordFailure(first, { kind: "retryable", code: "KNOWN_TEST_FAILURE" })).kind).toBe("retry_wait");
    const second = (await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "history-second", limit: 1 })).claims[0];
    expect(second.itemId).toBe(item.item.id);
    expect((await store.holdUnknown(second, "SYNTHETIC_UNKNOWN")).kind).toBe("outcome_unknown");

    const latest = await store.readAttemptHistory(item.item.id, 1);
    const all = await store.readAttemptHistory(item.item.id, 2);
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ generation: "2", worker_id: "history-second", outcome: "unknown",
      error_code: "SYNTHETIC_UNKNOWN", checkpoint_version_before: "0", checkpoint_version_after: "0" });
    expect(all).toHaveLength(2);
    expect(all[0]).toEqual(latest[0]);
    expect(all[1]).toMatchObject({ generation: "1", worker_id: "history-first", outcome: "retryable_failed",
      error_code: "KNOWN_TEST_FAILURE", checkpoint_version_before: "0", checkpoint_version_after: "0" });
    for (const attempt of all) {
      expect(attempt.claimed_at).toBeTruthy();
      expect(attempt.last_lease_at).toBeTruthy();
      expect(attempt.finished_at).toBeTruthy();
      expect(attempt).not.toHaveProperty("token");
    }
    expect(await store.readAttemptHistory(randomUUID(), 2)).toEqual([]);
    await expect(store.readAttemptHistory(item.item.id, 0)).rejects.toThrow("INVALID_HISTORY_FILTER");
    await expect(store.readAttemptHistory(item.item.id, 101)).rejects.toThrow("INVALID_HISTORY_FILTER");
  });

  it("refuses a locally valid missing or mismatched current attempt without changing the item", async () => {
    for (const damage of ["delete", "token", "finalized"] as const) {
      const item = await register();
      const claim = (await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: `corrupt-${damage}`, limit: 1 })).claims[0];
      if (damage === "delete") await db.execute(sql`DELETE FROM durable_job_attempts WHERE item_id = ${item.item.id}`);
      if (damage === "token") await db.execute(sql`UPDATE durable_job_attempts SET token = ${randomUUID()} WHERE item_id = ${item.item.id}`);
      if (damage === "finalized") await db.execute(sql`UPDATE durable_job_attempts SET outcome = 'expired', finished_at = clock_timestamp(), error_code = 'LEASE_EXPIRED', checkpoint_version_after = checkpoint_version_before WHERE item_id = ${item.item.id}`);
      const before = (await db.select().from(durableJobItems).where(eq(durableJobItems.id, item.item.id)))[0];
      await expect(store.renew(claim)).rejects.toThrow("INVALID_STORED_CLAIM");
      await expect(store.recordFailure(claim, { kind: "retryable", code: "KNOWN_TEST_FAILURE" })).rejects.toThrow("INVALID_STORED_CLAIM");
      await expect(store.holdUnknown(claim, "SYNTHETIC_UNKNOWN")).rejects.toThrow("INVALID_STORED_CLAIM");
      await db.execute(sql`UPDATE durable_job_items SET lease_until = clock_timestamp() WHERE id = ${item.item.id}`);
      await expect(store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "corrupt-scan", limit: 1 })).rejects.toThrow("INVALID_STORED_CLAIM");
      const after = (await db.select().from(durableJobItems).where(eq(durableJobItems.id, item.item.id)))[0];
      expect(after.state).toBe(before.state);
      expect(after.failureCount).toBe(before.failureCount);
      expect(after.generation).toBe(before.generation);
      await db.delete(durableJobAttempts).where(eq(durableJobAttempts.itemId, item.item.id));
      await db.delete(durableJobItems).where(eq(durableJobItems.id, item.item.id));
    }
  });

  it("refuses a retry item whose retained previous attempt was removed", async () => {
    const item = await register();
    const current = (await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "retry-history", limit: 1 })).claims[0];
    expect((await store.recordFailure(current, { kind: "retryable", code: "KNOWN_TEST_FAILURE" })).kind).toBe("retry_wait");
    await db.execute(sql`DELETE FROM durable_job_attempts WHERE item_id = ${item.item.id}`);
    await expect(store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "retry-history-next", limit: 1 })).rejects.toThrow("INVALID_STORED_CLAIM");
    const [row] = await db.select().from(durableJobItems).where(eq(durableJobItems.id, item.item.id));
    expect(row.state).toBe("retry_wait");
    expect(row.generation.toString()).toBe("1");
  });

  it("two workers get one committed claim and retained attempt; SKIP LOCKED leaves other rows available", async () => {
    const single = await register();
    const [first, second] = await Promise.all([
      store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "single-x", limit: 1 }),
      store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "single-y", limit: 1 }),
    ]);
    expect(first.claims.length + second.claims.length).toBe(1);
    expect([...first.claims, ...second.claims][0].itemId).toBe(single.item.id);
    const a = await register();
    const b = await register();
    const [x, y] = await Promise.all([
      store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "claim-x", limit: 1 }),
      store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "claim-y", limit: 1 }),
    ]);
    expect(x.claims.length + y.claims.length).toBe(2);
    expect(new Set([...x.claims, ...y.claims].map(c => c.itemId))).toEqual(new Set([a.item.id, b.item.id]));
    for (const claim of [...x.claims, ...y.claims]) {
      const attempts = await db.select().from(durableJobAttempts).where(eq(durableJobAttempts.itemId, claim.itemId));
      expect(attempts).toHaveLength(1);
      expect(attempts[0].generation.toString()).toBe("1");
      expect((await store.renew({ ...claim, workerId: "forged-owner" })).kind).toBe("stale");
      expect((await store.renew(claim)).kind).toBe("renewed");
    }
  });

  it("rejects unregistered failure and unknown codes without changing ownership", async () => {
    const item = await register();
    const current = (await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "code-control", limit: 1 })).claims[0];
    await expect(store.recordFailure(current, { kind: "retryable", code: "CALLER_CHOSEN_CODE" })).rejects.toThrow("UNREGISTERED_FAILURE_CODE");
    await expect(store.holdUnknown(current, "CALLER_CHOSEN_CODE")).rejects.toThrow("UNREGISTERED_UNKNOWN_REASON");
    const row = (await db.select().from(durableJobItems).where(eq(durableJobItems.id, item.item.id)))[0];
    expect(row.state).toBe("running");
    expect(row.failureCount).toBe(0);
    expect((await db.select().from(durableJobAttempts).where(eq(durableJobAttempts.itemId, item.item.id)))[0].outcome).toBe("running");
  });

  it("expiry at equality consumes one failure, preserves backoff, then grants a new generation", async () => {
    const policyStore = createDurableJobStore(db, [syntheticDefinition({ leaseMs: 30_000, maxClaimLifetimeMs: 120_000, retryFailureLimit: 2, retryDelaysMs: [60_000] })]);
    const item = await policyStore.enqueue(requestFor()); owned.push(item.item.id);
    const first = (await policyStore.claimReady({ jobNames: [FIXTURE_NAME], workerId: "lease-a", limit: 1 })).claims[0];
    await db.execute(sql`UPDATE durable_job_items SET lease_until = clock_timestamp() WHERE id = ${item.item.id}`);
    expect((await policyStore.renew(first)).kind).toBe("stale");
    const expired = await policyStore.claimReady({ jobNames: [FIXTURE_NAME], workerId: "lease-b", limit: 1 });
    expect(expired.visitedCount).toBe(1);
    expect(expired.claims).toHaveLength(0);
    expect((await policyStore.claimReady({ jobNames: [FIXTURE_NAME], workerId: "lease-c", limit: 1 })).claims).toHaveLength(0);
    const [waiting] = await db.select().from(durableJobItems).where(eq(durableJobItems.id, item.item.id));
    expect(waiting.failureCount).toBe(1);
    expect(waiting.state).toBe("retry_wait");
    const waitCheck = await db.execute(sql`SELECT ready_at > clock_timestamp() + interval '50 seconds' AS delayed FROM durable_job_items WHERE id = ${item.item.id}`);
    expect(waitCheck.rows[0].delayed).toBe(true);
    await db.execute(sql`UPDATE durable_job_items SET ready_at = clock_timestamp() - interval '1 second' WHERE id = ${item.item.id}`);
    const second = (await policyStore.claimReady({ jobNames: [FIXTURE_NAME], workerId: "lease-d", limit: 1 })).claims[0];
    expect(second.generation).toBe("2");
    expect(second.token).not.toBe(first.token);
    expect((await policyStore.recordFailure(first, { kind: "retryable", code: "KNOWN_TEST_FAILURE" })).kind).toBe("stale");
    expect((await policyStore.recordFailure(second, { kind: "retryable", code: "KNOWN_TEST_FAILURE" })).kind).toBe("dead");
    expect((await policyStore.claimReady({ jobNames: [FIXTURE_NAME], workerId: "lease-e", limit: 1 })).claims).toHaveLength(0);
    expect((await db.select().from(durableJobAttempts).where(eq(durableJobAttempts.itemId, item.item.id)).orderBy(asc(durableJobAttempts.generation))).map(x => x.outcome)).toEqual(["expired", "retryable_failed"]);
  });

  it("rechecks DB time after an actual row-lock wait before renewal and concurrent expiry scans", async () => {
    const policyStore = createDurableJobStore(db, [syntheticDefinition({ leaseMs: 2000, maxClaimLifetimeMs: 5000, retryFailureLimit: 2, retryDelaysMs: [60_000] })]);
    const item = await policyStore.enqueue(requestFor()); owned.push(item.item.id);
    const current = (await policyStore.claimReady({ jobNames: [FIXTURE_NAME], workerId: "lock-wait-owner", limit: 1 })).claims[0];
    let announcePid!: (pid: number) => void;
    const holderPid = new Promise<number>(resolve => { announcePid = resolve; });
    let allowExpiryCheck!: () => void;
    const expiryCheckGate = new Promise<void>(resolve => { allowExpiryCheck = resolve; });
    const holder = db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '6s'`);
      await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
      await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '5s'`);
      await tx.select().from(durableJobItems).where(eq(durableJobItems.id, item.item.id)).for("update");
      await tx.execute(sql`UPDATE durable_job_items SET lease_until = clock_timestamp() + interval '2 seconds' WHERE id = ${item.item.id}`);
      const backend = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      announcePid(Number(backend.rows[0].pid));
      await expiryCheckGate;
      const initiallyLive = await tx.execute(sql`SELECT lease_until > clock_timestamp() AS live FROM durable_job_items WHERE id = ${item.item.id}`);
      expect(initiallyLive.rows[0].live).toBe(true); // The waiter began while the lease was live.
      let observedExpiry = false;
      const expiryDeadline = performance.now() + 4000;
      while (performance.now() < expiryDeadline) {
        const time = await tx.execute(sql`SELECT lease_until <= clock_timestamp() AS expired FROM durable_job_items WHERE id = ${item.item.id}`);
        if (time.rows[0].expired === true) { observedExpiry = true; break; } // Database clock, not a guessed delay.
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(observedExpiry).toBe(true);
    });
    const pid = await holderPid;
    const renewal = policyStore.renew(current); // This second pool connection must wait on the held row.
    try {
      let observedWait = false;
      const deadline = performance.now() + 1000;
      while (performance.now() < deadline) {
        const blocking = await db.execute(sql`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity AS activity WHERE activity.pid <> pg_backend_pid()
          AND ${pid} = ANY(pg_blocking_pids(activity.pid))) AS blocked`);
        if (blocking.rows[0].blocked === true) { observedWait = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(observedWait).toBe(true);
      allowExpiryCheck();
      await holder;
      expect((await renewal).kind).toBe("stale");
      const [scannerA, scannerB] = await Promise.all([
        policyStore.claimReady({ jobNames: [FIXTURE_NAME], workerId: "expiry-a", limit: 1 }),
        policyStore.claimReady({ jobNames: [FIXTURE_NAME], workerId: "expiry-b", limit: 1 }),
      ]);
      expect(scannerA.claims).toHaveLength(0);
      expect(scannerB.claims).toHaveLength(0);
      expect(scannerA.visitedCount + scannerB.visitedCount).toBe(1);
      const [row] = await db.select().from(durableJobItems).where(eq(durableJobItems.id, item.item.id));
      expect(row.state).toBe("retry_wait");
      expect(row.failureCount).toBe(1);
      expect(row.generation.toString()).toBe("1");
      const attempts = await db.select().from(durableJobAttempts).where(eq(durableJobAttempts.itemId, item.item.id));
      expect(attempts).toHaveLength(1);
      expect(attempts[0].outcome).toBe("expired");
    } finally {
      allowExpiryCheck();
      await holder.catch(() => undefined);
      await renewal.catch(() => undefined);
    }
  });

  it("keeps an extended lease live while an expiry scanner skips its locked renewal", async () => {
    const definition = syntheticDefinition({ leaseMs: 5_000, maxClaimLifetimeMs: 12_000, retryFailureLimit: 2, retryDelaysMs: [60_000] });
    const policyStore = createDurableJobStore(db, [definition]);
    const item = await policyStore.enqueue(requestFor()); owned.push(item.item.id);
    const current = (await policyStore.claimReady({ jobNames: [FIXTURE_NAME], workerId: "renew-first", limit: 1 })).claims[0];
    const shortened = await db.execute(sql`UPDATE durable_job_items
      SET lease_until = clock_timestamp() + interval '2 seconds' WHERE id = ${item.item.id}
      RETURNING lease_until::text AS old_lease`);
    const oldLease = shortened.rows[0].old_lease as string;
    let entered!: () => void; let failEntry!: (error: unknown) => void; let release!: () => void;
    const enteredGate = new Promise<void>((resolve, reject) => { entered = resolve; failEntry = reject; });
    const holdGate = new Promise<void>(resolve => { release = resolve; });
    const renewal = db.transaction(async tx => {
      await ownedTransactionSettings(tx);
      const answer = await renewInTx(tx, snapshotDefinitions([definition]), current);
      entered();
      await holdGate;
      return answer;
    });
    void renewal.catch(failEntry);
    await enteredGate;
    try {
      let oldLeaseExpired = false;
      const deadline = performance.now() + 4000;
      while (performance.now() < deadline) {
        const clock = await db.execute(sql`SELECT ${oldLease}::timestamptz <= clock_timestamp() AS expired`);
        if (clock.rows[0].expired === true) { oldLeaseExpired = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(oldLeaseExpired).toBe(true);
      const committed = await db.execute(sql`SELECT lease_until <= clock_timestamp() AS eligible
        FROM durable_job_items WHERE id = ${item.item.id}`);
      expect(committed.rows[0].eligible).toBe(true);
      const scanner = await policyStore.claimReady({ jobNames: [FIXTURE_NAME], workerId: "renew-scanner", limit: 1 });
      expect(scanner.visitedCount).toBe(0);
      expect(scanner.claims).toHaveLength(0);
      expect(scanner.moreEligible).toBe(true); // The committed old lease is visible but its item is locked.
    } finally { release(); await renewal; }
    expect((await renewal).kind).toBe("renewed");
    const checked = await db.execute(sql`SELECT item.lease_until > clock_timestamp() AS live,
      item.generation::text AS generation, item.failure_count AS failures,
      count(attempt.id)::int AS attempts, bool_and(attempt.outcome = 'running') AS running
      FROM durable_job_items AS item JOIN durable_job_attempts AS attempt ON attempt.item_id = item.id
      WHERE item.id = ${item.item.id} GROUP BY item.id`);
    expect(checked.rows[0]).toMatchObject({ live: true, generation: "1", failures: 0, attempts: 1, running: true });
  });

  it("makes a contending renewal stale after an expiry scanner commits exactly one failure", async () => {
    const definition = syntheticDefinition({ leaseMs: 30_000, maxClaimLifetimeMs: 120_000, retryFailureLimit: 2, retryDelaysMs: [60_000] });
    const policyStore = createDurableJobStore(db, [definition]);
    const item = await policyStore.enqueue(requestFor()); owned.push(item.item.id);
    const current = (await policyStore.claimReady({ jobNames: [FIXTURE_NAME], workerId: "expire-first", limit: 1 })).claims[0];
    await db.execute(sql`UPDATE durable_job_items SET lease_until = clock_timestamp() WHERE id = ${item.item.id}`);
    let entered!: (pid: number) => void; let release!: () => void;
    const enteredGate = new Promise<number>(resolve => { entered = resolve; });
    const holdGate = new Promise<void>(resolve => { release = resolve; });
    const expiry = db.transaction(async tx => {
      await ownedTransactionSettings(tx);
      const result = await claimReadyInTx(tx, snapshotDefinitions([definition]), { jobNames: [FIXTURE_NAME], workerId: "expiry-scanner", limit: 1 });
      const backend = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      entered(Number(backend.rows[0].pid));
      await holdGate;
      return result;
    });
    const pid = await enteredGate;
    const renewal = policyStore.renew(current);
    try {
      let blocked = false;
      const deadline = performance.now() + 1000;
      while (performance.now() < deadline) {
        const check = await db.execute(sql`SELECT EXISTS (SELECT 1 FROM pg_stat_activity AS activity
          WHERE activity.pid <> pg_backend_pid() AND ${pid} = ANY(pg_blocking_pids(activity.pid))) AS blocked`);
        if (check.rows[0].blocked === true) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
    } finally { release(); }
    expect((await expiry).visitedCount).toBe(1);
    expect((await renewal).kind).toBe("stale");
    const [row] = await db.select().from(durableJobItems).where(eq(durableJobItems.id, item.item.id));
    const attempts = await db.select().from(durableJobAttempts).where(eq(durableJobAttempts.itemId, item.item.id));
    expect(row.state).toBe("retry_wait");
    expect(row.failureCount).toBe(1);
    expect(row.generation.toString()).toBe("1");
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe("expired");
    const backend = await db.execute(sql`SELECT state FROM pg_stat_activity WHERE pid = ${pid}`);
    expect(backend.rows[0]?.state).not.toBe("idle in transaction");
  });

  it("uses database time for admission despite a wildly wrong application clock", async () => {
    const future = await register(requestFor(`event:${randomUUID()}`, 1, { kind: "global" }, "2099-01-01T00:00:00.000Z"));
    const clock = vi.spyOn(Date, "now").mockReturnValue(new Date("2100-01-01T00:00:00.000Z").getTime());
    try {
      expect((await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "clock-skew", limit: 1 })).claims).toHaveLength(0);
      const due = await register();
      const claimed = (await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "clock-skew", limit: 1 })).claims[0];
      expect(claimed.itemId).toBe(due.item.id);
      expect(claimed.itemId).not.toBe(future.item.id);
    } finally { clock.mockRestore(); }
  });

  it("limits independent due-row admission to 100 and leaves one queued", async () => {
    const prefix = randomUUID();
    for (let n = 0; n < 101; n++) await register(requestFor(`event:${prefix}:${n}`));
    const selected = await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "batch-worker", limit: 100 });
    expect(selected.visitedCount).toBe(100);
    expect(selected.claims).toHaveLength(100);
    expect(selected.moreEligible).toBe(true);
    const rows = await db.select().from(durableJobItems).where(and(eq(durableJobItems.jobName, FIXTURE_NAME), sql`${durableJobItems.dueKey} LIKE ${`event:${prefix}:%`}`));
    expect(rows.filter(x => x.state === "queued")).toHaveLength(1);
    expect(rows.filter(x => x.state === "running")).toHaveLength(100);
    const tail = await store.claimReady({ jobNames: [FIXTURE_NAME, FIXTURE_NAME], workerId: "batch-tail", limit: 100 });
    expect(tail.claims).toHaveLength(1);
    expect(tail.moreEligible).toBe(false);
  });

  it("uses one eligibility key for expired and ready rows, then due and id ties across names", async () => {
    const otherName = `${FIXTURE_NAME}.other`;
    const both = createDurableJobStore(db, [syntheticDefinition({ leaseMs: 30_000, maxClaimLifetimeMs: 120_000, retryFailureLimit: 2, retryDelaysMs: [60_000] }),
      { ...syntheticDefinition({ leaseMs: 30_000, maxClaimLifetimeMs: 120_000, retryFailureLimit: 2, retryDelaysMs: [60_000] }), name: otherName }]);
    const add = async (name: string) => {
      const response = await both.enqueue({ ...requestFor(), jobName: name }); owned.push(response.item.id); return response.item.id;
    };
    const expiredA = await add(FIXTURE_NAME);
    await both.claimReady({ jobNames: [FIXTURE_NAME], workerId: "mix-a", limit: 1 });
    const expiredB = await add(otherName);
    await both.claimReady({ jobNames: [otherName], workerId: "mix-b", limit: 1 });
    const readyA = await add(otherName);
    const readyB = await add(FIXTURE_NAME);
    const coherent = await db.transaction(async tx => {
      const anchor = (await tx.execute(sql`SELECT clock_timestamp()::text AS stamp`)).rows[0].stamp as string;
      await tx.execute(sql`UPDATE durable_job_items SET
        claimed_at = ${anchor}::timestamptz - interval '5 seconds',
        last_attempt_at = ${anchor}::timestamptz - interval '5 seconds',
        lease_until = CASE WHEN id = ${expiredA} THEN ${anchor}::timestamptz - interval '4 seconds'
          ELSE ${anchor}::timestamptz - interval '2 seconds' END
        WHERE id IN (${expiredA}, ${expiredB})`);
      await tx.execute(sql`UPDATE durable_job_attempts SET
        claimed_at = ${anchor}::timestamptz - interval '5 seconds',
        last_lease_at = ${anchor}::timestamptz - interval '5 seconds'
        WHERE item_id IN (${expiredA}, ${expiredB})`);
      await tx.execute(sql`UPDATE durable_job_items SET ready_at = CASE
        WHEN id = ${readyA} THEN ${anchor}::timestamptz - interval '3 seconds'
        ELSE ${anchor}::timestamptz - interval '1 second' END
        WHERE id IN (${readyA}, ${readyB})`);
      return tx.execute(sql`SELECT item.id, item.claimed_at = attempt.claimed_at AS same_claim,
        item.claimed_at < item.lease_until AS ordered,
        attempt.claimed_at <= attempt.last_lease_at AS heartbeat_order,
        item.lease_until <= clock_timestamp() AS expired
        FROM durable_job_items AS item JOIN durable_job_attempts AS attempt ON attempt.item_id = item.id
        WHERE item.id IN (${expiredA}, ${expiredB})`);
    });
    expect(coherent.rows).toHaveLength(2);
    for (const row of coherent.rows) expect(row).toMatchObject({ same_claim: true, ordered: true, heartbeat_order: true, expired: true });
    const names = [otherName, FIXTURE_NAME, otherName];
    const first = await both.claimReady({ jobNames: names, workerId: "mix-scan", limit: 1 });
    expect(first.visitedCount).toBe(1);
    expect(first.claims).toHaveLength(0);
    expect(first.moreEligible).toBe(true);
    const second = await both.claimReady({ jobNames: names, workerId: "mix-scan", limit: 1 });
    expect(second.claims.map(x => x.itemId)).toEqual([readyA]);
    const third = await both.claimReady({ jobNames: names, workerId: "mix-scan", limit: 1 });
    expect(third.claims).toHaveLength(0);
    expect(third.moreEligible).toBe(true);
    const fourth = await both.claimReady({ jobNames: names, workerId: "mix-scan", limit: 1 });
    expect(fourth.claims.map(x => x.itemId)).toEqual([readyB]);
    expect(fourth.moreEligible).toBe(false);
    const tieA = await add(otherName);
    const tieB = await add(FIXTURE_NAME);
    const tied = await both.claimReady({ jobNames: names, workerId: "mix-ties", limit: 2 });
    expect(tied.claims.map(x => x.itemId)).toEqual([tieA, tieB].sort());
  });

  it("reports locked eligible backlog without locking a hint row or claiming future work", async () => {
    const locked = await register();
    let release!: () => void;
    let entered!: () => void;
    const enteredGate = new Promise<void>(resolve => { entered = resolve; });
    const holdGate = new Promise<void>(resolve => { release = resolve; });
    const holder = db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '5s'`);
      await tx.select().from(durableJobItems).where(eq(durableJobItems.id, locked.item.id)).for("update");
      entered();
      await holdGate;
    });
    await enteredGate;
    try {
      const scan = await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "hint-worker", limit: 1 });
      expect(scan.visitedCount).toBe(0);
      expect(scan.moreEligible).toBe(true);
    } finally { release(); await holder; }
    const future = await register(requestFor(undefined, 1, { kind: "global" }, "2099-01-01T00:00:00.000Z"));
    const scan = await store.claimReady({ jobNames: [FIXTURE_NAME], workerId: "hint-worker", limit: 1 });
    expect(scan.claims.map(x => x.itemId)).toEqual([locked.item.id]);
    expect(scan.moreEligible).toBe(false);
    expect(future.item.state).toBe("queued");
  });

  it("exercises parameterized ordered selection and hint plans against a populated mixed ledger", async () => {
    const template = await register();
    const prefix = `event:r14-plan:${randomUUID()}`;
    const otherName = `${FIXTURE_NAME}.other`;
    const sparseName = `${FIXTURE_NAME}.sparse`;
    seededPrefixes.push(prefix);
    await db.execute(sql`WITH generated AS (
      SELECT n, class, ${prefix} || ':' || class || ':' || n::text AS due_key
      FROM generate_series(1, 400) AS n
      CROSS JOIN (VALUES ('ready'),('future'),('expired'),('live'),('terminal'),('other'),('unrelated')) AS classes(class)
    ), prepared AS (
      SELECT *, format('{"count":1,"eventKey":"%s"}', due_key) AS payload_text FROM generated
    ), inserted AS (
      INSERT INTO durable_job_items (job_name,scope_key,scope,due_kind,due_key,due_at,definition_version,
        payload_text,payload_hash,policy_text,policy_hash,state,ready_at,generation,claim_token,worker_id,
        claimed_at,lease_until,claim_count,terminal_at)
      SELECT CASE WHEN prepared.class = 'other' THEN ${otherName} WHEN prepared.class = 'unrelated' THEN 'unrelated.r14.plan'
        WHEN prepared.class = 'ready' AND n = 1 THEN ${sparseName} ELSE base.job_name END,
        base.scope_key,base.scope,base.due_kind,prepared.due_key,
        base.due_at + ((n * 3 + CASE WHEN prepared.class = 'expired' THEN 1 ELSE 0 END) * interval '1 millisecond'),
        base.definition_version,
        prepared.payload_text,encode(sha256(convert_to(prepared.payload_text,'UTF8')),'hex'),base.policy_text,base.policy_hash,
        CASE WHEN prepared.class IN ('expired','live') THEN 'running' WHEN prepared.class = 'terminal' THEN 'succeeded' ELSE 'queued' END,
        CASE WHEN prepared.class = 'future' THEN '2099-01-01'::timestamptz ELSE '2000-01-01'::timestamptz END,
        CASE WHEN prepared.class IN ('expired','live') THEN 1 ELSE 0 END,
        CASE WHEN prepared.class IN ('expired','live') THEN gen_random_uuid() ELSE NULL END,
        CASE WHEN prepared.class IN ('expired','live') THEN 'plan-owner' ELSE NULL END,
        CASE WHEN prepared.class = 'expired' THEN '1999-12-31'::timestamptz
          WHEN prepared.class = 'live' THEN clock_timestamp() - interval '1 second' ELSE NULL END,
        CASE WHEN prepared.class = 'expired' THEN '2000-01-01'::timestamptz
          WHEN prepared.class = 'live' THEN clock_timestamp() + interval '20 seconds' ELSE NULL END,
        CASE WHEN prepared.class IN ('expired','live') THEN 1 ELSE 0 END,
        CASE WHEN prepared.class = 'terminal' THEN '2000-01-01'::timestamptz ELSE NULL END
      FROM prepared CROSS JOIN durable_job_items AS base WHERE base.id = ${template.item.id}
      RETURNING id,state,generation,claim_token,worker_id,claimed_at,checkpoint_version
    )
    INSERT INTO durable_job_attempts (item_id,generation,token,worker_id,claimed_at,last_lease_at,outcome,checkpoint_version_before)
    SELECT id,generation,claim_token,worker_id,claimed_at,claimed_at,'running',checkpoint_version FROM inserted WHERE state = 'running'`);
    await db.execute(sql`ANALYZE durable_job_items`);
    const key = sql`coalesce(${durableJobItems.leaseUntil}, ${durableJobItems.readyAt})`;
    for (const names of [[FIXTURE_NAME], [FIXTURE_NAME, otherName], [sparseName]]) {
      const cutoff = (await db.execute(sql`SELECT clock_timestamp()::text AS cutoff`)).rows[0].cutoff as string;
      const predicate = and(inArray(durableJobItems.jobName, names),
        sql`${durableJobItems.state} IN ('queued','retry_wait','running')`, sql`${key} <= ${cutoff}::timestamptz`);
      const selected = await db.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT * FROM ${durableJobItems} WHERE ${predicate} ORDER BY ${key}, ${durableJobItems.dueAt}, ${durableJobItems.id}
        LIMIT ${100} FOR UPDATE SKIP LOCKED`);
      const hint = await db.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT EXISTS (SELECT 1 FROM ${durableJobItems} WHERE ${predicate} LIMIT 1) AS eligible`);
      const plan = selected.rows[0]["QUERY PLAN"];
      const summary = JSON.stringify({ names, selected: plan, hint: hint.rows[0]["QUERY PLAN"] });
      console.info(`R14 populated parameterized plan: ${summary}`);
      expect(JSON.stringify(plan)).toMatch(/durable_job_items_(?:name_)?eligibility_idx/);
      expect(JSON.stringify(plan)).not.toContain('"Node Type":"Sort"');
    }
    const both = createDurableJobStore(db, [syntheticDefinition(), { ...syntheticDefinition(), name: otherName }]);
    const mixed = await both.claimReady({ jobNames: [FIXTURE_NAME, otherName], workerId: "plan-mixed", limit: 100 });
    expect(mixed.visitedCount).toBe(100);
    expect(mixed.claims.length).toBeGreaterThan(0);
    expect(mixed.claims.length).toBeLessThan(100);
    expect(mixed.moreEligible).toBe(true);
  });
});
