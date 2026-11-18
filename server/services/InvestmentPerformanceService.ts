import { db } from "../db";
import {
  accounts,
  accountBalanceSnapshots,
  investmentTransactions,
} from "@shared/schema";
import { eq, and, inArray, gte, asc } from "drizzle-orm";
import { subMonths, subYears, differenceInCalendarDays } from "date-fns";
import { Money } from "../core/money";

export type TimeFrame = "1M" | "3M" | "YTD" | "1Y" | "ALL";

interface PerformanceDataPoint {
  date: string;
  value: number;
  benchmark?: number; // Placeholder for now
  twrIndex?: number;
  twrReturnPercent?: number;
}

export class InvestmentPerformanceService {
  async gethistory(
    householdId: string,
    timeframe: TimeFrame = "1M"
  ): Promise<PerformanceDataPoint[]> {
    // 1. Get investment account IDs
    const investmentAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, householdId),
          eq(accounts.type, "investment")
        )
      );

    if (investmentAccounts.length === 0) {
      return [];
    }

    const accountIds = investmentAccounts.map((a) => a.id);

    // 2. Determine start date
    const now = new Date();
    let startDate: Date;

    switch (timeframe) {
      case "1M":
        startDate = subMonths(now, 1);
        break;
      case "3M":
        startDate = subMonths(now, 3);
        break;
      case "1Y":
        startDate = subYears(now, 1);
        break;
      case "YTD":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case "ALL":
        startDate = new Date(0);
        break; // Or sensible default
      default:
        startDate = subMonths(now, 1);
    }

    const startDateStr = startDate.toISOString().split("T")[0];

    // 3. Query snapshots
    const snapshots = await db
      .select({
        date: accountBalanceSnapshots.date,
        balance: accountBalanceSnapshots.balance,
      })
      .from(accountBalanceSnapshots)
      .where(
        and(
          inArray(accountBalanceSnapshots.accountId, accountIds),
          gte(accountBalanceSnapshots.date, startDateStr)
        )
      )
      .orderBy(asc(accountBalanceSnapshots.date));

    // 4. Group by date and sum
    const grouped = snapshots.reduce((acc, curr) => {
      const date = curr.date; // already YYYY-MM-DD usually? Schema says 'date'.
      // If date object, convert to string. Schema date is string usually in drizzle-orm pg?
      // Actually schema definition: date("date") which returns string.
      const val = new Money(curr.balance).toNumber();
      acc[date] = (acc[date] || 0) + val;
      return acc;
    }, {} as Record<string, number>);

    const series: PerformanceDataPoint[] = Object.entries(grouped)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({
        date,
        value,
      }));

    if (series.length === 0) {
      return series;
    }

    const cashFlowTypes: ("transfer_in" | "transfer_out")[] = ["transfer_in", "transfer_out"];
    const flows = await db
      .select({
        date: investmentTransactions.transactionDate,
        type: investmentTransactions.type,
        amount: investmentTransactions.amount,
        amountZmw: investmentTransactions.amountZmw,
      })
      .from(investmentTransactions)
      .where(
        and(
          inArray(investmentTransactions.accountId, accountIds),
          inArray(investmentTransactions.type, cashFlowTypes),
          gte(investmentTransactions.transactionDate, startDateStr)
        )
      );

    const flowMap = new Map<string, number>();
    for (const flow of flows) {
      const amount =
        flow.amountZmw !== null && flow.amountZmw !== undefined
          ? Number(flow.amountZmw)
          : Number(flow.amount);
      const signedAmount =
        flow.type === "transfer_out" ? -Math.abs(amount) : Math.abs(amount);
      const current = flowMap.get(flow.date) || 0;
      flowMap.set(flow.date, current + signedAmount);
    }

    let twrIndex = 100;
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1];
      const current = series[i];
      const periodDays = Math.max(
        1,
        differenceInCalendarDays(new Date(current.date), new Date(prev.date))
      );

      const flowEntries = Array.from(flowMap.entries()).filter(
        ([date]) => date > prev.date && date <= current.date
      );

      let netFlow = 0;
      let weightedFlow = 0;
      for (const [date, amount] of flowEntries) {
        const daysToEnd = differenceInCalendarDays(
          new Date(current.date),
          new Date(date)
        );
        const weight = periodDays > 0 ? daysToEnd / periodDays : 0;
        netFlow += amount;
        weightedFlow += amount * weight;
      }

      const denominator = prev.value + weightedFlow;
      const periodReturn =
        denominator !== 0
          ? (current.value - prev.value - netFlow) / denominator
          : 0;

      twrIndex *= 1 + periodReturn;
      current.twrIndex = Number(twrIndex.toFixed(4));
      current.twrReturnPercent = Number((twrIndex - 100).toFixed(4));
    }

    series[0].twrIndex = 100;
    series[0].twrReturnPercent = 0;

    return series;
  }
}

export const investmentPerformanceService = new InvestmentPerformanceService();
