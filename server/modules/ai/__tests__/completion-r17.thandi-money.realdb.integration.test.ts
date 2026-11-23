/**
 * Astra A-07 and A-40, real Postgres through Thandi's analytics reader.
 *
 * A-07: an account's balance is in its own currency. A CHF account in a ZMW
 * household is reported as CHF, printed as CHF by the local summary, and only
 * added into the household's projected balance at a trusted same-day rate.
 * With no rate the projected balance is unknown, never a raw sum.
 *
 * A-40: the cash-flow projection counts a recurring rule by its frequency, as
 * the product forecast does: a weekly ZMW 100 bill is about ZMW 433 a month
 * and a yearly ZMW 1,200 bill ZMW 100 a month.
 *
 * The owner sees two ZMW accounts: ZMW 988.89 + ZMW 4,222.23 = ZMW 5,211.12.
 * The fixture's own recurring rule is removed so each test sets its rules.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, households, providerFxQuotes, recurringTransactions } from "@shared/schema";
import { db } from "../../../db";
import { recordRecurringDenomination } from "../../../services/recurring/RecurringDenomination";
import { AIAnalyticsService } from "../ai.analytics.service";
import { renderLocalSummary } from "../ai.local-templates";
import { sanitizeToolResult } from "../ai.sanitizer";
import type { QueryContext } from "../ai.types";
import { startR17Harness, stopR17Harness, type R17Harness } from "./completion-r17.realdb.fixture";

let harness: R17Harness;
const quoteIds: string[] = [];
const analytics = new AIAnalyticsService();
const OWNER_ZMW_TOTAL = "5211.12";

function ownerContext(currency = "ZMW"): QueryContext {
  const { fixture } = harness;
  return {
    userId: fixture.owner.id,
    householdId: fixture.householdId,
    currency,
    actor: { householdId: fixture.householdId, userId: fixture.owner.id, role: "owner" },
  };
}

async function addAccount(currency: string, balance: string): Promise<string> {
  const id = randomUUID();
  const { fixture } = harness;
  await db.insert(accounts).values({
    id, householdId: fixture.householdId, name: `A07 ${currency} account`, type: "checking",
    currency, balance, isPrivate: false, ownerUserId: fixture.owner.id,
  });
  return id;
}

/** A trusted same-day provider quote, as the account summary reads them. */
async function quoteToday(from: string, rate: string, to = "ZMW"): Promise<void> {
  const id = randomUUID();
  quoteIds.push(id);
  const today = new Date().toISOString().slice(0, 10);
  await db.insert(providerFxQuotes).values({
    id, fromCurrency: from, toCurrency: to, provider: "yahoo_finance",
    // Quoted earlier today (UTC), never in the future.
    quotedAt: new Date(Math.max(Date.parse(`${today}T00:00:00Z`), Date.now() - 60_000)), effectiveDate: today, validThrough: today, rate,
  });
}

async function startWithoutRules(): Promise<R17Harness> {
  const started = await startR17Harness();
  await db.delete(recurringTransactions).where(eq(recurringTransactions.householdId, started.fixture.householdId));
  return started;
}

async function addRule(params: { amount: string; frequency: "weekly" | "yearly"; verifiedZmw?: boolean;
  type?: "transfer"; isActive?: boolean; isPaused?: boolean; nextDueDate?: string; endDate?: string }) {
  const { fixture } = harness;
  const id = randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  await db.transaction(async tx => {
    const [rule] = await tx.insert(recurringTransactions).values({
      id, householdId: fixture.householdId, accountId: fixture.sharedAccountId, name: `A40 ${params.frequency}`,
      amount: params.amount, type: params.type ?? "expense", frequency: params.frequency,
      startDate: today, nextDueDate: params.nextDueDate ?? today, detectionMethod: "manual",
      isActive: params.isActive, isPaused: params.isPaused, endDate: params.endDate,
    }).returning();
    if (params.verifiedZmw) await recordRecurringDenomination(tx, rule, "ZMW", fixture.owner.id, "manual_creation");
  });
}

async function stopWithQuotes() {
  if (quoteIds.length) await db.delete(providerFxQuotes).where(inArray(providerFxQuotes.id, quoteIds.splice(0)));
  await stopR17Harness(harness);
}

describe("Astra A-07: balances keep their own currency (real Postgres)", () => {
  beforeEach(async () => {
    harness = await startWithoutRules();
  });

  afterEach(stopWithQuotes);

  it("reports a CHF account in a ZMW household as CHF, and the local summary prints CHF", async () => {
    const accountId = await addAccount("CHF", "100.00");

    const balances = await analytics.getAccountBalances(ownerContext());

    const chf = balances.find((account) => account.accountId === accountId);
    expect(chf).toMatchObject({ currency: "CHF" });
    expect(chf?.balance.currency).toBe("CHF");
    expect(chf?.balance.toString()).toBe("100.00");
    const sanitised = sanitizeToolResult("get_account_balances", balances, "ZMW").data;
    const local = renderLocalSummary([sanitised], "ZMW") ?? "";
    expect(local).toContain("CHF 100.00");
    expect(local).not.toContain("ZMW 100.00");
  });

  it("shows the projected balance as unavailable, never zero or a raw sum, when a foreign account has no trusted rate today", async () => {
    await addAccount("CHF", "100.00");

    const projection = await analytics.getCashFlow(ownerContext(), 1);

    expect(projection).toHaveLength(1);
    expect(projection[0].projectedEndingBalance).toBeNull();
    // The tool output a provider sees names the figure as missing.
    const sanitised = sanitizeToolResult("get_cash_flow", projection, "ZMW").data as { projections: Array<Record<string, unknown>> };
    expect(sanitised.projections).toHaveLength(1);
    expect(sanitised.projections[0]).toHaveProperty("projectedEndingBalance", null);
    // The local summary says so in words.
    const local = renderLocalSummary([sanitised], "ZMW") ?? "";
    expect(local).toContain("balance unavailable");
    expect(local).not.toMatch(/balance ZMW/);
  });

  it("adds a foreign account into the projected balance at today's trusted rate", async () => {
    await addAccount("CHF", "100.00");
    await quoteToday("CHF", "25");

    const projection = await analytics.getCashFlow(ownerContext(), 1);

    // ZMW 5,211.12 + CHF 100 x 25, with no recurring rules.
    expect(projection[0].projectedEndingBalance?.currency).toBe("ZMW");
    expect(projection[0].projectedEndingBalance?.toString()).toBe("7711.12");
  });
});

describe("Astra A-40: recurring rules count by frequency (real Postgres)", () => {
  beforeEach(async () => {
    harness = await startWithoutRules();
  });

  afterEach(stopWithQuotes);

  it("counts a weekly ZMW 100 bill as about ZMW 433 a month", async () => {
    await addRule({ amount: "100.00", frequency: "weekly", verifiedZmw: true });

    const [month] = await analytics.getCashFlow(ownerContext(), 1);

    expect(month.outflow?.toString()).toBe("433.00");
    expect(month.projectedEndingBalance?.toString()).toBe("4778.12"); // 5,211.12 - 433.00
  });

  it("counts a yearly ZMW 1,200 bill as ZMW 100 a month", async () => {
    await addRule({ amount: "1200.00", frequency: "yearly", verifiedZmw: true });

    const months = await analytics.getCashFlow(ownerContext(), 2);

    expect(months.map((month) => month.outflow?.toString())).toEqual(["100.00", "100.00"]);
    expect(months[1].projectedEndingBalance?.toString()).toBe("5011.12"); // 5,211.12 - 2 x 100
  });

  it("values a verified ZMW rule in the household's other currency", async () => {
    await db.update(households).set({ currency: "USD" }).where(eq(households.id, harness.fixture.householdId));
    await addRule({ amount: "100.00", frequency: "weekly", verifiedZmw: true });
    await quoteToday("ZMW", "0.04", "USD");

    const [month] = await analytics.getCashFlow(ownerContext("USD"), 1);
    expect(month.outflow?.currency).toBe("USD");
    expect(month.outflow?.toString()).toBe("17.32");
    expect(month.projectedEndingBalance?.toString()).toBe("191.12");
  });

  it("keeps a real zero when unproven rows are paused, inactive, expired, beyond the horizon, or transfers", async () => {
    const legacy = { amount: "863.27", frequency: "weekly" } as const;
    await addRule({ ...legacy, isPaused: true });
    await addRule({ ...legacy, isActive: false });
    await addRule({ ...legacy, endDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) });
    await addRule({ ...legacy, nextDueDate: new Date(Date.now() + 100 * 86_400_000).toISOString().slice(0, 10) });
    await addRule({ ...legacy, type: "transfer" });
    const [month] = await analytics.getCashFlow(ownerContext(), 1);
    expect([month.inflow, month.outflow, month.net, month.projectedEndingBalance].map(amount => amount?.toString()))
      .toEqual(["0.00", "0.00", "0.00", OWNER_ZMW_TOTAL]);
  });
});
