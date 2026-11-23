/**
 * Net Worth Report Repository
 *
 * Handles net worth-related analytics:
 * - getNetWorth: net worth history (snapshot-first with fallback)
 * - getNetWorthChanges: monthly changes
 *
 * MIGRATION STATUS: Full implementation
 *
 * @module repositories/reports/NetWorthReportRepository
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { CalculationError } from "../../core/calculations/errors";
import { netWorthSnapshots } from "@shared/schema";
import { BaseReportRepository } from "./BaseReportRepository";
import type { ReportsNetWorthChangesResponse, ReportsNetWorthResponse } from "@shared/reports";
import { isCurrencyCode } from "@shared/denomination";
import { Money, toMoneyDto } from "../../core/money";
import type { ReportsNetWorthQuery } from "../../modules/reports/reports.validation";
import type { QueryWithUser } from "./types";
import { ForbiddenError } from "../../core/errors";
import { netWorthOf } from "../../core/money/wealth-totals";
import { readNetWorthTotals } from "../AccountSummaryRead";
import { readViewerSnapshots } from "./netWorthViewerSnapshots";
import { householdToday } from "../../services/householdCalendarToday";
import { missingMonths, monthOf, monthsBetween } from "./netWorthGaps";
import Decimal from "decimal.js";
import {
  percentOf,
  toMoneyDtoSafe,
} from "./moneyUtils";

/**
 * Repository for net worth analytics.
 */
export class NetWorthReportRepository extends BaseReportRepository {
  /**
   * Get net worth history (snapshot-first with fallback).
   *
   * Attempts to use stored monthly snapshots for historical accuracy.
   * If snapshots are missing (or for current month), falls back to
   * calculating from account balances.
   *
   * @param householdId - The household context
   * @param query - Report filters (date range, currency)
   * @returns Net worth time series and breakdown
   */
  async getNetWorth(
    householdId: string,
    query: QueryWithUser<ReportsNetWorthQuery>,
  ): Promise<ReportsNetWorthResponse> {
    const { from, to, interval = "month", scope = "household", userId } = query;
    const currency = await this.getHouseholdCurrency(householdId);
    const toMoneyValue = (value: Money | Decimal | number | string) =>
      toMoneyDtoSafe(value, currency);

    if (!userId) throw new ForbiddenError("Net worth requires a signed-in reader");

    // A-47: stored history as this reader may see it today. Stored totals
    // only when no account is hidden from the reader; otherwise re-derived
    // per account (see netWorthViewerSnapshots).
    if (scope !== "mine") {
      const snapshotCurrencyExpr = sql`COALESCE(${netWorthSnapshots.currency}, ${currency}::text)`;
      const fxRateExpr = this.buildFxRateExpr(
        snapshotCurrencyExpr,
        currency,
        sql`${netWorthSnapshots.date}`,
        { householdId, nullOnMissing: true },
      );
      const snapshots = await readViewerSnapshots(householdId, userId, { from, to }, fxRateExpr);

      if (snapshots.length > 0) {
        const normalizedSnapshots = snapshots.map((snapshot) => {
          const snapshotCurrency = this.getEffectiveCurrency(snapshot.currency, null, currency);
          const fxRate = this.resolveSnapshotFxRate(snapshotCurrency, currency, snapshot.fxRate, snapshot.date);
          const convert = (money: Money) =>
            snapshotCurrency === currency
              ? new Money(money.amount, currency)
              : new Money(money.amount.times(fxRate), currency);
          const byType = (totals: Record<string, Money> | null) =>
            totals && Object.entries(totals).map(([type, value]) => ({ type, value: toMoneyValue(convert(value)) }));
          return {
            date: snapshot.date,
            netWorth: convert(snapshot.netWorth),
            assets: convert(snapshot.assets),
            liabilities: convert(snapshot.liabilities),
            assetsByType: byType(snapshot.assetsByType),
            liabilitiesByType: byType(snapshot.liabilitiesByType),
          };
        });

        const latest = normalizedSnapshots[normalizedSnapshots.length - 1];
        const line = (id: string, color: string, pick: (s: (typeof normalizedSnapshots)[number]) => Money) => ({
          id,
          data: normalizedSnapshots.map((s) => ({ x: s.date, y: toMoneyValue(pick(s)) })),
          color,
        });

        return {
          range: {
            from,
            to,
            interval: interval as "day" | "month",
            baseCurrency: currency,
          },
          latest: {
            date: latest.date,
            netWorth: toMoneyValue(latest.netWorth),
            assets: toMoneyValue(latest.assets),
            liabilities: toMoneyValue(latest.liabilities),
          },
          series: [
            line("Net Worth", "#8b5cf6", (s) => s.netWorth),
            line("Assets", "#10b981", (s) => s.assets),
            line("Liabilities", "#f43f5e", (s) => s.liabilities),
          ],
          breakdown: latest.assetsByType
            ? { assetsByType: latest.assetsByType, liabilitiesByType: latest.liabilitiesByType ?? [] }
            : undefined,
          historyCoverage: "snapshots",
        };
      }
    }

    // Fallback (FIN-14): today's value from the account summary's valuation
    // (accounts, holdings, T-bills, pensions, bonds; liabilities as signed
    // debt). If those classes cannot be valued the account balances come back
    // flagged incomplete with the omitted classes; a missing FX rate is a 422.
    // A-47: also used when a reader has a hidden peer account and no stored
    // capture can be proven per account.
    const totals = await readNetWorthTotals(householdId, userId);
    const netWorth = netWorthOf(totals);
    // NEW-15: the current-only point is dated on the household calendar.
    const today = await householdToday(db, householdId);

    return {
      range: {
        from,
        to,
        interval: interval as "day" | "month",
        baseCurrency: currency,
      },
      latest: {
        date: today,
        netWorth: toMoneyValue(netWorth),
        assets: toMoneyValue(totals.assets),
        liabilities: toMoneyValue(totals.liabilities),
      },
      series: [
        {
          id: "Net Worth",
          data: [{ x: today, y: toMoneyValue(netWorth) }],
        },
      ],
      incomplete: totals.incomplete,
      omittedValuations: totals.omittedValuations,
      // NEW-34 (RC-14): one point valued today, not history.
      historyCoverage: "current_only",
    };
  }

  /**
   * Get monthly net worth changes.
   *
   * Calculates the month-over-month change in net worth (amount and percentage).
   * Useful for tracking financial progress velocity.
   *
   * @param householdId - The household context
   * @param query - Date range
   * @returns Monthly change series and averages
   */
  async getNetWorthChanges(
    householdId: string,
    query: { from: string; to: string; scope?: string; userId?: string },
  ): Promise<ReportsNetWorthChangesResponse> {
    const { from, to, scope = "household", userId } = query;

    const netWorthData = await this.getNetWorth(householdId, {
      from,
      to,
      interval: "month",
      scope: scope as "household" | "mine",
      userId,
    });

    const { baseCurrency: currency } = netWorthData.range;
    const today = await householdToday(db, householdId);
    const through = to < today ? to : today;
    const historyCoverage = netWorthData.historyCoverage ?? "snapshots";
    const captures = historyCoverage === "snapshots"
      ? (netWorthData.series.find(line => line.id === "Net Worth")?.data ?? [])
        // Snapshots carry UTC capture dates; household today only bounds missing months.
        .filter(({ x }) => x >= from && x <= to)
      : [];

    // The reader's latest visible capture in each recorded calendar month.
    // Keep its actual date, including partial months and gaps.
    const monthly = new Map<string, (typeof captures)[number]>();
    for (const point of captures) {
      const month = monthOf(point.x);
      const previous = monthly.get(month);
      if (!previous || point.x > previous.x) monthly.set(month, point);
    }
    const endpoints = [...monthly.values()].sort((a, b) => a.x.localeCompare(b.x));
    const comparable = isCurrencyCode(currency) && endpoints.every(({ y }) => y?.currency === currency);
    const periods: ReportsNetWorthChangesResponse["periods"] = [];
    let totalChange = Money.zero(currency);
    let elapsedMonths = 0;

    for (let i = 1; comparable && i < endpoints.length; i++) {
      const { x: startPeriod, y: startValue } = endpoints[i - 1];
      const { x: period, y: endValue } = endpoints[i];
      const startMoney = new Money(startValue.amount, currency);
      const endMoney = new Money(endValue.amount, currency);
      const changeMoney = endMoney.subtract(startMoney);
      const months = monthsBetween(startPeriod, period);
      totalChange = totalChange.add(changeMoney);
      elapsedMonths += months;
      periods.push({
        period,
        startPeriod,
        spansGap: months > 1,
        startNetWorth: toMoneyDto(startMoney, currency),
        endNetWorth: toMoneyDto(endMoney, currency),
        change: toMoneyDto(changeMoney, currency),
        changePct: percentOf(changeMoney, startMoney, 2),
      });
    }

    return {
      range: { from, to, currency },
      totalChange: toMoneyDto(totalChange, currency),
      avgMonthlyChange: elapsedMonths > 0 ? toMoneyDto(totalChange.divide(elapsedMonths), currency) : null,
      periods, historyCoverage,
      insufficientHistory: periods.length === 0,
      missingMonths: missingMonths(from, through, endpoints.map(({ x }) => x)),
    };
  }

  /**
   * SCP-321: fail closed on a missing snapshot FX rate — never silently
   * convert at 1, which would corrupt the net-worth series. Same-currency
   * snapshots pin the rate to 1 so the by-type breakdowns cannot drift from
   * the headline totals.
   */
  private resolveSnapshotFxRate(
    fromCurrency: string,
    toCurrency: string,
    fxRate: string | number | null,
    date: string,
  ): Decimal {
    if (fromCurrency === toCurrency) {
      return new Decimal(1);
    }
    if (fxRate === null || fxRate === undefined) {
      logger.error("Missing FX rate in net worth snapshot conversion", {
        fromCurrency,
        toCurrency,
        date,
      });
      throw new CalculationError("MISSING_FX_RATE", { from: fromCurrency, to: toCurrency, date },
        `Exchange rate unavailable for ${fromCurrency} -> ${toCurrency}`);
    }
    return new Decimal(fxRate);
  }
}

// Singleton instance
export const netWorthReportRepository = new NetWorthReportRepository();
