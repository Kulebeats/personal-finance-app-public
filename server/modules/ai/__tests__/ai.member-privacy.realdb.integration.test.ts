import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, budgets, goalTransfers, goals, recurringTransactions, transactions } from "@shared/schema";
import { db } from "../../../db";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { recordRecurringDenomination } from "../../../services/recurring/RecurringDenomination";
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

// C3-08 lane safe-ai-privacy. Real password login, signed session, the
// production /api/ai/chat route and PostgreSQL readers. Only the external
// provider is replaced: it picks one tool and its "answer" is the exact
// sanitized payload the server would have sent out.
//
// The owner (A) holds a private savings account. Everything that depends on it
// is A's private figure and must never reach the household member (B):
const PRIVATE_FIGURES = {
  ownerPrivateBalance: "4222.23",
  ownerPrivateExpense: "777.77",
  ownerCombinedSpend: "788.88",
  ownerPrivateRecurring: "456.71",
  ownerCombinedOutflow: "480.16",
  ownerPrivateGoalProgress: "731.24",
  ownerDeletedBalance: "5555.55",
  ownerTransferredProgress: "318.19",
} as const;

const PRIVATE_GOAL = { name: "Retirement Savings", target: "1600.00" } as const;
// A shared goal on the shared account, funded by a transfer out of the private goal.
const TRANSFER_GOAL = { name: "House Fund", target: "2400.00" } as const;

// Each tool names the private figure the owner must see, which proves the seed
// reaches that reader; the member must see none of them.
const TOOLS = [
  { name: "get_spending_by_category", ownerSees: PRIVATE_FIGURES.ownerCombinedSpend },
  { name: "get_goals_status", ownerSees: PRIVATE_FIGURES.ownerPrivateGoalProgress },
  { name: "get_upcoming_recurring", ownerSees: PRIVATE_FIGURES.ownerPrivateRecurring },
  { name: "get_account_balances", ownerSees: PRIVATE_FIGURES.ownerPrivateBalance },
  { name: "get_merchant_spending", ownerSees: PRIVATE_FIGURES.ownerCombinedSpend },
  { name: "get_category_trends", ownerSees: PRIVATE_FIGURES.ownerCombinedSpend },
  { name: "get_monthly_summary", ownerSees: PRIVATE_FIGURES.ownerCombinedSpend },
  { name: "get_goal_assignments", ownerSees: PRIVATE_FIGURES.ownerPrivateGoalProgress },
  { name: "get_cash_flow", ownerSees: PRIVATE_FIGURES.ownerCombinedOutflow },
  { name: "get_budget_status", ownerSees: PRIVATE_FIGURES.ownerCombinedSpend },
  { name: "get_recent_transactions", ownerSees: PRIVATE_FIGURES.ownerPrivateExpense },
  { name: "get_transaction_search", ownerSees: PRIVATE_FIGURES.ownerPrivateExpense },
] as const;

type ToolCase = (typeof TOOLS)[number];
type GoalRow = Record<string, unknown>;

let app: Awaited<ReturnType<typeof getTestApp>>;
let fixture: CachePrivacyFixture;
let passwordHash: string;
let selectedTool: ToolCase["name"];

async function seedOwnerPrivateSources(seed: CachePrivacyFixture) {
  // The budget reader only counts activity in a verified denomination.
  await db.update(transactions).set({ currency: "ZMW" }).where(eq(transactions.householdId, seed.householdId));
  await db.transaction(async tx => {
    const [rule] = await tx.insert(recurringTransactions).values({
      householdId: seed.householdId,
      accountId: seed.ownerAccountId,
      name: "C308 Owner private recurring",
      amount: PRIVATE_FIGURES.ownerPrivateRecurring,
      type: "expense",
      frequency: "monthly",
      startDate: seed.date,
      nextDueDate: seed.date,
      isActive: true,
    }).returning();
    await recordRecurringDenomination(tx, rule, "ZMW", seed.owner.id, "manual_creation");
  });
  const privateGoalId = randomUUID();
  const transferGoalId = randomUUID();
  await db.insert(goals).values({
    id: privateGoalId,
    householdId: seed.householdId,
    name: PRIVATE_GOAL.name,
    targetAmount: PRIVATE_GOAL.target,
    currentAmount: PRIVATE_FIGURES.ownerPrivateGoalProgress,
    linkedAccountId: seed.ownerAccountId,
    currency: "ZMW",
  });
  await db.insert(goals).values({
    id: transferGoalId,
    householdId: seed.householdId,
    name: TRANSFER_GOAL.name,
    targetAmount: TRANSFER_GOAL.target,
    currentAmount: PRIVATE_FIGURES.ownerTransferredProgress,
    linkedAccountId: seed.sharedAccountId,
    currency: "ZMW",
  });
  await db.insert(goalTransfers).values({
    householdId: seed.householdId,
    fromGoalId: privateGoalId,
    toGoalId: transferGoalId,
    amount: PRIVATE_FIGURES.ownerTransferredProgress,
    createdBy: seed.owner.id,
  });
  await db.insert(accounts).values({
    householdId: seed.householdId,
    name: "C308 OWNER DELETED",
    type: "checking",
    currency: "ZMW",
    balance: PRIVATE_FIGURES.ownerDeletedBalance,
    isPrivate: false,
    ownerUserId: seed.owner.id,
    deletedAt: new Date(),
  });
  await db.insert(budgets).values({
    householdId: seed.householdId,
    name: "C308 Household budget",
    categoryId: seed.categoryId,
    amount: "1000.00",
    currency: "ZMW",
  });
}

/**
 * The sanitized tool payload the server handed to the provider for this request.
 * `cold: false` skips the cache invalidation, so a result left by the previous
 * caller would be served if tool-result reuse were ever re-enabled.
 */
async function sentPayload(actor: CachePrivacyActor, tool: ToolCase["name"], { cold = true } = {}) {
  selectedTool = tool;
  if (cold) aiCache.invalidateHousehold(actor.householdId);
  const calls = vi.mocked(geminiClient.generateResponse).mock.calls;
  const before = calls.length;
  const response = await request(app)
    .post("/api/ai/chat")
    .set("Cookie", actor.cookie)
    .send({ message: "Please summarize my household finances." });
  expect(response.status, response.text).toBe(200);
  expect(response.body.toolsUsed).toEqual([tool]);
  expect(calls).toHaveLength(before + 1);
  const sent = calls[before][1] as Array<{ name: string; result: unknown }>;
  expect(sent.map(row => row.name)).toEqual([tool]);
  return { result: sent[0].result, text: JSON.stringify(sent), reply: String(response.body.reply) };
}

function goalRows(result: unknown, collection: "goals" | "assignments"): GoalRow[] {
  return (result as Record<typeof collection, GoalRow[]>)[collection];
}

function rowByTarget(rows: GoalRow[], targetField: string, target: string) {
  const matching = rows.filter(row => row[targetField] === target);
  expect(matching).toHaveLength(1);
  return matching[0];
}

describe("C3-08 the AI assistant never gives one household member another member's private figures", () => {
  beforeAll(async () => {
    app = await getTestApp();
    passwordHash = await hashPassword(password);
  });

  beforeEach(async () => {
    fixture = createCachePrivacyFixture();
    await seedCachePrivacyFixture(fixture, app, passwordHash);
    await seedOwnerPrivateSources(fixture);
    vi.spyOn(geminiClient, "isAvailable").mockReturnValue(true);
    vi.spyOn(geminiClient, "analyzeQuery").mockImplementation(async () => ({
      toolCalls: [{ name: selectedTool, args: {} }],
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

  it.each(TOOLS)("$name sends the member none of the owner's private figures", async tool => {
    const owner = await sentPayload(fixture.owner, tool.name);
    expect(owner.text).toContain(tool.ownerSees);

    const member = await sentPayload(fixture.member, tool.name);
    for (const hidden of Object.values(PRIVATE_FIGURES)) {
      expect(member.text, `${tool.name} leaked ${hidden}`).not.toContain(hidden);
    }
    // The reply names the member's own visible accounts; never another member's private figures.
    for (const hidden of Object.values(PRIVATE_FIGURES)) {
      expect(member.reply, `${tool.name} replied with ${hidden}`).not.toContain(hidden);
    }
    expect(member.reply).not.toContain("C308 OWNER PRIVATE");
  });

  it.each(TOOLS)("$name answers the member with their own figures straight after the owner asked", async tool => {
    const expected = await sentPayload(fixture.member, tool.name);
    const owner = await sentPayload(fixture.owner, tool.name);
    expect(owner.text).toContain(tool.ownerSees);

    // Same tool, same arguments, no invalidation between the two members.
    const member = await sentPayload(fixture.member, tool.name, { cold: false });
    expect(member.result).toEqual(expected.result);
    for (const hidden of Object.values(PRIVATE_FIGURES)) {
      expect(member.text, `${tool.name} served ${hidden} after the owner's request`).not.toContain(hidden);
    }
  });

  it("get_goals_status keeps the shared goal target and marks private-sourced progress unavailable", async () => {
    const owner = await sentPayload(fixture.owner, "get_goals_status");
    expect(rowByTarget(goalRows(owner.result, "goals"), "targetAmount", PRIVATE_GOAL.target)).toMatchObject({
      name: PRIVATE_GOAL.name,
      currentAmount: PRIVATE_FIGURES.ownerPrivateGoalProgress,
      progressAvailability: "available",
    });

    const member = await sentPayload(fixture.member, "get_goals_status");
    const rows = goalRows(member.result, "goals");
    expect(rowByTarget(rows, "targetAmount", PRIVATE_GOAL.target)).toEqual({
      name: PRIVATE_GOAL.name,
      targetAmount: PRIVATE_GOAL.target,
      currentAmount: null,
      progressPercent: null,
      status: null,
      progressAvailability: "unavailable",
    });
    expect(rowByTarget(rows, "targetAmount", "1000.00")).toMatchObject({
      currentAmount: "207.89",
      progressAvailability: "available",
    });
  });

  it("get_goals_status withholds shared-goal progress funded by a transfer from a private-sourced goal", async () => {
    const owner = await sentPayload(fixture.owner, "get_goals_status");
    expect(rowByTarget(goalRows(owner.result, "goals"), "targetAmount", TRANSFER_GOAL.target)).toMatchObject({
      currentAmount: PRIVATE_FIGURES.ownerTransferredProgress,
      progressAvailability: "available",
    });

    const member = await sentPayload(fixture.member, "get_goals_status");
    expect(rowByTarget(goalRows(member.result, "goals"), "targetAmount", TRANSFER_GOAL.target)).toMatchObject({
      targetAmount: TRANSFER_GOAL.target,
      currentAmount: null,
      progressPercent: null,
      progressAvailability: "unavailable",
    });
  });

  it("get_goal_assignments keeps the shared goal target and withholds the private source and progress", async () => {
    const member = await sentPayload(fixture.member, "get_goal_assignments");
    const rows = goalRows(member.result, "assignments");
    expect(rowByTarget(rows, "target", PRIVATE_GOAL.target)).toEqual({
      goalName: PRIVATE_GOAL.name,
      accountName: null,
      target: PRIVATE_GOAL.target,
      current: null,
      progressAvailability: "unavailable",
    });
    expect(rowByTarget(rows, "target", "1000.00")).toMatchObject({
      current: "207.89",
      progressAvailability: "available",
    });
  });

  it("get_cash_flow projects only the recurring rules and balances the member can see", async () => {
    const member = await sentPayload(fixture.member, "get_cash_flow");
    const projections = (member.result as { projections: Array<Record<string, unknown>> }).projections;
    expect(projections).toHaveLength(3);
    // Visible to the member: shared 988.89 + own private 633.33; shared rule 23.45.
    expect(projections.map(row => [row.outflow, row.projectedEndingBalance])).toEqual([
      ["23.45", "1598.77"],
      ["23.45", "1575.32"],
      ["23.45", "1551.87"],
    ]);
  });

  it("get_cash_flow withholds unproven private income in the signed provider and local replies", async () => {
    const legacyAmount = "863.27";
    await db.insert(recurringTransactions).values({
      householdId: fixture.householdId, accountId: fixture.memberAccountId, name: "Legacy private income",
      amount: legacyAmount, type: "income", frequency: "monthly", startDate: fixture.date, nextDueDate: fixture.date,
      detectionMethod: "manual",
    });

    const owner = await sentPayload(fixture.owner, "get_cash_flow");
    expect(owner.result).toMatchObject({ projections: Array.from({ length: 3 }, () => ({
      inflow: "0.00", outflow: PRIVATE_FIGURES.ownerCombinedOutflow, net: "-480.16",
    })) });
    const member = await sentPayload(fixture.member, "get_cash_flow", { cold: false });
    expect(member.result).toMatchObject({ projections: Array.from({ length: 3 }, () => ({
      inflow: null, outflow: "23.45", net: null, projectedEndingBalance: null,
    })) });
    expect(member.text).not.toContain(legacyAmount);

    vi.mocked(geminiClient.isAvailable).mockReturnValue(false);
    const response = await request(app).post("/api/ai/chat").set("Cookie", fixture.member.cookie)
      .send({ message: "Show my cash flow forecast." }).expect(200);
    expect(response.body.toolsUsed).toEqual(["get_cash_flow"]);
    expect(response.body.reply).toContain("in unavailable, out ZMW 23.45, net unavailable, balance unavailable");
    expect(response.body.reply).not.toContain(legacyAmount);
  });

  it("the keyword reply shows the shared goal target with progress unavailable", async () => {
    vi.mocked(geminiClient.isAvailable).mockReturnValue(false);
    const response = await request(app)
      .post("/api/ai/chat")
      .set("Cookie", fixture.member.cookie)
      .send({ message: "Show progress for my goals." })
      .expect(200);
    expect(response.body.toolsUsed).toEqual(["get_goals_status"]);
    const reply = String(response.body.reply);
    const goalLines = reply.split("\n").filter(line => line.includes(PRIVATE_GOAL.name));
    expect(goalLines).toEqual([`- ${PRIVATE_GOAL.name}: target ZMW ${PRIVATE_GOAL.target} (progress unavailable)`]);
    expect(reply).toContain("ZMW 207.89");
    expect(reply).not.toContain(PRIVATE_FIGURES.ownerPrivateGoalProgress);
    expect(geminiClient.analyzeQuery).not.toHaveBeenCalled();
    expect(geminiClient.generateResponse).not.toHaveBeenCalled();
  });
});
