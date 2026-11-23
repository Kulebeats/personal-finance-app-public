import Decimal from "decimal.js";
import { db } from "../db";
import {
  accounts,
  accountBalanceSnapshots,
  households,
  investmentTransactions,
} from "@shared/schema";
import { eq, and, inArray, gte, asc, sql } from "drizzle-orm";
import { subMonths, subYears } from "date-fns";
import { visibleAccountPredicate } from "../core/authz/transaction-visibility";
import { visibleInvestmentTransactionPredicate } from "../core/authz/investment-visibility";
import { CalculationError } from "../core/calculations/errors";
import { ForbiddenError } from "../core/errors";
import type { HouseholdContext } from "../middleware/householdGuard";
import { resolvedFxRate } from "../repositories/reports/fxRateExpr";
import { buildPerformanceSeries, type PerformanceDataPoint, type PerformanceFlow } from "./InvestmentPerformanceSeries";

export type TimeFrame = "1M" | "3M" | "YTD" | "1Y" | "ALL";
export type { PerformanceDataPoint } from "./InvestmentPerformanceSeries";

const CASH_FLOW_TYPES: ("transfer_in" | "transfer_out")[] = ["transfer_in", "transfer_out"];
// A household with no stored currency reads as ZMW everywhere.
const DEFAULT_CURRENCY = "ZMW";

function startDateFor(timeframe: TimeFrame, now: Date): string {
  const start = timeframe === "3M" ? subMonths(now, 3)
    : timeframe === "1Y" ? subYears(now, 1)
      : timeframe === "YTD" ? new Date(now.getFullYear(), 0, 1)
        : timeframe === "ALL" ? new Date(0)
          : subMonths(now, 1);
  return start.toISOString().split("T")[0];
}

interface StoredFlow { date: string; type: string; amount: string; currency: string; amountZmw: string | null; rate: string | null }

// A-08: account snapshots are stored in the household currency, so each flow
// is expressed in it too: native when already in it; the dated ZMW amount
// stored with the event when the household is ZMW; else the dated rate the
// reports use. A flow with no rate makes the series unavailable (422).
function flowInReportingCurrency(flow: StoredFlow, base: string): PerformanceFlow {
  const type = flow.type === "transfer_out" ? "transfer_out" : "transfer_in";
  if (flow.currency === base) return { date: flow.date, type, amount: flow.amount };
  if (base === "ZMW" && flow.amountZmw !== null) return { date: flow.date, type, amount: flow.amountZmw };
  if (flow.rate === null) {
    throw new CalculationError("MISSING_FX_RATE", { from: flow.currency, to: base, date: flow.date },
      `Exchange rate unavailable for ${flow.currency} -> ${base} on ${flow.date}`);
  }
  const converted = new Decimal(flow.amount).times(flow.rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { date: flow.date, type, amount: converted.toString() };
}

export class InvestmentPerformanceService {
  // C3-24: the same audience as the other investment reads. A member sees
  // Shared investment accounts and their own private ones, never another
  // member's private account and never a soft-deleted one. All reads share
  // one snapshot so a concurrent privacy change cannot mix audiences.
  async gethistory(
    caller: HouseholdContext,
    timeframe: TimeFrame = "1M"
  ): Promise<PerformanceDataPoint[]> {
    if (!caller?.householdId || !caller.userId) throw new ForbiddenError("Financial read access required");
    const startDate = startDateFor(timeframe, new Date());
    return db.transaction(async tx => {
      const visible = await tx.select({ id: accounts.id }).from(accounts)
        .where(and(eq(accounts.type, "investment"), visibleAccountPredicate(caller)));
      if (visible.length === 0) return [];
      const accountIds = visible.map(account => account.id);

      const snapshots = await tx.select({ date: accountBalanceSnapshots.date, balance: accountBalanceSnapshots.balance })
        .from(accountBalanceSnapshots)
        .where(and(inArray(accountBalanceSnapshots.accountId, accountIds), gte(accountBalanceSnapshots.date, startDate)))
        .orderBy(asc(accountBalanceSnapshots.date));
      if (snapshots.length === 0) return [];

      const [household] = await tx.select({ currency: households.currency }).from(households)
        .where(eq(households.id, caller.householdId)).limit(1);
      const base = household?.currency || DEFAULT_CURRENCY;
      const rate = resolvedFxRate(caller.householdId, sql`${investmentTransactions.currency}`, base, sql`${investmentTransactions.transactionDate}`);
      const flows = await tx.select({
        date: investmentTransactions.transactionDate,
        type: investmentTransactions.type,
        amount: investmentTransactions.amount,
        currency: investmentTransactions.currency,
        amountZmw: investmentTransactions.amountZmw,
        rate: sql<string | null>`(${rate})::text`,
      }).from(investmentTransactions).where(and(
        inArray(investmentTransactions.accountId, accountIds),
        inArray(investmentTransactions.type, CASH_FLOW_TYPES),
        gte(investmentTransactions.transactionDate, startDate),
        visibleInvestmentTransactionPredicate(caller),
      ));
      return buildPerformanceSeries(snapshots, flows.map(flow => flowInReportingCurrency(flow, base)));
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
}

export const investmentPerformanceService = new InvestmentPerformanceService();
