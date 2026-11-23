import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdMembers, households, users, userPreferences, userSessions } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { userPreferencesDefaults } from "@shared/user-preferences";
import { revokeSelectedSession, revokeUserSessions } from "../../../services/session-revocation";

const userId = randomUUID(), neighborId = randomUUID(), householdId = randomUUID();
const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const email = `r05p-${tag}@example.invalid`, neighborEmail = `r05p-neighbor-${tag}@example.invalid`;
const password = "SyntheticR05Personal123!";
const revocationActorIds: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string, neighborCookie: string;

const ownRow = () => db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
const neighborRow = () => db.select().from(userPreferences).where(eq(userPreferences.userId, neighborId));
const getOwn = () => request(app).get("/api/settings/user-preferences").set("Cookie", cookie);
const putOwn = (body: object | string) => request(app).put("/api/settings/user-preferences").set("Cookie", cookie).set("Content-Type", "application/json").send(body);

async function createRevocationActor() {
  const id = randomUUID(), actorEmail = `r05p-revocation-${id}@example.invalid`;
  revocationActorIds.push(id);
  await db.insert(users).values({
    id, email: actorEmail, username: `r05p-revocation-${id}`,
    passwordHash: await hashPassword(password), emailVerified: true,
  });
  const login = await request(app).post("/api/auth/login").send({ email: actorEmail, password }).expect(200);
  const actorCookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  const sid = decodeURIComponent(actorCookie.split(";")[0].split("=").slice(1).join("=")).slice(2).split(".")[0];
  return { id, cookie: actorCookie, sid };
}

async function blockedWriter(blockers: number[], excluded: number[]) {
  const deadline = Date.now() + 8000;
  const userRowLock = /^\s*select\s+"?id"?(?:\s|,)[\s\S]*\bfrom\s+"?users"?[\s\S]*\bfor\s+update\b/i;
  let lastWaiters: Array<{ pid: number; blockers: number[]; userRowLock: boolean }> = [];
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[]; query: string }>(`
      SELECT pid, query, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
      ORDER BY query_start`);
    const activity = new Map(result.rows.map(row => [row.pid, row]));
    // A login's background FK insert can queue ahead of the HTTP writer.
    // Keep the full wait graph so that intermediary cannot hide the holder.
    const blockingPath = (pid: number, visited = new Set<number>()): number[] | undefined => {
      if (blockers.includes(pid)) return [pid];
      if (visited.has(pid)) return;
      visited.add(pid);
      for (const blocker of activity.get(pid)?.blockers ?? []) {
        const path = blockingPath(blocker, visited);
        if (path) return [...path, pid];
      }
    };
    for (const row of result.rows) {
      if (excluded.includes(row.pid) || !userRowLock.test(row.query)) continue;
      const path = blockingPath(row.pid);
      if (path) return { ...row, blockingPath: path };
    }
    lastWaiters = result.rows.filter(row => row.blockers.length > 0).map(row => ({
      pid: row.pid, blockers: row.blockers, userRowLock: userRowLock.test(row.query),
    }));
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Expected the HTTP writer to wait on the user row lock; wait graph: ${JSON.stringify(lastWaiters)}`);
}

describe("R05 personal preferences on disposable PostgreSQL", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const passwordHash = await hashPassword(password);
    await db.insert(users).values([
      { id: userId, email, username: `r05p-${tag}`, passwordHash, emailVerified: true },
      { id: neighborId, email: neighborEmail, username: `r05p-neighbor-${tag}`, passwordHash, emailVerified: true },
    ]);
    await db.insert(households).values({ id: householdId, name: "Synthetic R05 personal preferences" });
    await db.insert(householdMembers).values({ householdId, userId: neighborId, role: "member" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    const otherLogin = await request(app).post("/api/auth/login").send({ email: neighborEmail, password }).expect(200);
    neighborCookie = (otherLogin.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  beforeEach(async () => {
    await db.delete(userPreferences).where(eq(userPreferences.userId, userId));
    await db.delete(userPreferences).where(eq(userPreferences.userId, neighborId));
    await db.insert(userPreferences).values({
      userId: neighborId, rememberLastAccount: false,
      ocrConfidenceThreshold: 20, defaultAccountFilter: "shared",
    });
  });

  afterAll(async () => {
    const fixtureUserIds = [userId, neighborId, ...revocationActorIds];
    for (const id of fixtureUserIds) {
      await db.delete(auditLogs).where(eq(auditLogs.userId, id));
      await db.delete(userPreferences).where(eq(userPreferences.userId, id));
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [id]);
    }
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    for (const id of fixtureUserIds) await db.delete(users).where(eq(users.id, id));
  });

  it("GET exposes all declared defaults without a household or inserted row", async () => {
    expect((await getOwn().expect(200)).body.data.preferences).toEqual({
      userId, ...userPreferencesDefaults, createdAt: null, updatedAt: null,
    });
    expect(await ownRow()).toHaveLength(0);
  });

  it("requires authentication for both methods", async () => {
    await request(app).get("/api/settings/user-preferences").expect(401);
    await request(app).put("/api/settings/user-preferences")
      .send({ rememberLastAccount: false }).expect(401);
    expect(await ownRow()).toHaveLength(0);
  });

  it("persists all nine fields and filter, including false and zero, with full readback", async () => {
    const patch = {
      rememberLastAccount: false, rememberLastCategoryPerMerchant: false,
      defaultTransactionType: "transfer", autoFillTodayDate: false,
      skipDuplicateImports: false, autoAssignCategoriesFromRules: false,
      autoCreateFromReceipt: true, requireOcrReview: false,
      ocrConfidenceThreshold: 0, defaultAccountFilter: "mine",
    };
    const written = await putOwn(patch).expect(200);
    expect(written.body.data.preferences).toMatchObject({ userId, ...patch });
    expect(written.body.data.preferences.createdAt).toEqual(expect.any(String));
    expect(written.body.data.preferences.updatedAt).toEqual(expect.any(String));
    expect((await ownRow())[0]).toMatchObject({ userId, ...patch });
    expect((await getOwn().expect(200)).body.data.preferences).toEqual(written.body.data.preferences);
  });

  it("accepts the upper percentage boundary and merges disjoint partial edits", async () => {
    await putOwn({ ocrConfidenceThreshold: 100 }).expect(200);
    await putOwn({ rememberLastAccount: false }).expect(200);
    await putOwn({ defaultAccountFilter: "shared" }).expect(200);
    expect((await ownRow())[0]).toMatchObject({
      ocrConfidenceThreshold: 100, rememberLastAccount: false,
      rememberLastCategoryPerMerchant: true, defaultAccountFilter: "shared",
    });
    expect((await getOwn().expect(200)).body.data.preferences).toMatchObject({
      ocrConfidenceThreshold: 100, rememberLastAccount: false, defaultAccountFilter: "shared",
    });
  });

  it("normalizes legacy NULLs without changing stored values or timestamps", async () => {
    await db.insert(userPreferences).values({
      userId, rememberLastAccount: null, defaultTransactionType: null,
      ocrConfidenceThreshold: null, autoCreateFromReceipt: null,
    });
    const before = await ownRow();
    expect((await getOwn().expect(200)).body.data.preferences).toMatchObject({
      userId, rememberLastAccount: true, defaultTransactionType: "expense",
      ocrConfidenceThreshold: 70, autoCreateFromReceipt: false,
      createdAt: before[0].createdAt?.toISOString(),
      updatedAt: before[0].updatedAt?.toISOString(),
    });
    expect(await ownRow()).toEqual(before);
  });

  it("fails rather than reinterpreting an explicitly invalid stored transaction enum", async () => {
    await db.insert(userPreferences).values({ userId, defaultTransactionType: "unsupported" });
    const before = await ownRow();
    await getOwn().expect(500);
    expect(await ownRow()).toEqual(before);
  });

  it("rolls back a partial edit beside invalid legacy data, then allows an explicit repair", async () => {
    await db.insert(userPreferences).values({ userId, defaultTransactionType: "unsupported" });
    const before = await ownRow();
    await putOwn({ rememberLastAccount: false }).expect(500);
    expect(await ownRow()).toEqual(before);
    const repair = await putOwn({ defaultTransactionType: "income" }).expect(200);
    expect(repair.body.data.preferences).toMatchObject({ defaultTransactionType: "income", rememberLastAccount: true });
    expect((await ownRow())[0]).toMatchObject({ defaultTransactionType: "income", rememberLastAccount: true });
  });

  it.each([
    ["empty patch", {}], ["null patch", null],
    ["unknown field", { invented: true }],
    ["mixed unknown field", { rememberLastAccount: false, invented: true }],
    ["foreign userId", { userId: neighborId, rememberLastAccount: false }],
    ["foreign ownerUserId", { ownerUserId: neighborId, defaultAccountFilter: "mine" }],
    ["foreign householdId", { householdId, rememberLastAccount: false }],
    ["null field", { rememberLastAccount: null }],
    ["wrong boolean type", { rememberLastAccount: "false" }],
    ["bad transaction enum", { defaultTransactionType: "refund" }],
    ["bad filter enum", { defaultAccountFilter: neighborId }],
    ["negative percentage", { ocrConfidenceThreshold: -1 }],
    ["over 100 percentage", { ocrConfidenceThreshold: 101 }],
    ["fractional percentage", { ocrConfidenceThreshold: 50.5 }],
  ])("rejects %s before writing a row or audit", async (_label, body) => {
    const neighborBefore = await neighborRow();
    const auditBefore = await db.select().from(auditLogs).where(eq(auditLogs.userId, userId));
    await putOwn(body === null ? "null" : body).expect(400);
    expect(await ownRow()).toHaveLength(0);
    expect(await neighborRow()).toEqual(neighborBefore);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.userId, userId))).toEqual(auditBefore);
  });

  it("lets a household member write their own row while household policy stays forbidden", async () => {
    const ownBefore = await ownRow();
    const response = await request(app).put("/api/settings/user-preferences")
      .set("Cookie", neighborCookie).send({ rememberLastAccount: true, defaultAccountFilter: "mine" }).expect(200);
    expect(response.body.data.preferences).toMatchObject({ userId: neighborId, rememberLastAccount: true, defaultAccountFilter: "mine" });
    expect((await neighborRow())[0]).toMatchObject({ rememberLastAccount: true, defaultAccountFilter: "mine" });
    expect(await ownRow()).toEqual(ownBefore);
    const policy = await request(app).put("/api/settings/preferences")
      .set("Cookie", neighborCookie).send({ showPendingTransactions: false }).expect(403);
    expect(policy.body.error.code).toBe("FORBIDDEN");
    expect((await request(app).get("/api/settings/user-preferences").set("Cookie", neighborCookie).expect(200))
      .body.data.preferences.userId).toBe(neighborId);
  });

  it("serializes concurrent first writes on the user row and retains both patches", async () => {
    const holder = await pool.connect();
    const pending: Array<Promise<request.Response>> = [];
    try {
      await holder.query("BEGIN");
      const { rows: [{ pid }] } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await holder.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
      pending.push(putOwn({ rememberLastAccount: false }).then(response => response));
      const first = await blockedWriter([pid], [pid]);
      expect(first.blockingPath).toContain(pid);
      expect(first.query).toMatch(/\bfrom\s+"?users"?[\s\S]*\bfor\s+update\b/i);
      pending.push(putOwn({ defaultAccountFilter: "mine" }).then(response => response));
      const second = await blockedWriter([pid, first.pid], [pid, first.pid]);
      expect(second.blockingPath.some(blocker => [pid, first.pid].includes(blocker))).toBe(true);
      expect(second.query).toMatch(/\bfrom\s+"?users"?[\s\S]*\bfor\s+update\b/i);
      await holder.query("COMMIT");
      expect((await Promise.all(pending)).map(response => response.status)).toEqual([200, 200]);
      expect((await ownRow())[0]).toMatchObject({ rememberLastAccount: false, defaultAccountFilter: "mine" });
      expect((await getOwn().expect(200)).body.data.preferences).toMatchObject({ rememberLastAccount: false, defaultAccountFilter: "mine" });
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      await Promise.allSettled(pending);
    }
  }, 20000);

  it("rejects a signed write queued before account tombstone without recreating preferences", async () => {
    const holder = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await holder.query("BEGIN");
      const { rows: [{ pid }] } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await holder.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
      pending = putOwn({ rememberLastAccount: false }).then(response => response);
      const blocked = await blockedWriter([pid], [pid]);
      expect(blocked.blockingPath).toContain(pid);
      expect(blocked.query).toMatch(/\bfrom\s+"?users"?[\s\S]*\bfor\s+update\b/i);
      await holder.query("DELETE FROM user_preferences WHERE user_id = $1", [userId]);
      await holder.query("UPDATE users SET erased_at = now(), password_hash = $2 WHERE id = $1", [
        userId, "!erased!r05p-synthetic",
      ]);
      await holder.query("COMMIT");
      expect((await pending).status).toBe(401);
      expect(await ownRow()).toHaveLength(0);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      if (pending) await Promise.allSettled([pending]);
    }
  }, 20000);

  it.each(["selected SID", "global generation"] as const)("rejects a signed write queued before %s revocation without inserting preferences", async mode => {
    const actor = await createRevocationActor();
    let pending: Promise<request.Response> | undefined;
    try {
      await db.transaction(async tx => {
        const { rows: [{ pid }] } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        await tx.select({ id: users.id }).from(users).where(eq(users.id, actor.id)).for("update");
        pending = request(app).put("/api/settings/user-preferences")
          .set("Cookie", actor.cookie).send({ rememberLastAccount: false }).then(response => response);
        const blocked = await blockedWriter([pid], [pid]);
        expect(blocked.blockingPath).toContain(pid);
        expect(blocked.query).toMatch(/\bfrom\s+"?users"?[\s\S]*\bfor\s+update\b/i);

        if (mode === "selected SID") {
          const [tracked] = await tx.select({ id: userSessions.id }).from(userSessions)
            .where(eq(userSessions.sessionToken, actor.sid));
          expect(tracked).toBeDefined();
          expect(await revokeSelectedSession(tx, actor.id, tracked.id)).toBe(true);
        } else {
          await revokeUserSessions(tx, actor.id);
        }
      });
      expect((await pool.query('SELECT sid FROM "session" WHERE sid = $1', [actor.sid])).rows).toHaveLength(0);
      expect((await db.select({ generation: users.securityGeneration }).from(users)
        .where(eq(users.id, actor.id)))[0].generation).toBe(mode === "selected SID" ? 0 : 1);
      const response = await pending!;
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
      expect(await db.select().from(userPreferences).where(eq(userPreferences.userId, actor.id))).toHaveLength(0);
    } finally {
      if (pending) await Promise.allSettled([pending]);
    }
  }, 20000);
});
