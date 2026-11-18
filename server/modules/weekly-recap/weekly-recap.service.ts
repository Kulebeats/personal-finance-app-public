/**
 * Weekly Recap Module - Service
 *
 * Fetches and aggregates weekly recap data from analytics and recurring services.
 *
 * @module modules/weekly-recap/service
 */

import { analyticsService } from "../../services/AnalyticsService";
import { recurringService } from "../../services/RecurringService";
import { logger } from "../../utils/logger";
import { Money } from "../../core/money";
import type { MoneyDto } from "@shared/money";
import type { RecurringTransaction } from "@shared/schema";
import type { ReportsSpendingBreakdownResponse } from "@shared/reports";
import type {
  WeeklyRecapData,
  SpendingData,
  NetWorthData,
  RecurringData,
  TrendDirection,
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

// Internal type for Money-based calculations
interface NetWorthDataInternal {
  current: Money;
  series: Array<{ date: string; value: number }>;
}

// Re-export for external use
export type { WeeklyRecapData as WeeklyRecap };

/**
 * Helper to calculate trend direction from change values.
 */
function calculateTrend(change: number): TrendDirection {
  if (change > 0.5) return "up";
  if (change < -0.5) return "down";
  return "steady";
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
    // Calculate previous week for comparison
    const fromDate = new Date(from);
    const prevWeekStart = new Date(fromDate);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const prevWeekEnd = new Date(fromDate);
    prevWeekEnd.setDate(prevWeekEnd.getDate() - 1);
    const prevFrom = prevWeekStart.toISOString().split("T")[0];
    const prevTo = prevWeekEnd.toISOString().split("T")[0];

    // Fetch all data in parallel
    const [
      netWorthData,
      prevNetWorthData,
      spendingData,
      prevSpendingData,
      upcomingBills,
    ] = await Promise.all([
      this.getNetWorthInternal(householdId, userId, from, to),
      this.getNetWorthInternal(householdId, userId, prevFrom, prevTo),
      this.getSpendingInternal(householdId, userId, from, to),
      this.getSpendingInternal(householdId, userId, prevFrom, prevTo),
      this.getUpcomingRecurring(householdId, from, to),
    ]);

    // Calculate net worth change using Money class for precision
    const currentNetWorth = netWorthData.current;
    const previousNetWorth = prevNetWorthData.current;
    const netWorthChange = currentNetWorth.subtract(previousNetWorth);

    // Calculate percentage change using Money for safe comparison
    // FIX Money Rule 1: Keep Money through calculation
    let netWorthChangePercent = 0;
    if (!previousNetWorth.isZero()) {
      // Keep Money through calculation, convert only at final step
      netWorthChangePercent = netWorthChange
        .divide(previousNetWorth.abs().toString())
        .multiply("100")
        .toNumber();
    }

    // Calculate spending change percentage
    let spendingChangePercent = 0;
    if (prevSpendingData.total > 0) {
      spendingChangePercent =
        ((spendingData.total - prevSpendingData.total) /
          prevSpendingData.total) *
        100;
    }

    // Build net worth response with trend (CONTRACT-005 fix)
    const netWorthResponse: NetWorthData = {
      current: currentNetWorth.toNumber(),
      previous: previousNetWorth.toNumber(),
      change: netWorthChange.toNumber(),
      changePercent: Number(netWorthChangePercent.toFixed(2)),
      series: netWorthData.series,
      trend: calculateTrend(netWorthChangePercent),
    };

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

    return {
      weekStart: from,
      weekEnd: to,
      netWorth: netWorthResponse,
      spending: spendingResponse,
      recurring: upcomingBills,
    };
  }

  /**
   * Get net worth data for a date range (internal version returning Money)
   */
  private async getNetWorthInternal(
    householdId: string,
    userId: string,
    from: string,
    to: string
  ): Promise<NetWorthDataInternal> {
    try {
      const result = await analyticsService.getNetWorth(householdId, userId, {
        from,
        to,
      });

      // Extract current value from latest using Money class
      const current = toMoney(result.latest?.netWorth);

      // Extract series data - flatten the nested data structure
      // Series data is for display only, so toNumber() is acceptable here
      const series = (result.series || [])
        .flatMap((s) =>
          (s.data || []).map((d) => ({
            date: d.x,
            value: toMoney(d.y).toNumber(),
          }))
        );

      return {
        current,
        series,
      };
    } catch (error) {
      logger.warn("Failed to fetch net worth for weekly recap", { error });
      return { current: Money.zero(), series: [] };
    }
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
      logger.warn("Failed to fetch spending for weekly recap", { error });
      return { total: 0, categories: [] };
    }
  }

  /**
   * Get upcoming recurring transactions
   */
  private async getUpcomingRecurring(
    householdId: string,
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
        householdId,
        Math.max(7, daysAhead)
      );

      // Filter to only those within the week
      const filtered = upcoming.filter((bill: RecurringTransaction) => {
        const billDate = bill.nextDueDate;
        return billDate >= from && billDate <= to;
      });

      const totalAmountMoney = sumAmounts(
        filtered.map((bill: RecurringTransaction) => bill.amount || "0")
      );

      return {
        // CONTRACT-003: Use "dueDate" instead of "date"
        // CONTRACT-004: Convert amount to number instead of string
        upcoming: filtered.map((bill: RecurringTransaction) => ({
          id: bill.id,
          name: bill.name,
          amount: toMoney(bill.amount).toNumber(), // Convert to number
          dueDate: bill.nextDueDate, // Renamed from "date" to "dueDate"
          frequency: bill.frequency,
        })),
        count: filtered.length,
        totalAmount: totalAmountMoney.toNumber(),
      };
    } catch (error) {
      logger.warn("Failed to fetch upcoming recurring for weekly recap", {
        error,
      });
      return { upcoming: [], count: 0, totalAmount: 0 };
    }
  }
}

export const weeklyRecapService = new WeeklyRecapService();
