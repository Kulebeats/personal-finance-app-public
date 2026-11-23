/**
 * Report SQL aggregation — FX fail-closed guard (real DB)
 *
 * Regression tests for the silent `COALESCE((SELECT rate ...), 1)` fallback in
 * `buildFxRateExpr`: when a transaction currency has no FX rate to the
 * household base currency, report SQL aggregates silently converted at rate 1,
 * corrupting totals. The fix is a pre-aggregation guard
 * (`BaseReportRepository.assertFxRatesAvailable`) that fails closed with the
 * SCP-321-style "Exchange rate unavailable" error before the aggregate runs.
 *
 * One describe per SQL-aggregating repository family:
 *   - CashflowReportRepository.getCashflow
 *   - SpendingReportRepository.getSpendingBreakdown
 *   - TransactionReportRepository.getTransactions
 *   - CashflowBudgetComparisonRepository.getSpendingByCategory
 *   - CompositeReportRepository.getSankey (SankeyLinks builders)
 *
 * Each family asserts BOTH sides:
 *   - missing rate  → the report throws (never a rate-1 total), and
 *   - seeded rate   → the report converts correctly to the cent.
 *
 * FX tables are GLOBAL, so the two sides use different currencies to
 * avoid defeating each other: TZS (no rate seeded anywhere) for the
 * fail-closed household, MWK (rate seeded here) for the conversion household.
 * Budget comparison requires a provider quote covering the expense date;
 * the other report families use the legacy fx_rates fixture.
 *
 * Run against the test DB ONLY (never finance_app):
 *   DATABASE_URL=...finance_app_test npx vitest run \
 *     --config server/vitest.config.ts \
 *     server/repositories/reports/__tests__/ReportRepositories.fxfailclosed.db.integration.test.ts
 *
 * Modeled on reports.export.budget.currency.db.integration.test.ts.
 *
 * @module repositories/reports/__tests__/ReportRepositories.fxfailclosed.db.integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import {
  households,
  categoryGroups,
  categories,
  accounts,
  transactions,
  fxRates,
  householdMembers,
  providerFxQuotes,
  users,
} from "@shared/schema";
import { CashflowReportRepository } from "../CashflowReportRepository";
import { CashflowBudgetComparisonRepository } from "../CashflowBudgetComparisonRepository";
import { SpendingReportRepository } from "../SpendingReportRepository";
import { TransactionReportRepository } from "../TransactionReportRepository";
import { CompositeReportRepository } from "../CompositeReportRepository";

const FROM = "2026-01-01";
const TO = "2026-01-31";
// Budget comparison requires a persisted reader membership, even for shared rows.
const USER_ID = randomUUID();
const OUTSIDER_USER_ID = randomUUID();
const PROVIDER_QUOTE_ID = randomUUID();
// Currency of the household that has NO rate row → reports must fail closed.
const UNRATED_CURRENCY = "TZS";
// Currency of the household whose rate IS seeded → reports must convert.
const RATED_CURRENCY = "MWK";
const MISSING_RATE_ERROR = /Exchange rate unavailable for TZS -> USD/;

/** Seeds a USD household holding foreign-currency transactions. */
async function seedHousehold(
  name: string,
  currency: string,
  options: { hideTransactions?: boolean } = {},
) {
  const householdId = randomUUID();
  const accountId = randomUUID();
  const groupId = randomUUID();
  const categoryId = randomUUID();

  await db.insert(households).values({
    id: householdId,
    name,
    currency: "USD",
  });

  await db.insert(householdMembers).values({
    householdId,
    userId: USER_ID,
    role: "member",
  });

  await db.insert(accounts).values({
    id: accountId,
    householdId,
    name: `${currency} Checking`,
    type: "checking",
    balance: "10000.00",
    currency,
    hideTransactions: options.hideTransactions ?? false,
  });

  await db.insert(categoryGroups).values({
    id: groupId,
    householdId,
    name: "Expenses",
    type: "expenses",
    isArchived: false,
    displayOrder: 0,
  });

  await db.insert(categories).values({
    id: categoryId,
    householdId,
    groupId,
    name: "Groceries",
    icon: "cart",
    color: "#00AA55",
    isArchived: false,
    displayOrder: 0,
  });

  // One shared foreign-currency income and expense in January 2026, readable
  // by the seeded household member.
  await db.insert(transactions).values([
    {
      id: randomUUID(),
      householdId,
      accountId,
      ownerUserId: null,
      name: "Salary",
      amount: "1000.00",
      currency,
      type: "income",
      date: "2026-01-10",
      categoryId: null,
      isPrivate: false,
      isPending: false,
      isExcludedFromReports: false,
    },
    {
      id: randomUUID(),
      householdId,
      accountId,
      ownerUserId: null,
      name: "Shoprite",
      amount: "500.00",
      currency,
      type: "expense",
      date: "2026-01-15",
      categoryId,
      isPrivate: false,
      isPending: false,
      isExcludedFromReports: false,
    },
  ]);

  return { householdId, accountId, groupId, categoryId };
}

async function cleanupHousehold(householdId: string) {
  try {
    await db
      .delete(transactions)
      .where(eq(transactions.householdId, householdId));
    await db.delete(categories).where(eq(categories.householdId, householdId));
    await db
      .delete(categoryGroups)
      .where(eq(categoryGroups.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
  } catch (error) {
    console.error("Cleanup error (ignored):", error);
  }
}

/** Removes every rate row for a pair (residue from aborted prior runs too). */
function deleteRatePair(from: string, to: string) {
  return db
    .delete(fxRates)
    .where(and(eq(fxRates.fromCurrency, from), eq(fxRates.toCurrency, to)));
}

describe("Report SQL aggregation — FX fail-closed (real DB)", () => {
  // Household A: TZS transactions, NO TZS->USD rate → every report throws.
  let noRate: Awaited<ReturnType<typeof seedHousehold>>;
  // Household B: MWK transactions plus MWK->USD rate 0.045 → reports convert.
  let withRate: Awaited<ReturnType<typeof seedHousehold>>;
  // Household C: unrated TZS transactions in a hide_transactions account.
  // Aggregates that do NOT filter hidden accounts (category averages,
  // budget-comparison spending) still convert these rows, so their guard must
  // cover hidden accounts too. The expense classification reads visible
  // accounts only (A-24), so these rows must not block it.
  let hiddenNoRate: Awaited<ReturnType<typeof seedHousehold>>;

  const cashflowRepo = new CashflowReportRepository();
  const spendingRepo = new SpendingReportRepository();
  const transactionRepo = new TransactionReportRepository();
  const budgetComparisonRepo = new CashflowBudgetComparisonRepository();
  const compositeRepo = new CompositeReportRepository();

  beforeAll(async () => {
    await db.insert(users).values([USER_ID, OUTSIDER_USER_ID].map((id) => ({
      id,
      username: `report-fx-${id}`,
      email: `report-fx-${id}@example.com`,
      passwordHash: "repository-fixture-no-login",
      emailVerified: true,
    })));

    // Deterministic reruns: clear any residue for the pairs this suite owns.
    await deleteRatePair(UNRATED_CURRENCY, "USD");
    await deleteRatePair(RATED_CURRENCY, "USD");

    noRate = await seedHousehold(
      "FX Fail-Closed (no rate)",
      UNRATED_CURRENCY,
    );
    withRate = await seedHousehold(
      "FX Fail-Closed (with rate)",
      RATED_CURRENCY,
    );
    hiddenNoRate = await seedHousehold(
      "FX Fail-Closed (hidden account, no rate)",
      UNRATED_CURRENCY,
      { hideTransactions: true },
    );

    // Rate dated on/before the earliest seeded transaction so the per-row
    // `fx.date <= t.date` lookup in buildFxRateExpr resolves for every row.
    await db.insert(fxRates).values({
      id: randomUUID(),
      fromCurrency: RATED_CURRENCY,
      toCurrency: "USD",
      rate: "0.0450",
      date: "2026-01-01",
      source: "manual",
    });

    // Budget comparison accepts dated provider evidence, not a manual rate.
    await db.insert(providerFxQuotes).values({
      id: PROVIDER_QUOTE_ID,
      fromCurrency: RATED_CURRENCY,
      toCurrency: "USD",
      provider: "exchangerate_api",
      quotedAt: new Date("2026-01-15T00:00:00Z"),
      effectiveDate: "2026-01-15",
      validThrough: "2026-01-15",
      rate: "0.0450",
    });
  });

  afterAll(async () => {
    await db.delete(providerFxQuotes).where(eq(providerFxQuotes.id, PROVIDER_QUOTE_ID));
    await deleteRatePair(RATED_CURRENCY, "USD");
    await cleanupHousehold(noRate.householdId);
    await cleanupHousehold(withRate.householdId);
    await cleanupHousehold(hiddenNoRate.householdId);
    await db.delete(users).where(eq(users.id, USER_ID));
    await db.delete(users).where(eq(users.id, OUTSIDER_USER_ID));
  });

  describe("CashflowReportRepository.getCashflow", () => {
    it("throws when a transaction currency has no rate to the base currency", async () => {
      await expect(
        cashflowRepo.getCashflow(noRate.householdId, {
          from: FROM,
          to: TO,
          userId: USER_ID,
          interval: "month",
        }),
      ).rejects.toThrow(MISSING_RATE_ERROR);
    });

    it("converts income and expenses at the seeded rate", async () => {
      const result = await cashflowRepo.getCashflow(withRate.householdId, {
        from: FROM,
        to: TO,
        userId: USER_ID,
        interval: "month",
      });

      // 1000.00 MWK * 0.045 = 45.00 USD; 500.00 MWK * 0.045 = 22.50 USD.
      // Under the old silent rate-1 fallback these would read 1000.00/500.00.
      expect(result.totals.income.amount).toBe("45.00");
      expect(result.totals.expenses.amount).toBe("22.50");
      expect(result.range.baseCurrency).toBe("USD");
    });
  });

  describe("SpendingReportRepository.getSpendingBreakdown", () => {
    it("throws when a transaction currency has no rate to the base currency", async () => {
      await expect(
        spendingRepo.getSpendingBreakdown(noRate.householdId, {
          from: FROM,
          to: TO,
          userId: USER_ID,
          groupBy: "category",
          type: "expense",
        }),
      ).rejects.toThrow(MISSING_RATE_ERROR);
    });

    it("converts the category breakdown at the seeded rate", async () => {
      const result = await spendingRepo.getSpendingBreakdown(
        withRate.householdId,
        {
          from: FROM,
          to: TO,
          userId: USER_ID,
          groupBy: "category",
          type: "expense",
        },
      );

      const groceries = result.items.find((i) => i.label === "Groceries");
      expect(groceries).toBeDefined();
      expect(groceries!.value.amount).toBe("22.50");
      expect(groceries!.value.currency).toBe("USD");
    });
  });

  describe("TransactionReportRepository.getTransactions", () => {
    it("throws when a transaction currency has no rate to the base currency", async () => {
      await expect(
        transactionRepo.getTransactions(noRate.householdId, {
          from: FROM,
          to: TO,
          userId: USER_ID,
          sort: "date_desc",
          limit: 50,
        }),
      ).rejects.toThrow(MISSING_RATE_ERROR);
    });

    it("returns per-row base amounts converted at the seeded rate", async () => {
      const result = await transactionRepo.getTransactions(
        withRate.householdId,
        {
          from: FROM,
          to: TO,
          userId: USER_ID,
          sort: "date_desc",
          limit: 50,
        },
      );

      expect(result.items).toHaveLength(2);
      const expense = result.items.find((i) => i.name === "Shoprite");
      const income = result.items.find((i) => i.name === "Salary");
      expect(expense!.amountBase.amount).toBe("22.50");
      expect(expense!.amountBase.currency).toBe("USD");
      expect(income!.amountBase.amount).toBe("45.00");
    });
  });

  describe("CashflowBudgetComparisonRepository.getSpendingByCategory", () => {
    it("rejects a member's missing conversion with FINANCIAL_DATA_UNAVAILABLE", async () => {
      await expect(
        budgetComparisonRepo.getSpendingByCategory(noRate.householdId, {
          from: FROM,
          to: TO,
          userId: USER_ID,
        }),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "FINANCIAL_DATA_UNAVAILABLE",
      });
    });

    it("denies a seeded user without household membership", async () => {
      await expect(
        budgetComparisonRepo.getSpendingByCategory(withRate.householdId, {
          from: FROM,
          to: TO,
          userId: OUTSIDER_USER_ID,
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });
    });

    it("converts per-category spending at the dated provider quote", async () => {
      const result = await budgetComparisonRepo.getSpendingByCategory(
        withRate.householdId,
        {
          from: FROM,
          to: TO,
          userId: USER_ID,
        },
      );

      const groceries = result.find(
        (r) => r.categoryId === withRate.categoryId,
      );
      expect(groceries).toBeDefined();
      expect(groceries!.amount).toBe("22.50");
      expect(groceries!.currency).toBe("USD");
    });
  });

  describe("CashflowReportRepository.getExpenseClassification", () => {
    // Both reads behind this figure (the category breakdown and the monthly
    // series) filter hide_transactions, so the guard checks visible rows only.
    it("throws for an unrated currency on an expense the figure includes", async () => {
      await expect(
        cashflowRepo.getExpenseClassification(noRate.householdId, {
          from: FROM,
          to: TO,
          userId: USER_ID,
        }),
      ).rejects.toThrow(MISSING_RATE_ERROR);
    });

    it("leaves an unrated hidden-account expense out instead of failing (A-24)", async () => {
      const result = await cashflowRepo.getExpenseClassification(hiddenNoRate.householdId, {
        from: FROM,
        to: TO,
        userId: USER_ID,
      });
      expect(result.total.currency).toBe("USD");
      expect(result.total.amount).toMatch(/^0(\.0+)?$/);
      expect(result.accuracy.totalCategories).toBe(0);
    });
  });

  describe("aggregates that include hidden accounts", () => {
    // These queries have no hide_transactions filter, so their guard must
    // cover hidden-account currencies too (reviewer-flagged false negative).
    it("getSpendingByCategory throws for an unrated currency in a hidden account", async () => {
      await expect(
        budgetComparisonRepo.getSpendingByCategory(hiddenNoRate.householdId, {
          from: FROM,
          to: TO,
          userId: USER_ID,
        }),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "FINANCIAL_DATA_UNAVAILABLE",
      });
    });
  });

  describe("CompositeReportRepository.getSankey", () => {
    it("throws when a transaction currency has no rate to the base currency", async () => {
      await expect(
        compositeRepo.getSankey(noRate.householdId, {
          from: FROM,
          to: TO,
          userId: USER_ID,
          mode: "income_to_expense_groups",
          maxNodes: 10,
        }),
      ).rejects.toThrow(MISSING_RATE_ERROR);
    });

    it("converts sankey totals and links at the seeded rate", async () => {
      const result = await compositeRepo.getSankey(withRate.householdId, {
        from: FROM,
        to: TO,
        userId: USER_ID,
        mode: "income_to_expense_groups",
        maxNodes: 10,
      });

      expect(result.totals.income.amount).toBe("45.00");
      expect(result.totals.expenses.amount).toBe("22.50");

      const expenseLink = result.sankey.links.find(
        (l) => l.target === `categoryGroup:${withRate.groupId}`,
      );
      expect(expenseLink).toBeDefined();
      expect(expenseLink!.value.amount).toBe("22.50");
    });
  });
});
