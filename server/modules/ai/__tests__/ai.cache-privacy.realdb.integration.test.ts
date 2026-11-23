import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { accounts, householdMembers, households } from "@shared/schema";
import { db } from "../../../db";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { AIAnalyticsService } from "../ai.analytics.service";
import { aiCache } from "../ai.cache";
import { geminiClient } from "../ai.gemini";
import {
  cleanCachePrivacyFixture,
  createCachePrivacyFixture,
  password,
  seedCachePrivacyFixture,
  type CachePrivacyActor,
  type CachePrivacyFixture,
} from "./ai.cache-privacy.fixture";

// TEST-ONLY / NOT RUN. Real password login, signed session, production route,
// PostgreSQL readers, privacy filters and sanitizer. Only the external provider
// boundary is replaced; its answer echoes the actual minimized tool payload.
const tools = [
  { name: "get_spending_by_category", reader: "getSpendingByCategory", actorDependent: true },
  { name: "get_goals_status", reader: "getGoalsStatus", actorDependent: false },
  { name: "get_upcoming_recurring", reader: "getUpcomingRecurring", actorDependent: false },
  { name: "get_account_balances", reader: "getAccountBalances", actorDependent: true },
  { name: "get_merchant_spending", reader: "getMerchantSpending", actorDependent: true },
  { name: "get_category_trends", reader: "getCategoryTrends", actorDependent: true },
  { name: "get_monthly_summary", reader: "getMonthlySummary", actorDependent: true },
  { name: "get_goal_assignments", reader: "getGoalAssignments", actorDependent: false },
  { name: "get_cash_flow", reader: "getCashFlow", actorDependent: true },
] as const;

type ToolCase = (typeof tools)[number];
let app: Awaited<ReturnType<typeof getTestApp>>;
let fixture: CachePrivacyFixture;
let passwordHash: string;
let selectedTool: ToolCase;

async function chat(actor: CachePrivacyActor, tool: ToolCase) {
  selectedTool = tool;
  return request(app)
    .post("/api/ai/chat")
    .set("Cookie", actor.cookie)
    .send({ message: "Please summarize my household finances." });
}

async function payload(actor: CachePrivacyActor, tool: ToolCase) {
  const response = await chat(actor, tool);
  expect(response.status, response.text).toBe(200);
  expect(response.body.toolsUsed).toEqual([tool.name]);
  const results = JSON.parse(response.body.reply) as Array<{ name: string; result: unknown }>;
  expect(results).toHaveLength(1);
  expect(results[0].name).toBe(tool.name);
  return results[0].result;
}

async function fresh(actor: CachePrivacyActor, tool: ToolCase) {
  aiCache.invalidateHousehold(actor.householdId);
  return payload(actor, tool);
}

describe("C3-08 signed AI tool cache preserves the current caller's private scope", () => {
  beforeAll(async () => {
    app = await getTestApp();
    passwordHash = await hashPassword(password);
  });

  beforeEach(async () => {
    fixture = createCachePrivacyFixture();
    await seedCachePrivacyFixture(fixture, app, passwordHash);
    vi.spyOn(geminiClient, "isAvailable").mockReturnValue(true);
    vi.spyOn(geminiClient, "analyzeQuery").mockImplementation(async () => ({
      toolCalls: [{ name: selectedTool.name, args: {} }],
      tokenCount: 1,
    }));
    vi.spyOn(geminiClient, "generateResponse").mockImplementation(async (_message, results) => ({
      response: JSON.stringify(results),
      tokenCount: 1,
    }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (fixture) {
      aiCache.invalidateHousehold(fixture.householdId);
      aiCache.invalidateHousehold(fixture.foreignHouseholdId);
      await cleanCachePrivacyFixture(fixture);
    }
  });

  it.each(tools)("keeps $name bound to A/B in both warm orders and another household", async tool => {
    // Call-through spy observes provenance without mocking SQL or its filters.
    const reader = vi.spyOn(AIAnalyticsService.prototype, tool.reader);
    const expectedOwner = await fresh(fixture.owner, tool);
    const expectedMember = await fresh(fixture.member, tool);
    const expectedForeign = await fresh(fixture.outsider, tool);

    if (tool.actorDependent) {
      expect(expectedOwner).not.toEqual(expectedMember);
    }
    expect(expectedForeign).not.toEqual(expectedOwner);
    expect(expectedForeign).not.toEqual(expectedMember);

    aiCache.invalidateHousehold(fixture.householdId);
    expect(await payload(fixture.owner, tool)).toEqual(expectedOwner);
    expect(await payload(fixture.owner, tool)).toEqual(expectedOwner);
    const beforeMember = reader.mock.calls.length;
    const actualMember = await payload(fixture.member, tool);
    expect.soft(actualMember).toEqual(expectedMember);
    expect.soft(reader.mock.calls.slice(beforeMember).some(([context]) =>
      context.userId === fixture.member.id,
    )).toBe(true);
    expect.soft(await payload(fixture.member, tool)).toEqual(expectedMember);

    aiCache.invalidateHousehold(fixture.householdId);
    expect(await payload(fixture.member, tool)).toEqual(expectedMember);
    const beforeOwner = reader.mock.calls.length;
    expect.soft(await payload(fixture.owner, tool)).toEqual(expectedOwner);
    expect.soft(reader.mock.calls.slice(beforeOwner).some(([context]) =>
      context.userId === fixture.owner.id,
    )).toBe(true);
    expect.soft(await payload(fixture.outsider, tool)).toEqual(expectedForeign);
  });

  it.each(tools.filter(tool => tool.actorDependent))(
    "retires $name for the same signed member when shared custody becomes private",
    async tool => {
      const before = await payload(fixture.member, tool);
      await db.update(accounts)
        .set({ isPrivate: true, ownerUserId: fixture.owner.id })
        .where(eq(accounts.id, fixture.sharedAccountId));

      // Do not invoke an invalidation helper before the security assertion:
      // production account mutations currently never call those helpers.
      const after = await payload(fixture.member, tool);
      const expected = await fresh(fixture.member, tool);
      expect(expected).not.toEqual(before);
      expect(after).toEqual(expected);
    },
  );

  it("keeps the local keyword fallback within the current signed member's private spending", async () => {
    const tool = tools.find(row => row.name === "get_spending_by_category")!;
    const expected = await fresh(fixture.member, tool);
    aiCache.invalidateHousehold(fixture.householdId);
    await payload(fixture.owner, tool);
    vi.mocked(geminiClient.isAvailable).mockReturnValue(false);

    const response = await request(app)
      .post("/api/ai/chat")
      .set("Cookie", fixture.member.cookie)
      .send({ message: "How much did I spend?" })
      .expect(200);
    expect(response.body.toolsUsed).toEqual([tool.name]);
    expect(response.body.reply).not.toContain("788.88");
    expect(expected).toMatchObject({ total: "233.33" });
    expect(response.body.reply).toContain("233.33");
  });

  it.each(["consent", "membership"] as const)("a warm result cannot bypass revoked %s", async source => {
    const tool = tools.find(row => row.name === "get_account_balances")!;
    await payload(fixture.owner, tool);
    if (source === "consent") {
      await db.update(households)
        .set({ aiConsentGiven: false })
        .where(eq(households.id, fixture.householdId));
    } else {
      await db.delete(householdMembers).where(and(
        eq(householdMembers.householdId, fixture.householdId),
        eq(householdMembers.userId, fixture.member.id),
      ));
    }
    vi.mocked(geminiClient.analyzeQuery).mockClear();
    vi.mocked(geminiClient.generateResponse).mockClear();
    const response = await chat(fixture.member, tool);
    expect(response.status).toBe(source === "consent" ? 403 : 404);
    expect(response.text).not.toContain("4222.23");
    expect(geminiClient.analyzeQuery).not.toHaveBeenCalled();
    expect(geminiClient.generateResponse).not.toHaveBeenCalled();
  });
});
