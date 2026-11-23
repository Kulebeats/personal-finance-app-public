import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { accounts, auditLogs, fxRates, holdings, securities, users } from "@shared/schema";
import { db, pool } from "../../db";
import * as calculations from "../../core/calculations";
import * as sessionIdentity from "../../services/session-identity";
import { a, b, actors, app, ids, reset, start, stop } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const securityId = randomUUID(), holdingId = randomUUID(), marker = "SYN_SESSION_TOUCH_VALUE";
const list = "/api/investments/holdings?currency=ZMW", detail = `/api/investments/holdings/${holdingId}`;
const get = (path: string) => request(app).get(path).set("Cookie", actors.get("member")!.cookie);
async function clean() {
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(eq(securities.id, securityId));
}
async function seed(nonempty: boolean) {
  if (!nonempty) return;
  await db.insert(securities).values({ id: securityId, symbol: "SYN_SID_TOUCH", name: marker,
    type: "stock", currency: "ZMW", currentPrice: "10.00" });
  await db.insert(holdings).values({ id: holdingId, householdId: a, accountId: ids.sharedAccount, securityId,
    quantity: "2", costBasis: "15.00", acquiredDate: "2030-01-01" });
}
async function financial() {
  return { holdings: await db.select().from(holdings).where(inArray(holdings.householdId, [a, b])).orderBy(holdings.id),
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, [a, b])).orderBy(accounts.id),
    securities: await db.select().from(securities).where(eq(securities.id, securityId)),
    audits: await db.select().from(auditLogs).where(inArray(auditLogs.userId, Array.from(actors.values()).map(row => row.id))).orderBy(auditLogs.id) };
}
async function currentSid() {
  const rows = await pool.query<{ sid: string }>('select sid from "session" where sess->>\'userId\'=$1', [actors.get("member")!.id]);
  expect(rows.rows).toHaveLength(1); return rows.rows[0].sid;
}
async function assertPostGrant(tx: Parameters<typeof sessionIdentity.lockCurrentSessionCredential>[0]) {
  // This is the real reader's post-membership, pre-credential point. A table
  // RowShareLock proves the actual FOR SHARE authority query already ran.
  const result = await tx.execute(sql`select exists(select 1 from pg_locks where pid=pg_backend_pid()
    and relation='public.household_members'::regclass and mode='RowShareLock' and granted) as post_grant`);
  expect(result.rows[0].post_grant).toBe(true);
}
async function pureExpiryRefresh(sid: string) {
  // A separate guarded connection commits one real tuple UPDATE after the
  // reader's membership snapshot. Capture old and new within the same SQL
  // statement so concurrent ordinary touches cannot pollute the comparison.
  const result = await pool.query<{ same_sid: boolean; same_payload: boolean; same_user: boolean; same_generation: boolean; delta_ms: string }>(`
    with original as materialized (select sid,sess,expire from "session" where sid=$1 for update),
    touched as (update "session" s set expire=o.expire+interval '1 second' from original o where s.sid=o.sid
      returning s.sid,s.sess,s.expire)
    select t.sid=o.sid as same_sid,t.sess::jsonb=o.sess::jsonb as same_payload,
      t.sess->>'userId'=o.sess->>'userId' as same_user,
      coalesce(t.sess->>'securityGeneration','0')=coalesce(o.sess->>'securityGeneration','0') as same_generation,
      (extract(epoch from(t.expire-o.expire))*1000)::text as delta_ms from touched t join original o on t.sid=o.sid`, [sid]);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({ same_sid: true, same_payload: true, same_user: true, same_generation: true });
  expect(Number(result.rows[0].delta_ms)).toBe(1000);
}

describe("R13 signed holdings reads survive harmless expiry touches without weakening current authority", () => {
  beforeAll(async () => {
    await start();
    calculations.setGlobalFXService(calculations.createFXRateService(calculations.createFXRateRepository(db, fxRates),
      { cacheTtlSeconds: 300, baseCurrency: "USD", fallbackDays: 30 }));
  }, 30_000);
  beforeEach(async () => { await clean(); await reset(); await db.update(users).set({ emailVerified: true }).where(eq(users.id, actors.get("member")!.id)); });
  afterEach(async () => {
    vi.restoreAllMocks();
    // Restore this flag even after an intended RED assertion; credentials and
    // the cookie were never replaced or revoked by these tests.
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, actors.get("member")!.id));
    await clean();
  });
  afterAll(async () => { await clean(); await stop(); });

  it.each([
    { scope: "empty list", nonempty: false, path: list, status: 200 },
    { scope: "nonempty list", nonempty: true, path: list, status: 200 },
    { scope: "empty detail", nonempty: false, path: detail, status: 404 },
    { scope: "nonempty detail", nonempty: true, path: detail, status: 200 },
  ])("keeps the actual $scope contract while every post-grant credential attempt receives a pure SID expiry refresh", async ({ nonempty, path, status }) => {
    await seed(nonempty);
    // Real portfolio transport is a positive control OUTSIDE the barrier. Its
    // current household-only service is separate R12 work, not reader coverage.
    await get("/api/investments/portfolio/summary?currency=ZMW").expect(200);
    const sid = await currentSid(), original = sessionIdentity.lockCurrentSessionCredential, before = await financial();
    let updates = 0, callThrough = 0, completed = 0;
    const gate = vi.spyOn(sessionIdentity, "lockCurrentSessionCredential").mockImplementation(async (...args) => {
      expect(args[1].id).toBe(actors.get("member")!.id); expect(args[2]).toBe(sid); await assertPostGrant(args[0]);
      // Deliberately touch EVERY attempt, including all three old RR retries.
      // Increasing an arbitrary retry count cannot make this oracle pass.
      await pureExpiryRefresh(sid); updates++; callThrough++;
      const current = await original(...args); completed++; return current;
    });
    const response = await get(path);
    expect(gate).toHaveBeenCalled(); expect(updates).toBe(gate.mock.calls.length); expect(callThrough).toBe(updates); expect(completed).toBe(updates);
    expect(updates).toBeGreaterThan(0); expect(updates).toBeLessThanOrEqual(3);
    expect(response.status).toBe(status);
    if (status === 404) { expect(response.body).not.toHaveProperty("data"); expect(response.text).not.toContain(marker); }
    else if (path === list) expect(response.body.data).toEqual(nonempty ? [expect.objectContaining({ id: holdingId, quantity: "2.00000000", costBasis: "15.00",
      costBasisBase: { amount: "15.00", currency: "ZMW" }, currentValue: { amount: "20.00", currency: "ZMW" } })] : []);
    else expect(response.body.data).toMatchObject({ id: holdingId, quantity: "2.00000000", costBasis: "15.00", security: { name: marker } });
    expect(await financial()).toEqual(before);
  });

  it.each([
    { scope: "empty list", nonempty: false, path: list }, { scope: "nonempty list", nonempty: true, path: list },
    { scope: "empty detail", nonempty: false, path: detail }, { scope: "nonempty detail", nonempty: true, path: detail },
  ])("denies $scope when verification is actually withdrawn at the same post-grant point", async ({ nonempty, path }) => {
    await seed(nonempty); const sid = await currentSid(), before = await financial(), original = sessionIdentity.lockCurrentSessionCredential;
    let changed = false, callThrough = false;
    const gate = vi.spyOn(sessionIdentity, "lockCurrentSessionCredential").mockImplementationOnce(async (...args) => {
      expect(args[2]).toBe(sid); await assertPostGrant(args[0]);
      const result = await pool.query("update users set email_verified=false where id=$1 and email_verified=true returning id,email_verified", [actors.get("member")!.id]);
      expect(result.rows).toEqual([{ id: actors.get("member")!.id, email_verified: false }]); changed = true; callThrough = true;
      return original(...args);
    });
    const response = await get(path);
    expect(gate).toHaveBeenCalledOnce(); expect(changed).toBe(true); expect(callThrough).toBe(true);
    expect(response.status).toBe(403);
    expect(response.body).not.toHaveProperty("data");
    for (const retired of [marker, holdingId, securityId, "15.00", "2.00000000"]) expect(response.text).not.toContain(retired);
    expect((await db.select({ verified: users.emailVerified }).from(users).where(eq(users.id, actors.get("member")!.id)))[0].verified).toBe(false);
    expect(await financial()).toEqual(before);
  });
});
