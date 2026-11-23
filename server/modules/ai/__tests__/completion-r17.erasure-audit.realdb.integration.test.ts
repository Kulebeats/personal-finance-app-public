/**
 * Astra A-25, real Postgres and the real HTTP routes; only the provider SDK
 * calls are recorded answers.
 *
 * Every Thandi question writes an `ai_query` audit row holding the question
 * (`query`) and the start of the answer (`response_summary`). Erasing a member
 * of a shared household must remove that text from the member's rows, while
 * the audit events themselves stay as the household's history. Another
 * member's rows are untouched.
 */
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { auditLogs } from "@shared/schema";
import { db } from "../../../db";
import {
  chat,
  CLAUDE_ANSWER,
  newKey,
  startR17Harness,
  stopR17Harness,
  stubProviders,
  type R17Harness,
} from "./completion-r17.realdb.fixture";
import { password } from "./ai.cache-privacy.fixture";

let harness: R17Harness;
type Actor = R17Harness["fixture"]["owner"];

const MEMBER_QUESTION = "How much did I spend at the clinic for my private appointment?";
const OWNER_QUESTION = "How much did we spend on groceries?";

function erase(app: R17Harness["app"], actor: Actor) {
  return request(app).post("/api/settings/security/step-up").set("Cookie", actor.cookie).send({ password }).expect(200)
    .then(() => request(app).post("/api/settings/account/delete").set("Cookie", actor.cookie).send({ password }));
}

async function queryAuditDetails(householdId: string, userId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await db.select({ action: auditLogs.action, details: auditLogs.details }).from(auditLogs)
    .where(and(eq(auditLogs.householdId, householdId), eq(auditLogs.userId, userId), eq(auditLogs.entityType, "ai_query")));
  return rows.map((row) => ({ action: row.action, ...(row.details as Record<string, unknown>) }));
}

/** Each audit row exactly as stored: its id and details as Postgres text. */
async function rawQueryAuditRows(householdId: string, userId: string): Promise<Array<{ id: string; details: string }>> {
  return db.select({ id: auditLogs.id, details: sql<string>`${auditLogs.details}::text` }).from(auditLogs)
    .where(and(eq(auditLogs.householdId, householdId), eq(auditLogs.userId, userId), eq(auditLogs.entityType, "ai_query")))
    .orderBy(asc(auditLogs.id));
}

describe("Astra A-25: erasure removes the member's Thandi text from the household audit (real Postgres)", () => {
  beforeEach(async () => {
    harness = await startR17Harness();
  });

  afterEach(async () => {
    await stopR17Harness(harness);
  });

  it("keeps the erased member's audit events without their question or answer, and leaves the owner's rows as they were", async () => {
    const { app, fixture } = harness;
    stubProviders();
    await chat(app, fixture.member, { message: MEMBER_QUESTION, clientRequestKey: newKey() }).expect(200);
    await chat(app, fixture.owner, { message: OWNER_QUESTION, clientRequestKey: newKey() }).expect(200);
    const ownerBefore = await rawQueryAuditRows(fixture.householdId, fixture.owner.id);
    expect(await queryAuditDetails(fixture.householdId, fixture.member.id)).toEqual([
      expect.objectContaining({ query: MEMBER_QUESTION, response_summary: CLAUDE_ANSWER.response }),
    ]);

    const erased = await erase(app, fixture.member);
    expect(erased.status).toBe(200);

    const member = await queryAuditDetails(fixture.householdId, fixture.member.id);
    expect(member).toHaveLength(1);
    expect(member[0]).toMatchObject({ action: "CREATE", content_erased: true, tools_used: expect.any(Array) });
    expect(member[0]).not.toHaveProperty("query");
    expect(member[0]).not.toHaveProperty("response_summary");
    expect(JSON.stringify(member)).not.toContain("clinic");
    // Another member's rows are byte-identical, and still hold their question.
    expect(await rawQueryAuditRows(fixture.householdId, fixture.owner.id)).toEqual(ownerBefore);
    expect(ownerBefore).toHaveLength(1);
    expect(ownerBefore[0].details).toContain(OWNER_QUESTION);
  });

  it("scrubs the raw error text in an earlier failure audit during signed erasure", async () => {
    const { app, fixture } = harness;
    await db.insert(auditLogs).values({ householdId: fixture.householdId, userId: fixture.member.id,
      action: "CREATE", entityType: "ai_query", details: { query: MEMBER_QUESTION, error: "Synthetic private diagnostic", success: false } });

    expect((await erase(app, fixture.member)).status).toBe(200);
    expect(await queryAuditDetails(fixture.householdId, fixture.member.id)).toEqual([
      { action: "CREATE", content_erased: true, success: false },
    ]);
  });
});
