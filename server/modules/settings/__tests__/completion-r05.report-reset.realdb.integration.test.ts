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
const defaultMaps = {
  coreWidgets: {
    summaryCards: { enabled: true, order: 0, chartType: "cards" },
    goalProgress: { enabled: true, order: 1, chartType: "progressBars" },
    fixedVariableExpenses: { enabled: true, order: 2, chartType: "donut" },
  },
  optionalWidgets: {
    monthlyTrends: { enabled: true, order: 0, chartType: "bar" },
    netWorthTimeline: { enabled: true, order: 1, chartType: "area" },
    savingsRate: { enabled: true, order: 2, chartType: "line" },
    incomeBreakdown: { enabled: false, order: 3, chartType: "bar" },
    topMerchants: { enabled: false, order: 4, chartType: "bar" },
    categoryTrends: { enabled: false, order: 5, chartType: "line" },
    debtPaydown: { enabled: false, order: 6, chartType: "area" },
    sankeyFlow: { enabled: false, order: 7, chartType: "sankey" },
  },
};
const savedLayout = {
  widgets: [{ id: "net-worth", label: "Net worth", enabled: false }], version: 6,
  weeklyRecap: { dayOfWeek: 4, includeGoals: false, includeRecurring: false, futureRecap: "retained" },
  futureLayout: { retained: true },
};
const savedChart = {
  id: "legacy-chart", name: "Legacy chart", chartType: "bar", primaryMetric: "income", order: 4,
  secondaryMetric: "expenses", groupBy: "month", aggregation: "sum",
  showAverage: true, showComparison: false, futureChart: { retained: true },
};
const savedPreferences = {
  coreWidgets: {
    summaryCards: { id: "summaryCards", enabled: false, order: 7, chartType: "donut", expanded: true },
    goalProgress: { enabled: false, order: 4, chartType: "progressBars" },
    futureCore: { enabled: true, order: 8, chartType: "line", futureWidget: "removed-with-layout" },
  },
  optionalWidgets: {
    monthlyTrends: { enabled: false, order: 6, chartType: "area", expanded: false },
    futureOptional: { enabled: true, order: 9, chartType: "area" },
  },
  customCharts: [savedChart], hasCompletedWidgetSetup: true, futurePreferences: { retained: true },
};
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

async function persistedDisplay(userId = subject) {
  const [display] = await db.select().from(userDisplaySettings).where(eq(userDisplaySettings.userId, userId));
  return display;
}

async function persistedNotifications(userId = subject) {
  return db.select().from(userNotificationPreferences).where(eq(userNotificationPreferences.userId, userId));
}

function resetWidgets(body: string | object = {}) {
  return request(app).post("/api/settings/report-widgets/reset").set("Cookie", cookie).send(body);
}

function patchWidgets(body: object) {
  return request(app).patch("/api/settings/report-widgets").set("Cookie", cookie).send(body);
}

async function freshWidgets() {
  const response = await request(app).get("/api/settings/report-widgets").set("Cookie", cookie).expect(200);
  return response.body.data.preferences;
}

async function assertReadback() {
  const display = await persistedDisplay();
  const fresh = await freshWidgets();
  expect(fresh).toEqual(display.reportWidgetPreferences);
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
  throw new Error("Expected the real HTTP reset/patch writer to reach the held PostgreSQL row lock");
}

async function contend(writes: Array<() => ReturnType<typeof patchWidgets>>) {
  const holder = await pool.connect();
  const pending: Array<Promise<request.Response>> = [];
  try {
    await holder.query("BEGIN");
    const { rows: [{ pid }] } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await holder.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [subject]);
    await holder.query("SELECT user_id FROM user_display_settings WHERE user_id = $1 FOR UPDATE", [subject]);
    const waiting: number[] = [];
    for (const write of writes) {
      pending.push(write().then(response => response));
      const blocked = await blockedWriter([pid, ...waiting], [pid, ...waiting]);
      expect(blocked.blockers.some(blocker => [pid, ...waiting].includes(blocker))).toBe(true);
      waiting.push(blocked.pid);
    }
    console.info(`[R05 reset contention] observed ${waiting.length} HTTP writers blocked by PostgreSQL`);
    await holder.query("COMMIT");
    return await Promise.all(pending);
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
    await Promise.allSettled(pending);
  }
}

describe("R05 report-layout reset on disposable PostgreSQL", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const password = "SyntheticR05Reset123!";
    const passwordHash = await hashPassword(password);
    await db.insert(users).values([
      { id: subject, email: `r05r-${tag}@example.invalid`, username: `r05r-${tag}`, passwordHash, emailVerified: true },
      { id: neighbor, email: `r05r-other-${tag}@example.invalid`, username: `r05r-other-${tag}`, passwordHash, emailVerified: true },
    ]);
    await db.insert(userDisplaySettings).values({ userId: neighbor, theme: "light", firstDayOfWeek: "Friday", dashboardWidgets: savedLayout, reportWidgetPreferences: savedPreferences });
    await db.insert(userNotificationPreferences).values({ userId: neighbor, notificationType: NOTIFICATION_TYPES.WEEKLY_RECAP, thresholdAmount: "901.25", emailEnabled: true });
    const login = await request(app).post("/api/auth/login").send({ email: `r05r-${tag}@example.invalid`, password });
    expect(login.status).toBe(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  beforeEach(async () => {
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    await db.delete(userNotificationPreferences).where(eq(userNotificationPreferences.userId, subject));
    await db.insert(userDisplaySettings).values({ userId: subject, theme: "dark", firstDayOfWeek: "Monday", dashboardWidgets: savedLayout, reportWidgetPreferences: savedPreferences });
    await db.insert(userNotificationPreferences).values({
      userId: subject, notificationType: NOTIFICATION_TYPES.WEEKLY_RECAP, thresholdAmount: "73.25",
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

  it.each([false, true])("rejects unauthenticated reset without writing settings; first reset=%s", async firstReset => {
    if (firstReset) await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    const before = await persistedDisplay();
    const notificationsBefore = await persistedNotifications();
    const neighborBefore = await persistedDisplay(neighbor);
    const neighborNotifications = await persistedNotifications(neighbor);
    await request(app).post("/api/settings/report-widgets/reset").send({}).expect(401);
    expect(await persistedDisplay()).toEqual(before);
    expect(await persistedNotifications()).toEqual(notificationsBefore);
    expect(await persistedDisplay(neighbor)).toEqual(neighborBefore);
    expect(await persistedNotifications(neighbor)).toEqual(neighborNotifications);
  });

  it("writes separate personal display audit rows for signed-in report patch and reset", async () => {
    const auditFields = {
      id: auditLogs.id,
      householdId: auditLogs.householdId,
      userId: auditLogs.userId,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
    };
    const existing = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.userId, subject));
    const existingIds = new Set(existing.map(row => row.id));

    await patchWidgets({ hasCompletedWidgetSetup: false }).expect(200);
    const afterPatch = await db.select(auditFields).from(auditLogs).where(eq(auditLogs.userId, subject));
    const patchRows = afterPatch.filter(row => !existingIds.has(row.id));
    expect(patchRows).toHaveLength(1);
    expect(patchRows[0]).toMatchObject({
      householdId: null, userId: subject, action: "UPDATE", entityType: "display_settings", entityId: subject,
    });

    await resetWidgets().expect(200);
    const afterReset = await db.select(auditFields).from(auditLogs).where(eq(auditLogs.userId, subject));
    const resetRows = afterReset.filter(row => !existingIds.has(row.id) && row.id !== patchRows[0].id);
    expect(resetRows).toHaveLength(1);
    expect(resetRows[0]).toMatchObject({
      householdId: null, userId: subject, action: "UPDATE", entityType: "display_settings", entityId: subject,
    });
  });

  it("restores the exact server layout defaults and preserves charts, setup, future metadata, and adjacent settings", async () => {
    const before = await persistedDisplay();
    const notificationsBefore = await persistedNotifications();
    const neighborBefore = await persistedDisplay(neighbor);
    const neighborNotifications = await persistedNotifications(neighbor);
    const expected = { ...savedPreferences, ...defaultMaps };
    const response = await resetWidgets().expect(200);
    expect(response.body).toMatchObject({ success: true, data: { preferences: expected } });
    expect(await assertReadback()).toEqual(expected);
    const after = await persistedDisplay();
    expect({ ...after, reportWidgetPreferences: before.reportWidgetPreferences, updatedAt: before.updatedAt }).toEqual(before);
    expect(await persistedNotifications()).toEqual(notificationsBefore);
    expect(await persistedDisplay(neighbor)).toEqual(neighborBefore);
    expect(await persistedNotifications(neighbor)).toEqual(neighborNotifications);
    expect((await freshWidgets()).customCharts[0]).not.toHaveProperty("createdAt");
  });

  it("creates one display row with defaults and setup incomplete for a first reset", async () => {
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    const response = await resetWidgets().expect(200);
    const expected = { ...defaultMaps, customCharts: [], hasCompletedWidgetSetup: false };
    expect(response.body.data.preferences).toEqual(expected);
    expect(await assertReadback()).toEqual(expected);
    expect(await db.select().from(userDisplaySettings).where(eq(userDisplaySettings.userId, subject))).toHaveLength(1);
    expect(await persistedDisplay()).toMatchObject({ theme: "system", firstDayOfWeek: "Sunday" });
  });

  it.each(["reset-first", "patch-first"])("preserves a disjoint custom-chart/setup patch when %s writers are observed at PostgreSQL locks", async order => {
    const replacement = { id: "new-chart", name: "New chart", chartType: "line", primaryMetric: "expenses", order: 0, showAverage: false };
    const writes = [() => resetWidgets(), () => patchWidgets({ customCharts: [replacement], hasCompletedWidgetSetup: false })];
    const responses = await contend(order === "reset-first" ? writes : writes.reverse());
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await assertReadback()).toEqual({ ...savedPreferences, ...defaultMaps, customCharts: [replacement], hasCompletedWidgetSetup: false });
    expect((await persistedDisplay()).dashboardWidgets).toEqual(savedLayout);
  }, 30000);

  it.each([{ coreWidgets: {} }, { customCharts: [] }, { hasCompletedWidgetSetup: false }, { futurePreferences: true }, []])("rejects nonempty or malformed reset input %j without changing settings", async payload => {
    const before = await persistedDisplay();
    const notificationsBefore = await persistedNotifications();
    await resetWidgets(payload).expect(400);
    expect(await persistedDisplay()).toEqual(before);
    expect(await persistedNotifications()).toEqual(notificationsBefore);
  });

  it("rejects invalid reset input before creating a first display row", async () => {
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    await resetWidgets({ customCharts: [] }).expect(400);
    expect(await persistedDisplay()).toBeUndefined();
  });
});
