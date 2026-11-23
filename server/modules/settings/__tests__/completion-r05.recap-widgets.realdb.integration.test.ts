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
const widgets = [{ id: "net-worth", label: "Net worth", enabled: true }];
const savedRecap = { dayOfWeek: 4, includeGoals: false, includeRecurring: false, futureRecapField: "retained" };
const savedLayout = { widgets, version: 1, weeklyRecap: savedRecap, futureLayout: { retained: true } };
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;
const ownRecap = (userId = subject) => and(
  eq(userNotificationPreferences.userId, userId),
  eq(userNotificationPreferences.notificationType, recapType),
);

async function persistedDisplay(userId = subject) {
  const [value] = await db.select().from(userDisplaySettings).where(eq(userDisplaySettings.userId, userId));
  return value;
}

async function persistedRecap(userId = subject) {
  const [value] = await db.select().from(userNotificationPreferences).where(ownRecap(userId));
  return value;
}

function putDisplay(data: object) {
  return request(app).put("/api/settings/display").set("Cookie", cookie).send(data);
}

function patchRecap(data: object) {
  return request(app).patch("/api/weekly-recap/settings").set("Cookie", cookie).send(data);
}

async function freshDisplay() {
  const response = await request(app).get("/api/settings/display").set("Cookie", cookie).expect(200);
  return response.body.data.settings;
}

async function freshRecap() {
  const response = await request(app).get("/api/weekly-recap/settings").set("Cookie", cookie).expect(200);
  return response.body.data;
}

async function blockedWriter(blockers: number[], excluded: number[] = []) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[] }>(`
      SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND NOT (pid = ANY($2::integer[]))
        AND query ~ '(users|user_display_settings|user_notification_preferences)'
        AND EXISTS (SELECT 1 FROM unnest(pg_blocking_pids(pid)) blocker WHERE blocker = ANY($1::integer[]))
      ORDER BY query_start LIMIT 1`, [blockers, excluded]);
    if (result.rows[0]) return result.rows[0];
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Expected the real HTTP settings writer to reach the held PostgreSQL row lock");
}

async function contend(
  label: string,
  writes: Array<() => ReturnType<typeof putDisplay>>,
  locks: { user?: boolean; display?: boolean; notification?: boolean },
  whileBlocked?: () => Promise<void>,
) {
  const holder = await pool.connect();
  const pending: Array<Promise<request.Response>> = [];
  try {
    await holder.query("BEGIN");
    const { rows: [{ pid }] } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    if (locks.user) await holder.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [subject]);
    if (locks.display) await holder.query('SELECT user_id FROM user_display_settings WHERE user_id = $1 FOR UPDATE', [subject]);
    if (locks.notification) await holder.query(
      'SELECT id FROM user_notification_preferences WHERE user_id = $1 AND notification_type = $2 FOR UPDATE', [subject, recapType]);
    const waiting: number[] = [];
    for (const write of writes) {
      pending.push(write().then(response => response));
      const blocked = await blockedWriter([pid, ...waiting], [pid, ...waiting]);
      expect(blocked.blockers.some(blocker => [pid, ...waiting].includes(blocker))).toBe(true);
      waiting.push(blocked.pid);
    }
    console.info(`[R05 contention] ${label}: observed ${waiting.length} HTTP writer(s) blocked by PostgreSQL`);
    await whileBlocked?.();
    await holder.query("COMMIT");
    return await Promise.all(pending);
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
    await Promise.allSettled(pending);
  }
}

describe("R05 independent recap and dashboard settings on disposable PostgreSQL", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const password = "SyntheticR05Widgets123!";
    const passwordHash = await hashPassword(password);
    await db.insert(users).values([
      { id: subject, email: `r05w-${tag}@example.invalid`, username: `r05w-${tag}`, passwordHash, emailVerified: true },
      { id: neighbor, email: `r05w-other-${tag}@example.invalid`, username: `r05w-other-${tag}`, passwordHash, emailVerified: true },
    ]);
    await db.insert(userDisplaySettings).values({ userId: neighbor, theme: "light", firstDayOfWeek: "Friday", dashboardWidgets: savedLayout });
    await db.insert(userNotificationPreferences).values({ userId: neighbor, notificationType: recapType, thresholdAmount: "901.25", emailEnabled: true });
    const login = await request(app).post("/api/auth/login").send({ email: `r05w-${tag}@example.invalid`, password });
    expect(login.status).toBe(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  beforeEach(async () => {
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    await db.delete(userNotificationPreferences).where(ownRecap());
    await db.insert(userDisplaySettings).values({ userId: subject, theme: "dark", firstDayOfWeek: "Monday", dashboardWidgets: savedLayout });
    await db.insert(userNotificationPreferences).values({
      userId: subject, notificationType: recapType, thresholdAmount: "73.25",
      inAppEnabled: false, emailEnabled: false, pushEnabled: true,
    });
  });

  afterAll(async () => {
    for (const id of [subject, neighbor]) {
      await db.delete(auditLogs).where(eq(auditLogs.userId, id));
      await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, id));
      await db.delete(userNotificationPreferences).where(eq(userNotificationPreferences.userId, id));
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("preserves a saved recap and unknown siblings through a dashboard PUT and fresh HTTP/SQL reads", async () => {
    await patchRecap({ dayOfWeek: 2, includeGoals: true }).expect(200);
    const recapBefore = await freshRecap();
    const notificationBefore = await persistedRecap();
    const changedWidgets = [{ id: "cash-flow", label: "Cash flow", enabled: false }];
    await putDisplay({ dashboardWidgets: {
      widgets: changedWidgets, version: 2, weeklyRecap: { dayOfWeek: 6 }, inventedLayout: "discard",
    } }).expect(200);
    const expected = {
      widgets: changedWidgets, version: 2,
      weeklyRecap: { ...savedRecap, dayOfWeek: 2, includeGoals: true }, futureLayout: { retained: true },
    };
    expect((await persistedDisplay()).dashboardWidgets).toEqual(expected);
    expect((await freshDisplay()).dashboardWidgets).toEqual(expected);
    expect(await freshRecap()).toEqual(recapBefore);
    expect(await persistedRecap()).toEqual(notificationBefore);
  });

  it("persists explicit recap day zero while preserving the calendar, theme, omitted false flags, channels and threshold", async () => {
    await patchRecap({ dayOfWeek: 0 }).expect(200);
    expect(await freshRecap()).toEqual({ enabled: false, emailEnabled: false, dayOfWeek: 0, includeGoals: false, includeRecurring: false });
    const expected = { ...savedLayout, weeklyRecap: { ...savedRecap, dayOfWeek: 0 } };
    expect(await persistedDisplay()).toMatchObject({ theme: "dark", firstDayOfWeek: "Monday", dashboardWidgets: expected });
    expect(await freshDisplay()).toMatchObject({ theme: "dark", firstDayOfWeek: "Monday", dashboardWidgets: expected });
    expect(await persistedRecap()).toMatchObject({ inAppEnabled: false, emailEnabled: false, pushEnabled: true, thresholdAmount: "73.25" });
  });

  // OPS-007: with no saved day the reader returns Monday, the day the recap e-mail actually uses.
  it("defaults the recap to Monday, the e-mail's day, before and after a partial PATCH", async () => {
    await db.update(userDisplaySettings).set({ dashboardWidgets: { widgets, version: 1 } }).where(eq(userDisplaySettings.userId, subject));
    expect((await freshRecap()).dayOfWeek).toBe(1);
    await patchRecap({ includeGoals: false }).expect(200);
    expect(await freshRecap()).toMatchObject({ dayOfWeek: 1, includeGoals: false });
    expect((await persistedDisplay()).firstDayOfWeek).toBe("Monday");
  });

  it.each([-1, 1.5, 7])("rejects invalid recap day %j without changing either settings table", async dayOfWeek => {
    const displayBefore = await persistedDisplay();
    const notificationBefore = await persistedRecap();
    await patchRecap({ enabled: true, dayOfWeek }).expect(400);
    expect(await persistedDisplay()).toEqual(displayBefore);
    expect(await persistedRecap()).toEqual(notificationBefore);
  });

  it.each([-1, 1.5, 7, "1"])("reads historical invalid recap day %j as Monday, the day the e-mail uses, without rewriting storage", async dayOfWeek => {
    await db.update(userDisplaySettings).set({ dashboardWidgets: {
      ...savedLayout, weeklyRecap: { ...savedRecap, dayOfWeek },
    } }).where(eq(userDisplaySettings.userId, subject));
    const displayBefore = await persistedDisplay();
    const notificationBefore = await persistedRecap();
    expect(await freshRecap()).toEqual({ enabled: false, emailEnabled: false, dayOfWeek: 1, includeGoals: false, includeRecurring: false });
    expect(await persistedDisplay()).toEqual(displayBefore);
    expect(await persistedRecap()).toEqual(notificationBefore);
  });

  it.each([0, 6])("persists valid recap day boundary %j through fresh HTTP and SQL reads", async dayOfWeek => {
    await patchRecap({ dayOfWeek }).expect(200);
    expect((await freshRecap()).dayOfWeek).toBe(dayOfWeek);
    expect((await persistedDisplay()).dashboardWidgets).toEqual({
      ...savedLayout, weeklyRecap: { ...savedRecap, dayOfWeek },
    });
    expect((await persistedDisplay()).firstDayOfWeek).toBe("Monday");
  });

  it("leaves the neighboring user's display and notification rows unchanged", async () => {
    const displayBefore = await persistedDisplay(neighbor);
    const notificationBefore = await persistedRecap(neighbor);
    await patchRecap({ enabled: true, emailEnabled: true, includeRecurring: true }).expect(200);
    await putDisplay({ theme: "system", dashboardWidgets: { widgets: [], version: 3 } }).expect(200);
    expect(await persistedDisplay(neighbor)).toEqual(displayBefore);
    expect(await persistedRecap(neighbor)).toEqual(notificationBefore);
  });

  it("does not add recap JSON defaults when only a notification flag is patched", async () => {
    const layoutWithoutRecap = { widgets, version: 2, futureLayout: { retained: true } };
    await db.update(userDisplaySettings).set({ dashboardWidgets: layoutWithoutRecap }).where(eq(userDisplaySettings.userId, subject));
    await patchRecap({ enabled: true }).expect(200);
    expect((await persistedDisplay()).dashboardWidgets).toEqual(layoutWithoutRecap);
    expect((await persistedDisplay()).firstDayOfWeek).toBe("Monday");
    expect(await freshRecap()).toMatchObject({ enabled: true, dayOfWeek: 1 });
    expect(await persistedRecap()).toMatchObject({ emailEnabled: false, pushEnabled: true, thresholdAmount: "73.25" });
  });

  it("merges dashboard and recap disjoint writes after both contend on an existing row", async () => {
    const responses = await contend("existing dashboard/recap", [
      () => patchRecap({ dayOfWeek: 2, includeGoals: true }),
      () => putDisplay({ dashboardWidgets: { widgets: [], version: 7 } }),
    ], { user: true, display: true });
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect((await persistedDisplay()).dashboardWidgets).toEqual({
      ...savedLayout, widgets: [], version: 7, weeklyRecap: { ...savedRecap, dayOfWeek: 2, includeGoals: true },
    });
    expect(await freshRecap()).toMatchObject({ dayOfWeek: 2, includeGoals: true });
    expect((await freshDisplay()).dashboardWidgets).toEqual((await persistedDisplay()).dashboardWidgets);
  }, 30000);

  it("creates one display row when initial dashboard and recap writes contend before either insert", async () => {
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    const responses = await contend("initial dashboard/recap", [
      () => putDisplay({ theme: "light", dashboardWidgets: { widgets, version: 8 } }),
      () => patchRecap({ dayOfWeek: 5, includeRecurring: false }),
    ], { user: true });
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await persistedDisplay()).toMatchObject({ theme: "light", firstDayOfWeek: "Sunday", dashboardWidgets: {
      widgets, version: 8, weeklyRecap: { dayOfWeek: 5, includeGoals: true, includeRecurring: false },
    } });
    expect(await freshRecap()).toMatchObject({ dayOfWeek: 5, includeRecurring: false });
    expect((await freshDisplay()).dashboardWidgets).toEqual((await persistedDisplay()).dashboardWidgets);
  }, 30000);

  it("preserves disjoint recap flags from two writers that both reach a database lock", async () => {
    await db.update(userDisplaySettings).set({ dashboardWidgets: {
      ...savedLayout, weeklyRecap: { ...savedRecap, includeGoals: true, includeRecurring: true },
    } }).where(eq(userDisplaySettings.userId, subject));
    await db.update(userNotificationPreferences).set({ inAppEnabled: true, emailEnabled: true }).where(ownRecap());
    const responses = await contend("disjoint recap flags", [
      () => patchRecap({ enabled: false, includeGoals: false }),
      () => patchRecap({ emailEnabled: false, includeRecurring: false }),
    ], { user: true, display: true, notification: true });
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await freshRecap()).toEqual({ enabled: false, emailEnabled: false, dayOfWeek: 4, includeGoals: false, includeRecurring: false });
    expect(await persistedRecap()).toMatchObject({ inAppEnabled: false, emailEnabled: false, pushEnabled: true, thresholdAmount: "73.25" });
    expect((await persistedDisplay()).dashboardWidgets).toEqual(savedLayout);
  }, 30000);

  it("allows display GET initialization to contend with the first recap write without duplicate-row failure", async () => {
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    const responses = await contend("display GET/initial recap", [
      () => request(app).get("/api/settings/display").set("Cookie", cookie),
      () => patchRecap({ dayOfWeek: 2 }),
    ], { user: true });
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await freshRecap()).toMatchObject({ dayOfWeek: 2 });
    expect((await persistedDisplay()).dashboardWidgets).toMatchObject({ weeklyRecap: { dayOfWeek: 2 } });
  }, 30000);

  it("creates one logical preference when two initial recap PATCHes contend", async () => {
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    await db.delete(userNotificationPreferences).where(ownRecap());
    const responses = await contend("initial recap/recap", [
      () => patchRecap({ enabled: false, includeGoals: false }),
      () => patchRecap({ emailEnabled: true, includeRecurring: false }),
    ], { user: true });
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await db.select().from(userNotificationPreferences).where(ownRecap())).toHaveLength(1);
    expect(await freshRecap()).toEqual({ enabled: false, emailEnabled: true, dayOfWeek: 1, includeGoals: false, includeRecurring: false });
    expect((await persistedDisplay()).dashboardWidgets).toMatchObject({ weeklyRecap: { includeGoals: false, includeRecurring: false } });
  }, 30000);

  it("keeps notification changes invisible until the blocked recap display write commits", async () => {
    const responses = await contend("atomic recap visibility", [
      () => patchRecap({ enabled: true, dayOfWeek: 3 }),
    ], { display: true }, async () => {
      expect(await persistedRecap()).toMatchObject({ inAppEnabled: false, emailEnabled: false });
      expect((await persistedDisplay()).dashboardWidgets).toEqual(savedLayout);
    });
    expect(responses[0].status).toBe(200);
    expect(await freshRecap()).toMatchObject({ enabled: true, dayOfWeek: 3 });
    expect(await persistedRecap()).toMatchObject({ inAppEnabled: true });
  }, 30000);

  it("rolls back the notification write when PostgreSQL rejects the same recap's display write", async () => {
    const functionName = `r05w_recap_failure_${tag}`;
    const displayBefore = await persistedDisplay();
    const notificationBefore = await persistedRecap();
    try {
      await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $failure$
        BEGIN
          IF NEW.user_id = '${subject}'::uuid AND NEW.dashboard_widgets->'weeklyRecap'->>'dayOfWeek' = '6' THEN
            RAISE EXCEPTION 'R05 synthetic recap display failure';
          END IF;
          RETURN NEW;
        END $failure$`);
      await pool.query(`CREATE TRIGGER ${functionName} BEFORE INSERT OR UPDATE ON user_display_settings FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
      const response = await patchRecap({ enabled: true, dayOfWeek: 6 });
      expect(response.status).toBe(500);
      expect(await persistedDisplay()).toEqual(displayBefore);
      expect(await persistedRecap()).toEqual(notificationBefore);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${functionName} ON user_display_settings`);
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }
  });

  it("rolls back display changes when PostgreSQL rejects the same recap's notification write", async () => {
    const functionName = `r05w_notification_failure_${tag}`;
    const displayBefore = await persistedDisplay();
    const notificationBefore = await persistedRecap();
    try {
      await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $failure$
        BEGIN
          IF NEW.user_id = '${subject}'::uuid AND NEW.notification_type = '${recapType}' AND NEW.in_app_enabled THEN
            RAISE EXCEPTION 'R05 synthetic recap notification failure';
          END IF;
          RETURN NEW;
        END $failure$`);
      await pool.query(`CREATE TRIGGER ${functionName} BEFORE INSERT OR UPDATE ON user_notification_preferences FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
      const response = await patchRecap({ enabled: true, dayOfWeek: 6 });
      expect(response.status).toBe(500);
      expect(await persistedDisplay()).toEqual(displayBefore);
      expect(await persistedRecap()).toEqual(notificationBefore);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${functionName} ON user_notification_preferences`);
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }
  });
});
