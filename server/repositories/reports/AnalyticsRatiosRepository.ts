import { db } from "../../db";
import { sql, and, eq, isNull, inArray, or } from "drizzle-orm";
import { accounts, goals } from "@shared/schema";
import { Money } from "../../core/money";
import { CalculationError } from "../../core/calculations/errors";
import {
  moneyFromDto,
  moneyFromValue,
  percentOf,
  ratioOf,
  toMoneyDtoSafe,
} from "./moneyUtils";
import { LIABILITY_ACCOUNT_TYPES, LIQUID_ACCOUNT_TYPES, type AccountType } from "./constants";
import { owedDebt } from "../../core/money/wealth-totals";
import { buildFxRateExpr } from "./fxRateExpr";
import { visibleGoalProgressSources } from "../../core/authz/goal-progress-visibility";
import { isHouseholdRole } from "../../core/authz/capabilities";
import { householdRepository } from "../HouseholdRepository";
import type { CashflowReportRepository } from "./CashflowReportRepository";
import { householdToday } from "../../services/householdCalendarToday";

export type AnalyticsRatiosContext = {
  getHouseholdCurrency: (householdId: string) => Promise<string>;
  cashflow: CashflowReportRepository;
};

type BalanceQuery = { scope?: string; userId?: string };

interface BaseBalance {
  id: string;
  name: string;
  type: AccountType;
  /** The account balance converted to the household base currency. */
  balance: Money;
}

/**
 * NEW-02: the reader's visible accounts of these types, each balance converted
 * to the household base currency at today's rate (balances are current): the
 * household's own rate valid today, else the latest shared rate on or before
 * today. Another member's private account is never read. A visible account
 * with no rate fails closed with MISSING_FX_RATE - never a rate of 1, never a
 * silent skip, never a sum of mixed currencies.
 */
async function readBaseBalances(
  householdId: string,
  baseCurrency: string,
  types: AccountType[],
  asOf: string,
  { scope = "household", userId }: BalanceQuery,
): Promise<BaseBalance[]> {
  const currency = sql<string>`COALESCE(${accounts.currency}, ${baseCurrency}::text)`;
  const rate = buildFxRateExpr(currency, baseCurrency, sql`${asOf}::date`, { householdId, nullOnMissing: true });
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currency,
      baseBalance: sql<string | null>`(${accounts.balance}::numeric * ${rate})::text`,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        isNull(accounts.deletedAt),
        inArray(accounts.type, types),
        scope === "mine" && userId ? eq(accounts.ownerUserId, userId) : sql`1=1`,
        userId
          ? or(eq(accounts.isPrivate, false), eq(accounts.ownerUserId, userId))
          : eq(accounts.isPrivate, false),
      )
    );

  return rows.map((row) => {
    if (row.baseBalance === null) {
      throw new CalculationError(
        "MISSING_FX_RATE",
        { from: row.currency, to: baseCurrency, date: asOf },
        `Exchange rate unavailable for ${row.currency} -> ${baseCurrency} on ${asOf}`,
      );
    }
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      balance: new Money(row.baseBalance, baseCurrency),
    };
  });
}

// NEW-05: debt is what is owed, max(balance, 0); an overpaid card is not debt.
const sumOwedDebt = (rows: BaseBalance[], currency: string): Money =>
  rows.reduce((sum, row) => sum.add(owedDebt(row.balance)), Money.zero(currency));

export async function getFinancialRatios(
  ctx: AnalyticsRatiosContext,
  householdId: string,
  query: { from: string; to: string; scope?: string; userId?: string }
) {
  const { from, to, scope = "household", userId } = query;
  const asOf = await householdToday(db, householdId);
  const currency = await ctx.getHouseholdCurrency(householdId);
  const toMoneyValue = (value: Money) => toMoneyDtoSafe(value, currency);

  const cashflowData = await ctx.cashflow.getCashflow(householdId, {
    from,
    to,
    interval: "month",
    scope: scope as "household" | "mine",
    userId,
  });

  // NEW-34: average over the months that have started, adding only their amounts.
  const monthCount = Math.max(cashflowData.range.elapsedPeriods ?? cashflowData.series.length, 1);
  const started = cashflowData.elapsedTotals ?? cashflowData.totals;
  const incomeTotal = moneyFromDto(cashflowData.totals.income, currency);
  const expensesTotal = moneyFromDto(cashflowData.totals.expenses, currency);
  const savingsTotal = moneyFromDto(cashflowData.totals.savings, currency);
  const monthlyIncome = moneyFromDto(started.income, currency).divide(monthCount);
  const monthlyExpenses = moneyFromDto(started.expenses, currency).divide(monthCount);

  const liquidAccounts = await readBaseBalances(householdId, currency, LIQUID_ACCOUNT_TYPES, asOf, query);
  const liquidAssets = liquidAccounts.reduce(
    (sum, a) => sum.add(a.balance),
    Money.zero(currency)
  );

  const liabilityAccounts = await readBaseBalances(householdId, currency, LIABILITY_ACCOUNT_TYPES, asOf, query);
  const currentLiabilities = sumOwedDebt(liabilityAccounts, currency);

  const monthlyDebt = currentLiabilities.divide(12);
  const dtiValue = percentOf(monthlyDebt, monthlyIncome, 2);
  const emergencyMonths =
    monthlyExpenses.amount.isZero()
      ? 0
      : ratioOf(liquidAssets, monthlyExpenses, 2);
  const emergencyMonthsRounded =
    monthlyExpenses.amount.isZero()
      ? 0
      : ratioOf(liquidAssets, monthlyExpenses, 1);
  const liquidityValue = currentLiabilities.amount.isZero()
    ? 999
    : ratioOf(liquidAssets, currentLiabilities, 2);
  const burnRateMonths =
    monthlyExpenses.amount.isZero()
      ? 0
      : ratioOf(liquidAssets, monthlyExpenses, 2);
  const burnRateMonthsRounded =
    monthlyExpenses.amount.isZero()
      ? 0
      : ratioOf(liquidAssets, monthlyExpenses, 1);
  const savingsValue = percentOf(savingsTotal, incomeTotal, 2);
  const netSavingsValue = percentOf(
    incomeTotal.subtract(expensesTotal),
    incomeTotal,
    2
  );

  return {
    range: { from, to, baseCurrency: currency },
    ratios: {
      dti: {
        value: dtiValue,
        monthlyDebt: toMoneyValue(monthlyDebt),
        monthlyIncome: toMoneyValue(monthlyIncome),
        status:
          dtiValue < 20
            ? "good"
            : dtiValue < 36
            ? "warning"
            : ("bad" as const),
      },
      emergencyFund: {
        value: emergencyMonths,
        months: emergencyMonthsRounded,
        monthlyExpenses: toMoneyValue(monthlyExpenses),
        liquidAssets: toMoneyValue(liquidAssets),
        status:
          emergencyMonths > 6
            ? "good"
            : emergencyMonths >= 3
            ? "warning"
            : ("bad" as const),
      },
      liquidityRatio: {
        value: liquidityValue,
        liquidAssets: toMoneyValue(liquidAssets),
        currentLiabilities: toMoneyValue(currentLiabilities),
        status:
          liquidityValue > 2
            ? "good"
            : liquidityValue >= 1
            ? "warning"
            : ("bad" as const),
      },
      burnRate: {
        value: burnRateMonths,
        months: burnRateMonthsRounded,
        liquidAssets: toMoneyValue(liquidAssets),
        monthlyExpenses: toMoneyValue(monthlyExpenses),
        status:
          burnRateMonths > 12
            ? "good"
            : burnRateMonths >= 6
            ? "warning"
            : ("bad" as const),
      },
      savingsRate: {
        value: savingsValue,
        savings: toMoneyValue(savingsTotal),
        income: toMoneyValue(incomeTotal),
      },
      netSavingsRate: {
        value: netSavingsValue,
        netSavings: toMoneyValue(incomeTotal.subtract(expensesTotal)),
        income: toMoneyValue(incomeTotal),
      },
    },
  };
}

export async function getDebtAnalysis(
  ctx: AnalyticsRatiosContext,
  householdId: string,
  query: { from: string; to: string; scope?: string; userId?: string }
) {
  const { from, to, scope = "household", userId } = query;
  const currency = await ctx.getHouseholdCurrency(householdId);
  const toMoneyValue = (value: Money) => toMoneyDtoSafe(value, currency);

  // Largest converted debt first; native balances in different currencies don't order.
  // Only accounts that owe money are debt accounts (NEW-05).
  const asOf = await householdToday(db, householdId);
  const debtAccounts = (await readBaseBalances(householdId, currency, LIABILITY_ACCOUNT_TYPES, asOf, query))
    .filter((account) => account.balance.isPositive())
    .sort((a, b) => b.balance.amount.comparedTo(a.balance.amount));

  const totalDebt = sumOwedDebt(debtAccounts, currency);

  const byType = new Map<string, { balance: Money; accounts: number }>();
  for (const acct of debtAccounts) {
    const existing = byType.get(acct.type) || {
      balance: Money.zero(currency),
      accounts: 0,
    };
    existing.balance = existing.balance.add(acct.balance);
    existing.accounts += 1;
    byType.set(acct.type, existing);
  }

  const debtByType = Array.from(byType.entries()).map(([type, data]) => ({
    type,
    balance: toMoneyValue(data.balance),
    accounts: data.accounts,
  }));

  const cashflowData = await ctx.cashflow.getCashflow(householdId, {
    from,
    to,
    interval: "month",
    scope: scope as "household" | "mine",
    userId,
  });

  const paymentTrend = cashflowData.series.map((s) => ({
    period: s.label,
    amount: s.debt,
  }));

  return {
    range: { from, to, currency },
    totalDebt: toMoneyValue(totalDebt),
    debtByType,
    paymentTrend,
    topDebtAccounts: debtAccounts.slice(0, 5).map((a) => ({
      id: a.id,
      name: a.name,
      balance: toMoneyValue(a.balance),
      type: a.type,
    })),
  };
}

/**
 * The reader's verdict on each goal's progress, read with the goal itself
 * (FIN-01). No reader, or one who is no longer a member, sees no progress.
 */
async function goalProgressVerdict(householdId: string, userId: string | undefined) {
  const membership = userId ? await householdRepository.findMember(householdId, userId) : undefined;
  if (!userId || !membership || !isHouseholdRole(membership.role)) return sql<boolean>`false`;
  const reader = { householdId, userId, role: membership.role };
  return sql<boolean>`coalesce((${visibleGoalProgressSources(reader)}), false)`;
}

function payDownProgress(original: Money, outstanding: Money): number {
  if (!original.amount.isFinite() || original.isNegativeOrZero() || !outstanding.amount.isFinite() || outstanding.gte(original)) {
    return 0;
  }
  if (outstanding.isNegativeOrZero()) return 100;
  return percentOf(original.subtract(outstanding), original);
}

export async function getGoalsProgress(
  ctx: AnalyticsRatiosContext,
  householdId: string,
  query: { year?: number; scope?: string; userId?: string }
) {
  const { scope = "household", userId } = query;
  const currency = await ctx.getHouseholdCurrency(householdId);

  const goalsResult = await db
    .select({
      id: goals.id,
      name: goals.name,
      type: goals.type,
      targetAmount: goals.targetAmount,
      currentAmount: goals.currentAmount,
      originalBalance: goals.originalBalance,
      currency: goals.currency,
      targetDate: goals.targetDate,
      status: goals.status,
      progressVisible: await goalProgressVerdict(householdId, userId),
    })
    .from(goals)
    .where(
      and(
        eq(goals.householdId, householdId),
        eq(goals.isArchived, false),
        scope === "mine" && userId ? eq(goals.createdBy, userId) : sql`1=1`
      )
    );

  const goalsList = goalsResult.map((g) => {
    const type = g.type as "save_up" | "pay_down" | "investment";
    if (g.progressVisible !== true) {
      // Nothing derived from hidden progress: no amount, percent, status or
      // requirement, and no debt target (it is the private debt's balance).
      return {
        id: g.id, name: g.name, type,
        targetAmount: type === "pay_down" ? null : toMoneyDtoSafe(moneyFromValue(g.targetAmount, currency), currency),
        currentAmount: null, progress: null, projectedCompletion: null, onTrack: null, monthlyRequired: null,
        progressAvailability: "unavailable" as const,
      };
    }
    const unit = type === "pay_down" ? g.currency : currency;
    const target = moneyFromValue(g.targetAmount, unit);
    const current = moneyFromValue(g.currentAmount, unit);
    const progress = type === "pay_down"
      ? payDownProgress(moneyFromValue(g.originalBalance ?? g.targetAmount, unit), current)
      : percentOf(current, target);

    let monthlyRequired: Money | null = null;
    if (type !== "pay_down" && g.targetDate && target.gt(current)) {
      const remaining = target.subtract(current);
      const targetDate = new Date(g.targetDate);
      const now = new Date();
      const monthsRemaining =
        (targetDate.getFullYear() - now.getFullYear()) * 12 +
        (targetDate.getMonth() - now.getMonth());
      if (monthsRemaining > 0) {
        monthlyRequired = remaining.divide(monthsRemaining);
      }
    }

    return {
      id: g.id,
      name: g.name,
      type,
      targetAmount: toMoneyDtoSafe(target, unit),
      currentAmount: toMoneyDtoSafe(current, unit),
      progress,
      projectedCompletion: null as string | null,
      onTrack: g.status === "on_track" || g.status === "completed",
      ...(type === "pay_down" ? {} : { monthlyRequired: monthlyRequired ? toMoneyDtoSafe(monthlyRequired, unit) : null }),
      progressAvailability: "available" as const,
    };
  });

  // A goal whose progress is hidden is listed but counted in no status bucket.
  const judged = goalsList.flatMap((g) => g.progress === null ? [] : [{ onTrack: g.onTrack === true, progress: g.progress }]);
  const summary = {
    totalGoals: goalsList.length,
    onTrackCount: judged.filter((g) => g.onTrack).length,
    behindCount: judged.filter((g) => !g.onTrack && g.progress < 100).length,
    completedCount: judged.filter((g) => g.progress >= 100).length,
  };

  return { goals: goalsList, summary };
}
