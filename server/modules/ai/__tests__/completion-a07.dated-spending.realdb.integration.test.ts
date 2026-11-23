/**
 * R6-01 / A-07: signed Thandi callers value financial flows on their own dates.
 * Only provider adapters are stubbed; the readers, trusted FX SQL, privacy
 * predicates and sanitizer are real. Run only in an approved disposable window.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { addMonths, format, subMonths } from "date-fns";
import { accounts, categories, fxRates, householdFxRateOverrides, households, merchants, providerFxQuotes, transactions } from "@shared/schema";
import { db } from "../../../db";
import { calendarClock } from "../../../services/householdCalendarToday";
import { aiCache } from "../ai.cache";
import { renderLocalSummary } from "../ai.local-templates";
import { chat, startR17Harness, stopR17Harness, stubProviders, type R17Harness } from "./completion-r17.realdb.fixture";
import type { CachePrivacyActor } from "./ai.cache-privacy.fixture";

const month = format(subMonths(new Date(), 1), "yyyy-MM");
const day = `${month}-15`, preceding = `${month}-14`, later = `${month}-16`;
const tools = [
  { name: "get_spending_by_category", args: { period: "12m" } },
  { name: "get_merchant_spending", args: { period: "12m", limit: 1 } },
  { name: "get_category_trends", args: { months: 12 } },
  { name: "get_monthly_summary", args: { month } },
] as const;
type Tool = { name: typeof tools[number]["name"]; args: Record<string, unknown> };
let harness: R17Harness;
let activeHarness: R17Harness | undefined;
let providers: ReturnType<typeof stubProviders>;
const quoteIds: string[] = [], legacyRateIds: string[] = [];

async function quote(rate: string, effectiveDate = preceding, validThrough = day) {
  const id = randomUUID(); quoteIds.push(id);
  await db.insert(providerFxQuotes).values({ id, fromCurrency: "USD", toCurrency: "ZMW", rate,
    provider: "yahoo_finance", effectiveDate, validThrough, quotedAt: new Date(`${effectiveDate}T08:00:00Z`) });
}

async function posting(amount: string, input: {
  currency?: string | null; type?: "income" | "expense"; privateAccount?: boolean; foreign?: boolean; categoryId?: string;
  merchantId?: string; date?: string;
} = {}) {
  const f = harness.fixture;
  await db.insert(transactions).values({ householdId: input.foreign ? f.foreignHouseholdId : f.householdId,
    accountId: input.foreign ? f.foreignAccountId : input.privateAccount ? f.ownerAccountId : f.sharedAccountId,
    ownerUserId: input.foreign ? f.outsider.id : f.owner.id, date: input.date ?? day, name: "Synthetic A07 flow",
    amount, currency: input.currency === undefined ? "USD" : input.currency, type: input.type ?? "expense",
    categoryId: input.categoryId ?? (input.foreign ? f.foreignCategoryId : f.categoryId),
    merchantId: input.merchantId ?? (input.foreign ? f.foreignMerchantId : f.merchantId), isPrivate: false });
}

async function competitor() {
  const id = randomUUID();
  await db.insert(merchants).values({ id, householdId: harness.fixture.householdId, name: "A07 Local competitor" });
  await posting("100", { currency: "ZMW", merchantId: id });
}

async function payload(tool: Tool, actor: CachePrivacyActor) {
  providers.gemini.analyzeQuery.mockResolvedValue({ toolCalls: [{ name: tool.name, args: tool.args }], tokenCount: 5 });
  aiCache.invalidateHousehold(actor.householdId);
  const before = providers.gemini.generateResponse.mock.calls.length;
  const response = await chat(harness.app, actor, { message: "Please summarize my household spending and income." });
  expect(response.status, response.text).toBe(200);
  expect(response.body.toolsUsed).toEqual([tool.name]);
  expect(providers.gemini.generateResponse.mock.calls).toHaveLength(before + 1);
  const sent = providers.gemini.generateResponse.mock.calls[before][1];
  expect(sent).toHaveLength(1);
  expect(sent[0].name).toBe(tool.name);
  expect(providers.claude.analyzeQuery).not.toHaveBeenCalled();
  return sent[0].result;
}

function available(tool: Tool, result: unknown, owner: boolean) {
  const amount = owner ? "555.00" : "515.00", count = owner ? 4 : 3;
  switch (tool.name) {
    case "get_spending_by_category":
      expect(result).toMatchObject({ categories: [{ amount, count }], total: amount }); break;
    case "get_merchant_spending":
      // The local competitor's raw 100 exceeds the mixed merchant's raw 70/72.
      // Conversion must precede ORDER BY / LIMIT, and averaging counts postings.
      expect(result).toMatchObject({ merchants: [{ name: "C308 Household store", totalSpent: amount,
        transactionCount: count, avgAmount: owner ? "138.75" : "171.67" }] }); break;
    case "get_category_trends":
      expect(result).toMatchObject({ trends: [{ points: [{ month, amount }], trendDirection: "flat" }] }); break;
    case "get_monthly_summary":
      expect(result).toMatchObject({ month, income: "500.00", expenses: amount,
        netSavings: owner ? "-55.00" : "-15.00", savingsRate: owner ? -11 : -3 }); break;
  }
}

function unavailable(tool: Tool, result: unknown) {
  switch (tool.name) {
    case "get_spending_by_category":
      expect(result).toMatchObject({ categories: [{ amount: null, count: 2 }], total: null, rankingAvailability: "unavailable" });
      expect(renderLocalSummary([result], "ZMW")).toContain("Spending by category (ranking unavailable)");
      break;
    case "get_merchant_spending":
      expect(result).toMatchObject({ rankingAvailability: "unavailable",
        merchants: [{ name: "C308 Household store", totalSpent: null, transactionCount: 2, avgAmount: null }] }); break;
    case "get_category_trends":
      expect(result).toMatchObject({ trends: [{ points: [{ month, amount: null }], trendDirection: "unavailable" }] }); break;
    case "get_monthly_summary":
      expect(result).toMatchObject({ income: "100.00", expenses: null, netSavings: null, savingsRate: null }); break;
  }
  expect(renderLocalSummary([result], "ZMW")).toContain("unavailable");
  expect(JSON.stringify(result)).not.toContain('"60.00"');
}

describe(`R6-01 / A-07 signed dated flows (USD/ZMW ${month}-13 through ${later})`, () => {
  beforeEach(async () => {
    activeHarness = undefined;
    const quotes = await db.select({ id: providerFxQuotes.id }).from(providerFxQuotes).where(and(
      eq(providerFxQuotes.fromCurrency, "USD"), eq(providerFxQuotes.toCurrency, "ZMW"),
      lte(providerFxQuotes.effectiveDate, later), gte(providerFxQuotes.validThrough, `${month}-13`),
    ));
    const legacy = await db.select({ id: fxRates.id }).from(fxRates).where(and(
      eq(fxRates.fromCurrency, "USD"), eq(fxRates.toCurrency, "ZMW"), gte(fxRates.date, `${month}-13`), lte(fxRates.date, later),
    ));
    expect(quotes, "A07 fixture conflict: trusted USD/ZMW window is occupied; use a fresh disposable target, preserving unrelated quotes").toEqual([]);
    expect(legacy, "A07 fixture conflict: legacy USD/ZMW dates are occupied; use a fresh disposable target, preserving unrelated rates").toEqual([]);
    harness = await startR17Harness();
    activeHarness = harness;
    const f = harness.fixture;
    await db.delete(transactions).where(inArray(transactions.householdId, [f.householdId, f.foreignHouseholdId]));
    // A captured ZMW posting on a USD account still has the ZMW transaction unit.
    await db.update(accounts).set({ currency: "USD" }).where(inArray(accounts.id, [f.sharedAccountId, f.ownerAccountId]));
    providers = stubProviders({ claude: false, gemini: true });
  });

  afterEach(async () => {
    try {
      try {
        if (quoteIds.length) await db.delete(providerFxQuotes).where(inArray(providerFxQuotes.id, [...quoteIds]));
        quoteIds.length = 0;
      } finally {
        if (legacyRateIds.length) await db.delete(fxRates).where(inArray(fxRates.id, [...legacyRateIds]));
        legacyRateIds.length = 0;
      }
    } finally {
      await stopR17Harness(activeHarness);
      activeHarness = undefined;
    }
  });

  for (const tool of tools) {
    it(`${tool.name}: USD 10 at historical 20 is ZMW 200 despite a later 26.50, for owner and peer`, async () => {
      await quote("20"); // Prior-day observation is valid through the transaction date, inclusively.
      await quote("26.50", later, later);
      await posting("10"); await posting("50", { currency: "ZMW" });
      await posting("10", { date: later }); // Same group, another date: USD 10 x 26.50 = ZMW 265.
      await posting("20", { type: "income" }); await posting("100", { currency: "ZMW", type: "income" });
      await posting("2", { privateAccount: true });
      await posting("999", { currency: "CAD", foreign: true }); // Must not poison either caller's valuation.
      await posting("8888", { currency: "ZMW", date: format(addMonths(new Date(), 1), "yyyy-MM-dd") });
      if (tool.name === "get_merchant_spending") await competitor();
      available(tool, await payload(tool, harness.fixture.owner), true);
      available(tool, await payload(tool, harness.fixture.member), false);
    });

    it.each(["missing", "expired", "future", "editable only", "uncaptured unit"] as const)(
      `${tool.name}: %s evidence leaves dependent figures unavailable, never zero or a partial total`, async evidence => {
        if (evidence === "expired") await quote("20", `${month}-13`, preceding);
        if (evidence === "future") await quote("26.50", later, later);
        if (evidence === "uncaptured unit") await quote("20");
        if (evidence === "editable only") {
          const id = randomUUID(); legacyRateIds.push(id);
          await db.insert(fxRates).values({ id, fromCurrency: "USD", toCurrency: "ZMW", rate: "999", date: day, source: "manual" });
          await db.insert(householdFxRateOverrides).values({ householdId: harness.fixture.householdId, actorUserId: harness.fixture.owner.id,
            fromCurrency: "USD", toCurrency: "ZMW", rate: "888", effectiveDate: preceding, validThrough: later });
        }
        await posting("10", { currency: evidence === "uncaptured unit" ? null : "USD" });
        await posting("50", { currency: "ZMW" });
        await posting("100", { currency: "ZMW", type: "income" });
        if (tool.name === "get_merchant_spending") await competitor();
        unavailable(tool, await payload(tool, harness.fixture.owner));
        unavailable(tool, await payload(tool, harness.fixture.member));
      },
    );
  }

  it("keeps priced sibling groups and months while withholding dependent totals, ranks and trends", async () => {
    const { householdId, member } = harness.fixture;
    const knownCategory = randomUUID();
    const earlierMonth = format(subMonths(new Date(), 2), "yyyy-MM");
    await db.insert(categories).values({ id: knownCategory, householdId, name: "A07 Priced category", displayOrder: 1 });
    await posting("10");
    await posting("40", { currency: "ZMW", date: earlierMonth + "-15" });
    await posting("75", { currency: "ZMW", categoryId: knownCategory });
    await competitor();

    expect(await payload(tools[0], member)).toMatchObject({
      total: null, rankingAvailability: "unavailable",
      categories: [{ amount: null, count: 3 }, { name: "A07 Priced category", amount: "75.00", count: 1 }],
    });
    expect(await payload({ ...tools[1], args: { ...tools[1].args, limit: 2 } }, member)).toMatchObject({
      rankingAvailability: "unavailable",
      merchants: [{ totalSpent: null, avgAmount: null }, { name: "A07 Local competitor", totalSpent: "100.00", avgAmount: "100.00" }],
    });
    expect(await payload(tools[2], member)).toMatchObject({
      trends: [
        { points: [{ month: earlierMonth, amount: "40.00" }, { month, amount: null }], trendDirection: "unavailable" },
        { categoryName: "A07 Priced category", points: [{ month, amount: "75.00" }], trendDirection: "flat" },
      ],
    });
  });

  it("keeps visible postings without importing category or merchant labels from another household", async () => {
    const { foreignCategoryId, foreignMerchantId, member } = harness.fixture;
    await posting("50", { currency: "ZMW" });
    await posting("100", { currency: "ZMW", categoryId: foreignCategoryId, merchantId: foreignMerchantId });

    expect(await payload(tools[0], member)).toMatchObject({
      categories: [{ name: "Uncategorized", amount: "100.00" }, { name: "C308 Household category", amount: "50.00" }],
      total: "150.00",
    });
    expect(await payload(tools[1], member)).toMatchObject({ merchants: [{ name: "C308 Household store", totalSpent: "50.00" }] });
    expect(await payload(tools[2], member)).toMatchObject({
      trends: [{ categoryName: "C308 Household category", points: [{ month, amount: "50.00" }] }],
    });
    expect(await payload({ ...tools[2], args: { months: 12, categoryId: foreignCategoryId } }, member))
      .toEqual({ trends: [] });
    expect(await payload(tools[3], member)).toMatchObject({ expenses: "150.00", netSavings: "-150.00", savingsRate: 0 });
  });

  it("uses the household's day and current month for a peer, with UTC for a legacy household", async () => {
    const { householdId, member } = harness.fixture;
    vi.spyOn(calendarClock, "now").mockReturnValue(new Date("2026-11-30T22:15:00Z"));
    await posting("20", { currency: "ZMW", date: "2026-11-30" });
    await posting("50", { currency: "ZMW", date: "2026-12-01" });
    await posting("100", { currency: "ZMW", date: "2026-12-02" });
    const currentMonth = { ...tools[3], args: {} };

    await db.update(households).set({ timeZone: "Africa/Lusaka" }).where(eq(households.id, householdId));
    expect(await payload(tools[0], member)).toMatchObject({ total: "70.00" });
    expect(await payload(tools[1], member)).toMatchObject({ merchants: [{ totalSpent: "70.00" }] });
    expect(await payload(tools[2], member)).toMatchObject({
      trends: [{ points: [{ month: "2026-11", amount: "20.00" }, { month: "2026-12", amount: "50.00" }] }],
    });
    const december = await payload(currentMonth, member);
    expect(december).toMatchObject({ month: "2026-12", expenses: "50.00" });
    expect(await payload({ ...currentMonth, args: { month: "2026-12" } }, member)).toEqual(december);

    await db.update(households).set({ timeZone: null }).where(eq(households.id, householdId));
    expect(await payload(tools[0], member)).toMatchObject({ total: "20.00" });
    expect(await payload(currentMonth, member)).toMatchObject({ month: "2026-11", expenses: "20.00" });
  });
});
