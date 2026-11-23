/**
 * Weekly Recap Module - Service
 *
 * Fetches and aggregates weekly recap data from analytics and recurring services.
 *
 * @module modules/weekly-recap/service
 */

import { analyticsService } from "../../services/AnalyticsService";
import { recurringService } from "../../services/RecurringService";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { can } from "../../core/authz/capabilities";
import { ForbiddenError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { logger } from "../../utils/logger";
import { Money } from "../../core/money";
import type { MoneyDto } from "@shared/money";
import type { RecurringTransaction } from "@shared/schema";
import type { ReportsSpendingBreakdownResponse } from "@shared/reports";
import { readRecipientWorth } from "./recap-worth.reader";
import { addDays } from "./recap-week";
import { getWeeklyRecapSettings } from "../../repositories/UserDisplayPreferences";
import type {
  WeeklyRecapData,
  SpendingData,
  RecurringData,
  CategorySpending,
  UpcomingRecurring,
} from "@shared/weekly-recap";

// Type for spending breakdown item
type SpendingBreakdownItem = ReportsSpendingBreakdownResponse["items"][number];

/**
 * Convert MoneyDto/string/number to Money for safe arithmetic.
 * Returns the Money object for calculations, or zero if invalid.
 */
const toMoney = (
  value: MoneyDto | number | string | null | undefined,
  currency: string = "ZMW"
): Money => {
  if (value === null || value === undefined) return Money.zero(currency);
  if (typeof value === "object") {
    try {
      return new Money(value.amount || "0", value.currency || currency);
    } catch {
      return Money.zero(currency);
    }
  }
  try {
    return new Money(String(value), currency);
  } catch {
    return Money.zero(currency);
  }
};

/**
 * Safely sum an array of amount strings using Money class.
 * Returns the sum as a Money object to preserve precision.
 */
const sumAmounts = (amounts: string[], currency = "ZMW"): Money => {
  return amounts.reduce((sum, amt) => {
    const money = new Money(amt || "0", currency).abs();
    return sum.add(money);
  }, Money.zero(currency));
};

function formatRecurringBills(rules: RecurringTransaction[]): RecurringData {
  const totalAmountMoney = sumAmounts(
    rules.map(bill => bill.amount || "0")
  );

  return {
    // CONTRACT-003: Use "dueDate" instead of "date"
    // CONTRACT-004: Convert amount to number instead of string
    upcoming: rules.map(bill => ({
      id: bill.id,
      name: bill.name,
      amount: toMoney(bill.amount).toNumber(), // Convert to number
      dueDate: bill.nextDueDate, // Renamed from "date" to "dueDate"
      frequency: bill.frequency,
    })),
    count: rules.length,
    totalAmount: totalAmountMoney.toNumber(),
  };
}

// Re-export for external use
export type { WeeklyRecapData as WeeklyRecap };

/** Check the same explicit recipient before projection and at publication. */
export async function requireRecapRecipient(householdId: string, userId: string): Promise<HouseholdContext> {
  const membership = await householdRepository.findMember(householdId, userId);
  if (!membership || !can(membership.role, "financial.read")) {
    throw new ForbiddenError("Weekly recap access denied");
  }
  return { householdId, userId, role: membership.role };
}

class WeeklyRecapService {
  /**
   * Get complete weekly recap data
   */
  async getRecap(
    householdId: string,
    userId: string,
    from: string,
    to: string
  ): Promise<WeeklyRecapData> {
    const recipient = await requireRecapRecipient(householdId, userId);
    // OPS-007: the saved toggles decide which sections this recap holds.
    const settings = await getWeeklyRecapSettings(userId);
    const sections = { goals: settings.includeGoals, recurring: settings.includeRecurring };

    // The comparison week is the seven dates before this one (NEW-31).
    const prevFrom = addDays(from, -7);
    const prevTo = addDays(from, -1);

    // Fetch all data in parallel
    const [
      spendingData,
      prevSpendingData,
      upcomingBills,
    ] = await Promise.all([
      this.getSpendingInternal(householdId, userId, from, to),
      this.getSpendingInternal(householdId, userId, prevFrom, prevTo),
      sections.recurring ? this.getUpcomingRecurring(recipient, from, to) : formatRecurringBills([]),
    ]);

    // Calculate spending change percentage
    let spendingChangePercent = 0;
    if (prevSpendingData.total > 0) {
      spendingChangePercent =
        ((spendingData.total - prevSpendingData.total) /
          prevSpendingData.total) *
        100;
    }

    // Build spending response with aligned field names (CONTRACT-001, CONTRACT-002, CONTRACT-005)
    const spendingResponse: SpendingData = {
      total: spendingData.total,
      // CONTRACT-001: Use "topCategories" instead of "categories"
      // CONTRACT-002: Use "name" instead of "categoryName"
      topCategories: spendingData.categories.map((cat) => ({
        categoryId: cat.categoryId,
        name: cat.categoryName, // Renamed from categoryName to name
        amount: cat.amount,
        percent: cat.percent,
      })),
      // CONTRACT-005: Add hasData field
      hasData: spendingData.categories.length > 0 || spendingData.total > 0,
      changePercent: Number(spendingChangePercent.toFixed(2)),
      // CONTRACT-005: Add trend data (empty for now, could be populated from daily data)
      trend: [],
    };

    await requireRecapRecipient(householdId, userId);
    // Run after other assembly: both periods share the current account audience.
    const netWorthResponse = await readRecipientWorth(householdId, userId, from, to);
    return {
      weekStart: from,
      weekEnd: to,
      netWorth: netWorthResponse,
      spending: spendingResponse,
      recurring: upcomingBills,
      sections,
    };
  }

  // Internal type for spending data before transformation
  private readonly emptySpendingInternal = {
    total: 0,
    categories: [] as Array<{
      categoryId: string;
      categoryName: string;
      amount: number;
      percent: number;
    }>,
  };

  /**
   * Get spending breakdown for a date range (internal version)
   * Returns raw data that will be transformed in getRecap
   */
  private async getSpendingInternal(
    householdId: string,
    userId: string,
    from: string,
    to: string
  ): Promise<{
    total: number;
    categories: Array<{
      categoryId: string;
      categoryName: string;
      amount: number;
      percent: number;
    }>;
  }> {
    try {
      const result = await analyticsService.getSpendingBreakdown(
        householdId,
        userId,
        { from, to, groupBy: "category" }
      );

      // Convert to Money first, then to number for display
      const categories = (result.items || [])
        .slice(0, 5) // Top 5 categories
        .map((item: SpendingBreakdownItem) => ({
          categoryId: item.entityId || item.id,
          categoryName: item.label,
          amount: toMoney(item.value).toNumber(),
          percent: Number(item.percent || 0),
        }));

      const total = toMoney(result.total).toNumber();

      return { total, categories };
    } catch (error) {
      // OPS-006: never report a spending total of 0 for a week whose spending
      // could not be read. A missing rate reaches the error handler as the
      // 422 MISSING_FX_RATE answer, exactly as the emailed digest refuses.
      logger.warn("Failed to fetch spending for weekly recap", { error });
      throw error;
    }
  }

  /**
   * Get upcoming recurring transactions
   */
  private async getUpcomingRecurring(
    recipient: HouseholdContext,
    from: string,
    to: string
  ): Promise<RecurringData> {
    try {
      // Calculate days from now to end of week
      const endDate = new Date(to);
      const now = new Date();
      const daysAhead = Math.ceil(
        (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      const upcoming = await recurringService.getUpcomingBills(
        recipient,
        Math.max(7, daysAhead)
      );

      // Filter to only those within the week
      const filtered = upcoming.filter((bill: RecurringTransaction) => {
        const billDate = bill.nextDueDate;
        return billDate >= from && billDate <= to;
      });

      return formatRecurringBills(filtered);
    } catch (error) {
      logger.warn("Failed to fetch upcoming recurring for weekly recap", {
        error,
      });
      throw error;
    }
  }
}

export const weeklyRecapService = new WeeklyRecapService();
