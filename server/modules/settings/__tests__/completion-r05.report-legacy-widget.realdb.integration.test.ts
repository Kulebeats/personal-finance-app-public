import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, users, userDisplaySettings } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

const subject = randomUUID();
const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const legacy = { enabled: true, order: 5, expanded: false, futureWidget: { retained: true } };
const preferences = {
  coreWidgets: {}, optionalWidgets: { legacyUnknown: legacy }, customCharts: [],
  hasCompletedWidgetSetup: true, futurePreferences: { retained: true },
};
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

describe("R05 persisted legacy report widget without chartType", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const password = "SyntheticR05Legacy123!";
    await db.insert(users).values({ id: subject, email: `r05legacy-${tag}@example.invalid`, username: `r05legacy-${tag}`, passwordHash: await hashPassword(password), emailVerified: true });
    // SQL deliberately seeds the legacy JSON that the truthful wire type permits.
    await pool.query("INSERT INTO user_display_settings (user_id, theme, report_widget_preferences) VALUES ($1, $2, $3::jsonb)", [subject, "dark", JSON.stringify(preferences)]);
    const login = await request(app).post("/api/auth/login").send({ email: `r05legacy-${tag}@example.invalid`, password });
    expect(login.status).toBe(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  afterAll(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.userId, subject));
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [subject]);
    await db.delete(users).where(eq(users.id, subject));
  });

  it("acknowledges and independently reads back an enabled-only PATCH without inventing chartType", async () => {
    const before = await request(app).get("/api/settings/report-widgets").set("Cookie", cookie).expect(200);
    expect(before.body.data.preferences.optionalWidgets.legacyUnknown).toEqual(legacy);
    const response = await request(app).patch("/api/settings/report-widgets").set("Cookie", cookie).send({ optionalWidgets: { legacyUnknown: { enabled: false } } }).expect(200);
    const expected = { ...legacy, enabled: false };
    expect(response.body.data.preferences.optionalWidgets.legacyUnknown).toEqual(expected);
    expect(response.body.data.preferences.optionalWidgets.legacyUnknown).not.toHaveProperty("chartType");
    const [stored] = await db.select().from(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    const fresh = await request(app).get("/api/settings/report-widgets").set("Cookie", cookie).expect(200);
    expect(stored.reportWidgetPreferences).toHaveProperty("optionalWidgets.legacyUnknown", expected);
    expect(stored.reportWidgetPreferences).not.toHaveProperty("optionalWidgets.legacyUnknown.chartType");
    expect(fresh.body.data.preferences).toEqual(stored.reportWidgetPreferences);
    expect(fresh.body.data.preferences).toMatchObject({ customCharts: [], hasCompletedWidgetSetup: true, futurePreferences: preferences.futurePreferences });
    expect(stored.theme).toBe("dark");
  });

  it("rejects a new unknown widget missing chartType and leaves the persisted document unchanged", async () => {
    const [before] = await db.select().from(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    await request(app).patch("/api/settings/report-widgets").set("Cookie", cookie).send({ optionalWidgets: { newUnknown: { enabled: true, order: 0 } } }).expect(400);
    const [after] = await db.select().from(userDisplaySettings).where(eq(userDisplaySettings.userId, subject));
    expect(after).toEqual(before);
  });
});
