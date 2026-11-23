import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, users, userDisplaySettings, userNotificationPreferences } from "@shared/schema";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

const subject = randomUUID(), neighbor = randomUUID();
const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const recapType = NOTIFICATION_TYPES.WEEKLY_RECAP;
const savedLayout = {
  widgets: [{ id: "net-worth", label: "Net worth", enabled: true }], version: 2,
  weeklyRecap: { dayOfWeek: 4, includeGoals: false, includeRecurring: false, futureRecap: "retained" },
  futureLayout: { retained: true },
};
const savedChart = {
  id: "saved-chart", name: "Saved chart", chartType: "bar", primaryMetric: "expenses", order: 4,
  showAverage: true, showComparison: false, createdAt: "2026-10-01T00:00:00.000Z", futureChart: "retained",
};
const savedPreferences = {
  coreWidgets: {
    summaryCards: { id: "summaryCards", enabled: true, order: 7, chartType: "cards", expanded: true, futureWidget: "retained" },
    goalProgress: { enabled: false, order: 4, chartType: "progressBars" },
    futureCore: { enabled: true, order: 8, chartType: "line", futureWidget: { retained: true } },
  },
  optionalWidgets: {
    monthlyTrends: { enabled: true, order: 6, chartType: "bar", expanded: false },
    futureOptional: { enabled: false, order: 9, chartType: "area", futureWidget: "retained" },
  },
  customCharts: [savedChart], hasCompletedWidgetSetup: true, futurePreferences: { retained: true },
};
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

async function persistedDisplay(userId = subject) {
  const [value] = await db.select().from(userDisplaySettings).where(eq(userDisplaySettings.userId, userId));
  return value;
}

async function persistedNotifications(userId = subject) {
  return db.select().from(userNotificationPreferences).where(eq(userNotificationPreferences.userId, userId));
}

function patchWidgets(data: object) {
  return request(app).patch("/api/settings/report-widgets").set("Cookie", cookie).send(data);
}

async function freshWidgets() {
  const response = await request(app).get("/api/settings/report-widgets").set("Cookie", cookie).expect(200);
  return response.body.data.preferences;
}

async function assertReadback() {
  const stored = await persistedDisplay();
  const fresh = await freshWidgets();
  expect(fresh).toEqual(stored.reportWidgetPreferences);
  return fresh;
}

async function blockedWriter(blockers: number[], excluded: number[]) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[] }>(`
      SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND NOT (pid = ANY($2::integer[])) AND query ~ '(users|user_display_settings)'
        AND EXISTS (SELECT 1 FROM unnest(pg_blocking_pids(pid)) blocker WHERE blocker = ANY($1::integer[]))
      ORDER BY query_start LIMIT 1`, [blockers, excluded]);
    if (result.rows[0]) return result.rows[0];
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Expected the real HTTP report-widget writer to reach the held PostgreSQL row lock");
}

async function contend(label: string, writes: Array<() => ReturnType<typeof patchWidgets>>, displayExists = true) {
  const holder = await pool.connect();
  const pending: Array<Promise<request.Response>> = [];
  try {
    await holder.query("BEGIN");
    const { rows: [{ pid }] } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await holder.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [subject]);
    if (displayExists) await holder.query("SELECT user_id FROM user_display_settings WHERE user_id = $1 FOR UPDATE", [subject]);
    const waiting: number[] = [];
    for (const write of writes) {
      pending.push(write().then(response => response));
      const blocked = await blockedWriter([pid, ...waiting], [pid, ...waiting]);
      expect(blocked.blockers.some(blocker => [pid, ...waiting].includes(blocker))).toBe(true);
      waiting.push(blocked.pid);
    }
    console.info(`[R05 report-widget contention] ${label}: observed ${waiting.length} HTTP writer(s) blocked by PostgreSQL`);
    await holder.query("COMMIT");
    return await Promise.all(pending);
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
    await Promise.allSettled(pending);
  }
}

describe("R05 report-widget persistence on disposable PostgreSQL", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const password = "SyntheticR05Reports123!";
    const passwordHash = await hashPassword(password);
    await db.insert(users).values([
      { id: subject, email: `r05v-${tag}@example.invalid`, username: `r05v-${tag}`, passwordHash, emailVerified: true },
      { id: neighbor, email: `r05v-other-${tag}@example.invalid`, username: `r05v-other-${tag}`, passwordHash, emailVerified: true },
    ]);
    await db.insert(userDisplaySettings).values({ userId: neighbor, theme: "light", firstDayOfWeek: "Friday", dashboardWidgets: savedLayout, reportWidgetPreferences: savedPreferences });
    await db.insert(userNotificationPreferences).values({ userId: neighbor, notificationType: recapType, thresholdAmount: "901.25", emailEnabled: true });
    const login = await request(app).post("/api/auth/login").send({ email: `r05v-${tag}@example.invalid`, password });
    expect(login.status).toBe(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  beforeEach(async () => {
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    await db.delete(userNotificationPreferences).where(eq(userNotificationPreferences.userId, subject));
    await db.insert(userDisplaySettings).values({ userId: subject, theme: "dark", firstDayOfWeek: "Monday", dashboardWidgets: savedLayout, reportWidgetPreferences: savedPreferences });
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

  it("merges sequential partial attributes of one widget without losing omitted or future fields", async () => {
    await patchWidgets({ coreWidgets: { summaryCards: { enabled: false } } }).expect(200);
    await patchWidgets({ coreWidgets: { summaryCards: { order: 0 } } }).expect(200);
    await patchWidgets({ coreWidgets: { summaryCards: { chartType: "donut", expanded: false } } }).expect(200);
    expect((await assertReadback()).coreWidgets.summaryCards).toEqual({
      ...savedPreferences.coreWidgets.summaryCards, enabled: false, order: 0, chartType: "donut", expanded: false,
    });
    expect((await freshWidgets()).coreWidgets.futureCore).toEqual(savedPreferences.coreWidgets.futureCore);
    expect((await freshWidgets()).futurePreferences).toEqual(savedPreferences.futurePreferences);
  });

  it("merges partial attributes of a previously stored unknown widget", async () => {
    await patchWidgets({ optionalWidgets: { futureOptional: { enabled: true } } }).expect(200);
    expect((await assertReadback()).optionalWidgets.futureOptional).toEqual({ ...savedPreferences.optionalWidgets.futureOptional, enabled: true });
  });

  it("keeps complete unknown widget payloads compatible and preserves existing metadata", async () => {
    await patchWidgets({ coreWidgets: {
      futureCore: { enabled: false, order: 0, chartType: "area" },
      addedCore: { enabled: true, order: 10, chartType: "line" },
    } }).expect(200);
    expect((await assertReadback()).coreWidgets).toMatchObject({
      futureCore: { ...savedPreferences.coreWidgets.futureCore, enabled: false, order: 0, chartType: "area" },
      addedCore: { enabled: true, order: 10, chartType: "line" },
    });
  });

  it("replaces explicit chart arrays and persists false setup without changing display, recap, or another user", async () => {
    const before = await persistedDisplay();
    const notificationsBefore = await persistedNotifications();
    const neighborBefore = await persistedDisplay(neighbor);
    const neighborNotifications = await persistedNotifications(neighbor);
    await patchWidgets({ customCharts: [], hasCompletedWidgetSetup: false }).expect(200);
    expect(await assertReadback()).toMatchObject({ coreWidgets: savedPreferences.coreWidgets, optionalWidgets: savedPreferences.optionalWidgets, customCharts: [], hasCompletedWidgetSetup: false });
    const after = await persistedDisplay();
    expect({ ...after, reportWidgetPreferences: before.reportWidgetPreferences, updatedAt: before.updatedAt }).toEqual(before);
    expect(await persistedNotifications()).toEqual(notificationsBefore);
    expect(await persistedDisplay(neighbor)).toEqual(neighborBefore);
    expect(await persistedNotifications(neighbor)).toEqual(neighborNotifications);
  });

  it("retains supported custom chart options in an explicit replacement", async () => {
    const replacement = { ...savedChart, id: "replacement-chart", order: 0 };
    const { futureChart: _unused, ...supported } = replacement;
    await patchWidgets({ customCharts: [supported] }).expect(200);
    expect((await assertReadback()).customCharts).toEqual([supported]);
  });

  it("merges concurrent disjoint nested and top-level report changes after both writers reach PostgreSQL locks", async () => {
    const responses = await contend("existing report/report", [
      () => patchWidgets({ coreWidgets: { summaryCards: { enabled: false, order: 0, chartType: "donut" } } }),
      () => patchWidgets({ optionalWidgets: { monthlyTrends: { enabled: false, order: 0, chartType: "area" } }, customCharts: [], hasCompletedWidgetSetup: false }),
    ]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await assertReadback()).toMatchObject({
      coreWidgets: { summaryCards: { ...savedPreferences.coreWidgets.summaryCards, enabled: false, order: 0, chartType: "donut" } },
      optionalWidgets: { monthlyTrends: { ...savedPreferences.optionalWidgets.monthlyTrends, enabled: false, order: 0, chartType: "area" } },
      customCharts: [], hasCompletedWidgetSetup: false, futurePreferences: savedPreferences.futurePreferences,
    });
    expect((await persistedDisplay()).dashboardWidgets).toEqual(savedLayout);
  }, 30000);

  it("creates one display row and combines concurrent first report saves with defaults", async () => {
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    const responses = await contend("initial report/report", [
      () => patchWidgets({ coreWidgets: { summaryCards: { enabled: false, order: 0, chartType: "cards" } } }),
      () => patchWidgets({ optionalWidgets: { monthlyTrends: { enabled: false, order: 0, chartType: "bar" } }, hasCompletedWidgetSetup: true }),
    ], false);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await db.select().from(userDisplaySettings).where(eq(userDisplaySettings.userId, subject))).toHaveLength(1);
    expect(await assertReadback()).toMatchObject({
      coreWidgets: { summaryCards: { enabled: false, order: 0, chartType: "cards" }, goalProgress: { enabled: true, order: 1, chartType: "progressBars" } },
      optionalWidgets: { monthlyTrends: { enabled: false, order: 0, chartType: "bar" }, savingsRate: { enabled: true, order: 2, chartType: "line" } },
      customCharts: [], hasCompletedWidgetSetup: true,
    });
    expect(await persistedDisplay()).toMatchObject({ theme: "system", firstDayOfWeek: "Sunday" });
  }, 30000);

  it("preserves disjoint partial attributes of the same widget after both writers reach PostgreSQL locks", async () => {
    const responses = await contend("same report widget partial attributes", [
      () => patchWidgets({ coreWidgets: { summaryCards: { enabled: false } } }),
      () => patchWidgets({ coreWidgets: { summaryCards: { order: 0, chartType: "donut" } } }),
    ]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect((await assertReadback()).coreWidgets.summaryCards).toEqual({
      ...savedPreferences.coreWidgets.summaryCards, enabled: false, order: 0, chartType: "donut",
    });
  }, 30000);

  it("serializes report writes with dashboard and recap writes while preserving each preference", async () => {
    const responses = await contend("report/dashboard/recap", [
      () => patchWidgets({ hasCompletedWidgetSetup: false }),
      () => request(app).put("/api/settings/display").set("Cookie", cookie).send({ theme: "light", dashboardWidgets: { widgets: [], version: 8 } }),
      () => request(app).patch("/api/weekly-recap/settings").set("Cookie", cookie).send({ dayOfWeek: 0, includeGoals: true }),
    ]);
    expect(responses.map(response => response.status)).toEqual([200, 200, 200]);
    expect(await assertReadback()).toMatchObject({ ...savedPreferences, hasCompletedWidgetSetup: false });
    expect(await persistedDisplay()).toMatchObject({ theme: "light", firstDayOfWeek: "Monday", dashboardWidgets: {
      ...savedLayout, widgets: [], version: 8, weeklyRecap: { ...savedLayout.weeklyRecap, dayOfWeek: 0, includeGoals: true },
    } });
  }, 30000);

  it("returns independent defaults without creating or rewriting a display row and applies a known-widget partial", async () => {
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    const defaults = await freshWidgets();
    expect(defaults).toMatchObject({ coreWidgets: { summaryCards: { enabled: true, order: 0, chartType: "cards" } }, customCharts: [], hasCompletedWidgetSetup: false });
    expect(await persistedDisplay()).toBeUndefined();
    await patchWidgets({ coreWidgets: { summaryCards: { enabled: false } } }).expect(200);
    expect(await assertReadback()).toEqual({ ...defaults, coreWidgets: { ...defaults.coreWidgets, summaryCards: { ...defaults.coreWidgets.summaryCards, enabled: false } } });
  });

  it("reads defaults from a null report column without rewriting adjacent settings", async () => {
    await db.update(userDisplaySettings).set({ reportWidgetPreferences: null }).where(eq(userDisplaySettings.userId, subject));
    const before = await persistedDisplay();
    expect(await freshWidgets()).toMatchObject({ coreWidgets: { goalProgress: { enabled: true, order: 1, chartType: "progressBars" } }, customCharts: [], hasCompletedWidgetSetup: false });
    expect(await persistedDisplay()).toEqual(before);
  });

  it.each([
    { coreWidgets: { summaryCards: { enabled: "false" } } },
    { optionalWidgets: { monthlyTrends: { order: -1 } } },
    { coreWidgets: { summaryCards: { order: 1.5 } } },
    { coreWidgets: { summaryCards: { chartType: false } } },
    { coreWidgets: { summaryCards: { enabled: true, order: 0, chartType: "cards", expanded: "false" } } },
    { coreWidgets: { summaryCards: { enabled: true, order: 0, chartType: "cards", id: "renamed-widget" } } },
    { customCharts: null },
    { customCharts: [{ ...savedChart, showAverage: "true" }] },
    { hasCompletedWidgetSetup: null },
  ])("rejects invalid supplied values %j without changing any settings", async payload => {
    const before = await persistedDisplay();
    const notificationsBefore = await persistedNotifications();
    await patchWidgets(payload).expect(400);
    expect(await persistedDisplay()).toEqual(before);
    expect(await persistedNotifications()).toEqual(notificationsBefore);
  });

  it.each([
    { enabled: true, order: 0 }, { enabled: true, chartType: "bar" }, { order: 0, chartType: "bar" },
  ])("rejects a new unknown widget missing required attributes %j without creating a row", async widget => {
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    await patchWidgets({ optionalWidgets: { newUnknown: widget }, hasCompletedWidgetSetup: true }).expect(400);
    expect(await persistedDisplay()).toBeUndefined();
  });
});
