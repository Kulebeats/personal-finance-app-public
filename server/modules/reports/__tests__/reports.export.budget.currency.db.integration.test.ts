/**
 * Reports budget CSV export — currency correctness (real DB)
 *
 * Regression test for the hardcoded "ZMW" leak in
 * `CashflowBudgetComparisonRepository.getBudgetsForComparison`. Exercises the
 * real `reportsExportService.generateExportFile(... reportType: "budget" ...)`
 * path against a real Postgres test database for a USD household, and asserts:
 *   - the CSV `currency` column is the household currency (USD), and
 *   - NO "Money currency mismatch" warning is logged during aggregation.
 *
 * Run against the test DB ONLY (never finance_app):
 *   DATABASE_URL=...finance_app_test npx vitest run \
 *     --config server/vitest.config.ts \
 *     server/modules/reports/__tests__/reports.export.budget.currency.db.integration.test.ts
 *
 * @module modules/reports/__tests__/reports.export.budget.currency.db.integration
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import {
  households,
  categoryGroups,
  categories,
  accounts,
  budgets,
  transactions,
} from "@shared/schema";
import { reportsExportService } from "../reports.export.service";
import { logger } from "../../../utils/logger";
import type { ExportReportInput } from "../reports.validation";

describe("Reports budget export — currency correctness (real DB)", () => {
  const householdId = randomUUID();
  const userId = randomUUID();
  const accountId = randomUUID();
  const groupId = randomUUID();
  const categoryId = randomUUID();
  const budgetId = randomUUID();

  beforeAll(async () => {
    // USD household — the bug only manifests for non-ZMW households.
    await db.insert(households).values({
      id: householdId,
      name: "USD Export Test Household",
      currency: "USD",
    });

    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "USD Checking",
      type: "checking",
      balance: "10000.00",
      currency: "USD",
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

    // Budget row deliberately stored without forcing a currency column value —
    // the repository must derive the comparison currency from the household.
    await db.insert(budgets).values({
      id: budgetId,
      householdId,
      name: "Groceries Budget",
      categoryId,
      amount: "500.00",
      period: "monthly",
      isActive: true,
    });

    // Two USD expense transactions in January 2026 (total 400.00).
    // ownerUserId is null (non-private) so the report includes them without
    // requiring a seeded user row.
    await db.insert(transactions).values([
      {
        id: randomUUID(),
        householdId,
        accountId,
        ownerUserId: null,
        name: "Shoprite",
        amount: "250.00",
        currency: "USD",
        type: "expense",
        date: "2026-01-10",
        categoryId,
        isPrivate: false,
        isPending: false,
        isExcludedFromReports: false,
      },
      {
        id: randomUUID(),
        householdId,
        accountId,
        ownerUserId: null,
        name: "Pick n Pay",
        amount: "150.00",
        currency: "USD",
        type: "expense",
        date: "2026-01-20",
        categoryId,
        isPrivate: false,
        isPending: false,
        isExcludedFromReports: false,
      },
    ]);
  });

  afterAll(async () => {
    try {
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      await db.delete(budgets).where(eq(budgets.householdId, householdId));
      await db.delete(categories).where(eq(categories.householdId, householdId));
      await db
        .delete(categoryGroups)
        .where(eq(categoryGroups.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      console.error("Cleanup error (ignored):", error);
    }
  });

  it("labels the budget CSV with the household currency and logs no currency mismatch", async () => {
    const warnSpy = vi.spyOn(logger, "warn");

    const input: ExportReportInput = {
      reportType: "budget",
      format: "csv",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      includeCharts: false,
      includeForecast: false,
      forecastMonths: 3,
      interval: "month",
    };

    const { content, fileName } = await reportsExportService.generateExportFile(
      householdId,
      userId,
      "household",
      input,
    );

    expect(fileName).toBe("budget_comparison_2026-01-01_2026-01-31.csv");

    // The Groceries row is present and labeled USD (not the ZMW default).
    expect(content).toContain("Groceries");
    expect(content).toContain("USD");
    expect(content).not.toContain("ZMW");

    // Find the Groceries data row and confirm its currency column is USD.
    const lines = content.trim().split(/\r?\n/);
    const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, ""));
    const currencyIdx = headers.indexOf("currency");
    expect(currencyIdx).toBeGreaterThanOrEqual(0);

    const groceriesLine = lines.find((l) => l.includes("Groceries"));
    expect(groceriesLine).toBeDefined();
    const cells = groceriesLine!
      .split(",")
      .map((c) => c.replace(/^"|"$/g, ""));
    expect(cells[currencyIdx]).toBe("USD");

    // No "Money currency mismatch" warning was emitted during aggregation.
    const mismatchWarnings = warnSpy.mock.calls.filter(([msg]) =>
      String(msg).includes("currency mismatch"),
    );
    expect(mismatchWarnings).toEqual([]);

    warnSpy.mockRestore();
  });
});
