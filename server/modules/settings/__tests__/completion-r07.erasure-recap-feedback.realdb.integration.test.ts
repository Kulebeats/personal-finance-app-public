/**
 * A-39: weekly-recap feedback (choice and free-text comment) is the erased
 * member's own words. In a shared household the user row stays as a
 * tombstone, so the FK cascade never runs; erasure must remove the member's
 * feedback and leave a co-member's feedback unchanged. Real HTTP against real
 * Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdMembers, households, securityAuditLogs, users, weeklyRecapFeedback } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

const password = "SyntheticRecapFeedbackErasure123!";
const householdId = randomUUID();
const ids: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
type Actor = { id: string; cookie: string };
let owner: Actor;
let member: Actor;
const memberComment = "Synthetic member comment that must not survive erasure";
const ownerComment = "Synthetic owner comment that stays";

async function fixture(role: "owner" | "member"): Promise<Actor> {
  const id = randomUUID();
  const email = `recap-feedback-erasure-${id}@example.invalid`;
  await db.insert(users).values({
    id, email, username: `recap-feedback-erasure-${id}`, passwordHash: await hashPassword(password), emailVerified: true,
  });
  ids.push(id);
  await db.insert(householdMembers).values({ userId: id, householdId, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}

function feedback(userId: string, comment: string) {
  return { userId, householdId, weekStart: "2026-11-02", weekEnd: "2026-11-08", step: "wrap-up", choice: "negative", comment };
}

describe("A-39 erasure removes the member's weekly-recap feedback", () => {
  let ownerFeedbackBefore: typeof weeklyRecapFeedback.$inferSelect;

  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic recap feedback erasure", currency: "ZMW" });
    owner = await fixture("owner");
    member = await fixture("member");
    await db.insert(weeklyRecapFeedback).values(feedback(member.id, memberComment));
    [ownerFeedbackBefore] = await db.insert(weeklyRecapFeedback).values(feedback(owner.id, ownerComment)).returning();

    await request(app).post("/api/settings/security/step-up").set("Cookie", member.cookie).send({ password }).expect(200);
    await request(app).post("/api/settings/account/delete").set("Cookie", member.cookie).send({ password }).expect(200);
  }, 60000);

  afterAll(async () => {
    for (const id of ids) await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [id]);
    await db.delete(weeklyRecapFeedback).where(eq(weeklyRecapFeedback.householdId, householdId));
    await db.delete(securityAuditLogs).where(inArray(securityAuditLogs.userId, ids));
    await db.delete(auditLogs).where(inArray(auditLogs.userId, ids));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    for (const id of ids) await db.delete(users).where(eq(users.id, id));
  });

  it("the household is still shared and the member is a tombstone (the cascade did not run)", async () => {
    const [household] = await db.select({ id: households.id }).from(households).where(eq(households.id, householdId));
    expect(household).toBeDefined();
    const [tombstone] = await db.select({ erasedAt: users.erasedAt }).from(users).where(eq(users.id, member.id));
    expect(tombstone?.erasedAt).not.toBeNull();
  });

  it("no feedback row of the erased member remains", async () => {
    const rows = await db.select().from(weeklyRecapFeedback).where(eq(weeklyRecapFeedback.userId, member.id));
    expect(rows).toEqual([]);
    const { rows: mentions } = await pool.query("SELECT count(*)::int AS n FROM weekly_recap_feedback WHERE comment = $1", [memberComment]);
    expect(mentions[0].n).toBe(0);
  });

  it("the co-member's feedback is unchanged", async () => {
    const [after] = await db.select().from(weeklyRecapFeedback).where(eq(weeklyRecapFeedback.id, ownerFeedbackBefore.id));
    expect(after).toEqual(ownerFeedbackBefore);
  });
});
