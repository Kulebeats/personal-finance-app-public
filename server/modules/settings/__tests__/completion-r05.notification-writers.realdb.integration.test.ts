import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, users, userDisplaySettings, userNotificationPreferences } from "@shared/schema";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

const subject = randomUUID(), neighbor = randomUUID();
const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const recapType = NOTIFICATION_TYPES.WEEKLY_RECAP;
const investmentType = NOTIFICATION_TYPES.PRICE_ALERT;
const generalType = NOTIFICATION_TYPES.LARGE_TRANSACTION;
const failingType = NOTIFICATION_TYPES.BUDGET_WARNING;
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

const own = (userId = subject, type?: string) => type
  ? and(eq(userNotificationPreferences.userId, userId), eq(userNotificationPreferences.notificationType, type))
  : eq(userNotificationPreferences.userId, userId);

function putGeneral(preferences: object[]) {
  return request(app).put("/api/settings/notifications").set("Cookie", cookie).send({ preferences });
}

function patchRecap(data: object) {
  return request(app).patch("/api/weekly-recap/settings").set("Cookie", cookie).send(data);
}

function putInvestment(data: object) {
  return request(app).put("/api/investments/notifications/preferences").set("Cookie", cookie).send(data);
}

async function rows(type: string, userId = subject) {
  return db.select().from(userNotificationPreferences).where(own(userId, type));
}

async function blockedWriter(blockers: number[], excluded: number[]) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[]; query: string }>(`
      SELECT pid, query, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND NOT (pid = ANY($2::integer[]))
        AND query ~ '(users|user_display_settings|user_notification_preferences)'
        AND EXISTS (SELECT 1 FROM unnest(pg_blocking_pids(pid)) blocker WHERE blocker = ANY($1::integer[]))
      ORDER BY query_start LIMIT 1`, [blockers, excluded]);
    if (result.rows[0]) return result.rows[0];
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Expected the real HTTP notification writer to reach the held PostgreSQL user lock");
}

async function contend(label: string, writes: Array<() => ReturnType<typeof putGeneral>>) {
  const holder = await pool.connect();
  const pending: Array<Promise<request.Response>> = [];
  try {
    await holder.query("BEGIN");
    const { rows: [{ pid }] } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await holder.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [subject]);
    const waiting: number[] = [];
    for (const write of writes) {
      pending.push(write().then(response => response));
      const blocked = await blockedWriter([pid, ...waiting], [pid, ...waiting]);
      expect(blocked.blockers.some(blocker => [pid, ...waiting].includes(blocker))).toBe(true);
      expect(blocked.query).toMatch(/\bfrom\s+"?users"?[\s\S]*\bfor\s+update\b/i);
      waiting.push(blocked.pid);
    }
    console.info(`[R05 notification contention] ${label}: observed ${waiting.length} HTTP writer(s) blocked by PostgreSQL`);
    await holder.query("COMMIT");
    return await Promise.all(pending);
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
    await Promise.allSettled(pending);
  }
}

describe("R05 notification writer serialization on disposable PostgreSQL", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const password = "SyntheticR05NotificationWriter123!";
    const passwordHash = await hashPassword(password);
    await db.insert(users).values([
      { id: subject, email: `r05nwriter-${tag}@example.invalid`, username: `r05nwriter-${tag}`, passwordHash, emailVerified: true },
      { id: neighbor, email: `r05nwriter-other-${tag}@example.invalid`, username: `r05nwriter-other-${tag}`, passwordHash, emailVerified: true },
    ]);
    await db.insert(userNotificationPreferences).values({
      userId: neighbor, notificationType: recapType, inAppEnabled: false, emailEnabled: true, thresholdAmount: "901.25",
    });
    const login = await request(app).post("/api/auth/login")
      .send({ email: `r05nwriter-${tag}@example.invalid`, password });
    expect(login.status).toBe(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  beforeEach(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.userId, subject));
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    await db.delete(userNotificationPreferences).where(own());
  });

  afterAll(async () => {
    for (const id of [subject, neighbor]) {
      await db.delete(auditLogs).where(eq(auditLogs.userId, id));
      await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, id));
      await db.delete(userNotificationPreferences).where(own(id));
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it.each(["general first", "recap first"])("serializes %s creation of the same recap preference", async order => {
    const general = () => putGeneral([{ notificationType: recapType, pushEnabled: true }]);
    const recap = () => patchRecap({ enabled: false, emailEnabled: true, dayOfWeek: 3 });
    const responses = await contend(order, order === "general first" ? [general, recap] : [recap, general]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await rows(recapType)).toHaveLength(1);
    expect((await rows(recapType))[0]).toMatchObject({ inAppEnabled: false, emailEnabled: true, pushEnabled: true });
    const recapRead = await request(app).get("/api/weekly-recap/settings").set("Cookie", cookie).expect(200);
    expect(recapRead.body.data).toMatchObject({ enabled: false, emailEnabled: true, dayOfWeek: 3 });
    expect(await rows(recapType, neighbor)).toMatchObject([{ inAppEnabled: false, emailEnabled: true, thresholdAmount: "901.25" }]);
  }, 30000);

  it("serializes two general writers on the first row and retains disjoint fields", async () => {
    const responses = await contend("general/general first creation", [
      () => putGeneral([{ notificationType: generalType, emailEnabled: true }]),
      () => putGeneral([{ notificationType: generalType, pushEnabled: true }]),
    ]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await rows(generalType)).toHaveLength(1);
    expect((await rows(generalType))[0]).toMatchObject({ inAppEnabled: true, emailEnabled: true, pushEnabled: true });
  }, 30000);

  it.each(["general first", "investment first"])("serializes %s creation of shared investment type", async order => {
    const general = () => putGeneral([{ notificationType: investmentType, inAppEnabled: false }]);
    const investment = () => putInvestment({ notificationType: investmentType, pushEnabled: true });
    const responses = await contend(order, order === "general first" ? [general, investment] : [investment, general]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await rows(investmentType)).toHaveLength(1);
    expect((await rows(investmentType))[0]).toMatchObject({
      inAppEnabled: false, emailEnabled: order === "general first" ? false : true, pushEnabled: true,
    });
  }, 30000);

  it("rejects an invalid batch before any row or audit is written", async () => {
    const neighborBefore = await rows(recapType, neighbor);
    const response = await putGeneral([
      { notificationType: generalType, emailEnabled: true },
      { notificationType: "invented-r05nwriter-type", emailEnabled: true },
    ]);
    expect(response.status).toBe(400);
    expect(await db.select().from(userNotificationPreferences).where(own())).toEqual([]);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.userId, subject))).toEqual([]);
    expect(await rows(recapType, neighbor)).toEqual(neighborBefore);
  });

  it("rolls back earlier batch rows when PostgreSQL rejects a later preference", async () => {
    const functionName = `r05nw_fail_${tag}`;
    const neighborBefore = await rows(recapType, neighbor);
    try {
      await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $failure$
        BEGIN
          IF NEW.user_id = '${subject}'::uuid AND NEW.notification_type = '${failingType}' THEN
            RAISE EXCEPTION 'R05 synthetic notification batch failure';
          END IF;
          RETURN NEW;
        END $failure$`);
      await pool.query(`CREATE TRIGGER ${functionName} BEFORE INSERT OR UPDATE ON user_notification_preferences FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
      const response = await putGeneral([
        { notificationType: generalType, emailEnabled: true },
        { notificationType: failingType, pushEnabled: true },
      ]);
      expect(response.status).toBe(500);
      expect(await db.select().from(userNotificationPreferences).where(own())).toEqual([]);
      expect(await db.select().from(auditLogs).where(eq(auditLogs.userId, subject))).toEqual([]);
      expect(await rows(recapType, neighbor)).toEqual(neighborBefore);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${functionName} ON user_notification_preferences`);
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }
  });
});
