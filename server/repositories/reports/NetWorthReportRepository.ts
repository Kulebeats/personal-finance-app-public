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
import { and, eq, gte, lte, isNull, or, sql } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { accounts, netWorthSnapshots } from "@shared/schema";
import { BaseReportRepository } from "./BaseReportRepository";
import type { ReportsNetWorthResponse } from "@shared/reports";
import type { MoneyDto } from "@shared/money";
import { Money, toMoneyDto } from "../../core/money";
import type { ReportsNetWorthQuery } from "../../modules/reports/reports.validation";
import type { QueryWithUser } from "./types";
import { LIABILITY_ACCOUNT_TYPES } from "./constants";
import Decimal from "decimal.js";
import {
  moneyFromDto,
  moneyFromValue,
  percentOf,
  sumMoney,
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

    // Try to get snapshots first
    if (scope !== "mine") {
      const snapshotCurrencyExpr = sql`COALESCE(${netWorthSnapshots.currency}, ${currency}::text)`;
      const fxRateExpr = this.buildFxRateExpr(
        snapshotCurrencyExpr,
        currency,
        sql`${netWorthSnapshots.date}`,
        { nullOnMissing: true },
      );

      const snapshots = await db
        .select({
          date: netWorthSnapshots.date,
          netWorth: netWorthSnapshots.netWorth,
          assets: netWorthSnapshots.totalAssets,
          liabilities: netWorthSnapshots.totalLiabilities,
          assetsByType: netWorthSnapshots.assetsByType,
          liabilitiesByType: netWorthSnapshots.liabilitiesByType,
          currency: netWorthSnapshots.currency,
          fxRate: sql<string | number | null>`${fxRateExpr}`,
        })
        .from(netWorthSnapshots)
        .where(
          and(
            eq(netWorthSnapshots.householdId, householdId),
            gte(netWorthSnapshots.date, from),
            lte(netWorthSnapshots.date, to),
          ),
        )
        .orderBy(netWorthSnapshots.date);

      if (snapshots.length > 0) {
        const normalizedSnapshots = snapshots.map((snapshot) => {
          const snapshotCurrency = this.getEffectiveCurrency(
            snapshot.currency,
            null,
            currency,
          );
          const fxRate = this.resolveSnapshotFxRate(
            snapshotCurrency,
            currency,
            snapshot.fxRate,
            snapshot.date,
          );
          const convertSnapshotMoney = (
            value: string | number | null | undefined,
          ) => {
            const money = moneyFromValue(value, snapshotCurrency);
            if (snapshotCurrency === currency) {
              return new Money(money.amount, currency);
            }
            return new Money(money.amount.times(fxRate), currency);
          };

          const netWorth = convertSnapshotMoney(snapshot.netWorth);
          const assets = convertSnapshotMoney(snapshot.assets);
          const liabilities = convertSnapshotMoney(snapshot.liabilities);

          const assetsByType = snapshot.assetsByType
            ? Object.fromEntries(
                Object.entries(
                  snapshot.assetsByType as Record<string, number>,
                ).map(([type, value]) => [
                  type,
                  toMoneyValue(
                    new Money(new Decimal(value).times(fxRate), currency),
                  ),
                ]),
              )
            : undefined;

          const liabilitiesByType = snapshot.liabilitiesByType
            ? Object.fromEntries(
                Object.entries(
                  snapshot.liabilitiesByType as Record<string, number>,
                ).map(([type, value]) => [
                  type,
                  toMoneyValue(
                    new Money(new Decimal(value).times(fxRate), currency),
                  ),
                ]),
              )
            : undefined;

          return {
            date: snapshot.date,
            netWorth,
            assets,
            liabilities,
            assetsByType,
            liabilitiesByType,
          };
        });

        const latest = normalizedSnapshots[normalizedSnapshots.length - 1];

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
            {
              id: "Net Worth",
              data: normalizedSnapshots.map((s) => ({
                x: s.date,
                y: toMoneyValue(s.netWorth),
              })),
              color: "#8b5cf6",
            },
            {
              id: "Assets",
              data: normalizedSnapshots.map((s) => ({
                x: s.date,
                y: toMoneyValue(s.assets),
              })),
              color: "#10b981",
            },
            {
              id: "Liabilities",
              data: normalizedSnapshots.map((s) => ({
                x: s.date,
                y: toMoneyValue(s.liabilities),
              })),
              color: "#f43f5e",
            },
          ],
          breakdown: latest.assetsByType
            ? {
                assetsByType: Object.entries(latest.assetsByType).map(
                  ([type, value]) => ({
                    type,
                    value: value as MoneyDto,
                  }),
                ),
                liabilitiesByType: Object.entries(
                  latest.liabilitiesByType || {},
                ).map(([type, value]) => ({
                  type,
                  value: value as MoneyDto,
                })),
              }
            : undefined,
        };
      }
    }

    // Fallback: Calculate from current account balances
    const visibleAccounts = await db
      .select({
        id: accounts.id,
        balance: accounts.balance,
        type: accounts.type,
        currency: accounts.currency,
      })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, householdId),
          isNull(accounts.deletedAt),
          eq(accounts.excludeFromNetWorth, false),
          or(
            eq(accounts.isPrivate, false),
            eq(accounts.ownerUserId, userId || ""),
          ),
        ),
      );

    const accountCurrencies = visibleAccounts.map(
      (a) => a.currency || currency,
    );
    const fxRatesByCurrency = await this.getLatestFxRates(
      accountCurrencies,
      currency,
    );

    let assets = Money.zero(currency);
    let liabilities = Money.zero(currency);

    for (const acc of visibleAccounts) {
      const accountCurrency = this.getEffectiveCurrency(
        acc.currency,
        null,
        currency,
      );
      const balance = this.convertAmount(
        acc.balance,
        accountCurrency,
        currency,
        fxRatesByCurrency,
      );
      if (
        LIABILITY_ACCOUNT_TYPES.includes(
          acc.type as (typeof LIABILITY_ACCOUNT_TYPES)[number],
        )
      ) {
        liabilities = liabilities.add(balance.abs());
      } else {
        assets = assets.add(balance);
      }
    }

    const netWorth = assets.subtract(liabilities);
    const today = new Date().toISOString().split("T")[0];

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
        assets: toMoneyValue(assets),
        liabilities: toMoneyValue(liabilities),
      },
      series: [
        {
          id: "Net Worth",
          data: [{ x: today, y: toMoneyValue(netWorth) }],
        },
      ],
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
  ) {
    const { from, to, scope = "household", userId } = query;

    const netWorthData = await this.getNetWorth(householdId, {
      from,
      to,
      interval: "month",
      scope: scope as "household" | "mine",
      userId,
    });

    const { baseCurrency: currency } = netWorthData.range;
    const dataPoints = netWorthData.series[0]?.data || [];

    const periods: Array<{
      period: string;
      startNetWorth: MoneyDto;
      endNetWorth: MoneyDto;
      change: MoneyDto;
      changePct: number;
    }> = [];

    for (let i = 1; i < dataPoints.length; i++) {
      const startMoney = dataPoints[i - 1]?.y
        ? moneyFromDto(dataPoints[i - 1].y as MoneyDto, currency)
        : Money.zero(currency);
      const endMoney = dataPoints[i]?.y
        ? moneyFromDto(dataPoints[i].y as MoneyDto, currency)
        : startMoney;
      const changeMoney = endMoney.subtract(startMoney);
      const changePct = percentOf(changeMoney, startMoney, 2);

      periods.push({
        period: dataPoints[i]?.x || "",
        startNetWorth: toMoneyDto(startMoney, currency),
        endNetWorth: toMoneyDto(endMoney, currency),
        change: toMoneyDto(changeMoney, currency),
        changePct,
      });
    }

    const totalChange = sumMoney(
      periods.map((p) => moneyFromDto(p.change, currency)),
      currency,
    );
    const avgMonthlyChange =
      periods.length > 0
        ? totalChange.divide(periods.length)
        : Money.zero(currency);

    return {
      range: { from, to, currency },
      totalChange: toMoneyDto(totalChange, currency),
      avgMonthlyChange: toMoneyDto(avgMonthlyChange, currency),
      periods,
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
      throw new Error(
        `Exchange rate unavailable for ${fromCurrency} -> ${toCurrency}`,
      );
    }
    return new Decimal(fxRate);
  }
}

// Singleton instance
export const netWorthReportRepository = new NetWorthReportRepository();
