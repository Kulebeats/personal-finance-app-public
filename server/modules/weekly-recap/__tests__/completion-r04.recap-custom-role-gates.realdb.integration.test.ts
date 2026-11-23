/**
 * AH-09 / R04.3: ad hoc recap generation, recap feedback and the custom chart
 * (GET and POST run the same chart) are gated by `financial.export` (A3 matrix: owner, admin and member
 * yes; view_only and professional no). A refused call writes nothing: no
 * generation audit row, no feedback row. Signed HTTP against real Postgres.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import request from "supertest";
import { auditLogs, households } from "@shared/schema";
import { db } from "../../../db";
import { a, actors, app, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const weekStart = "2026-10-05";
const weekEnd = "2026-10-11";
const feedback = { weekStart, weekEnd, step: "spending", feedback: "positive" };
const customChart = { chartType: "bar", primaryMetric: "expenses", groupBy: "category", from: weekStart, to: weekEnd };
const refused: readonly Role[] = ["view_only", "professional"];
const allowed: readonly Role[] = ["owner", "admin", "member"];

const post = (path: string, role: Role, body: object) =>
  request(app).post(path).set("Cookie", actors.get(role)!.cookie).send(body);
const customChartBy = {
  GET: (role: Role) => request(app).get(`/api/reports/custom?${new URLSearchParams(customChart)}`)
    .set("Cookie", actors.get(role)!.cookie),
  POST: (role: Role) => post("/api/reports/custom", role, customChart),
};
const verbs = ["GET", "POST"] as const;

async function generationAudits(role: Role) {
  return db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.userId, actors.get(role)!.id),
    sql`${auditLogs.details}->>'action' = 'weekly_recap_generated'`));
}
async function feedbackRows(role: Role) {
  const result = await db.execute(sql`SELECT id FROM weekly_recap_feedback WHERE user_id = ${actors.get(role)!.id}`);
  return result.rows;
}

describe("AH-09 recap generate, recap feedback and custom chart need financial.export", () => {
  beforeAll(async () => {
    await start();
    await db.update(households).set({ aiConsentGiven: true }).where(eq(households.id, a));
  }, 30_000);
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM weekly_recap_feedback WHERE household_id = ${a}`);
    await reset();
  });
  afterAll(async () => {
    await db.execute(sql`DELETE FROM weekly_recap_feedback WHERE household_id = ${a}`);
    await stop();
  });

  it.each(refused)("%s gets 403 from POST /api/weekly-recap/generate and no generation is audited", async (role) => {
    const response = await post("/api/weekly-recap/generate", role, { weekOf: weekStart }).expect(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(await generationAudits(role)).toEqual([]);
  });

  it.each(refused)("%s gets 403 from POST /api/weekly-recap/feedback and no row is stored", async (role) => {
    const response = await post("/api/weekly-recap/feedback", role, feedback).expect(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(await feedbackRows(role)).toEqual([]);
  });

  it.each(refused.flatMap(role => verbs.map(verb => [role, verb] as const)))(
    "%s gets 403 from %s /api/reports/custom", async (role, verb) => {
      const response = await customChartBy[verb](role).expect(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(response.body).not.toHaveProperty("data");
    });

  it.each(allowed)("%s can still generate, give feedback and run a custom chart", async (role) => {
    await post("/api/weekly-recap/generate", role, { weekOf: weekStart }).expect(200);
    expect(await generationAudits(role)).toHaveLength(1);
    await post("/api/weekly-recap/feedback", role, feedback).expect(200);
    expect(await feedbackRows(role)).toHaveLength(1);
    for (const verb of verbs) await customChartBy[verb](role).expect(200);
  });

  it.each(refused)("%s keeps read access: GET /api/weekly-recap answers 200", async (role) => {
    await request(app).get(`/api/weekly-recap?weekStart=${weekStart}&weekEnd=${weekEnd}`)
      .set("Cookie", actors.get(role)!.cookie).expect(200);
  });
});
