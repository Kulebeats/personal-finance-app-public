import { db } from "../../db";
import { sql, and, eq, isNull, desc, inArray } from "drizzle-orm";
import { accounts, goals } from "@shared/schema";
import type { MoneyDto } from "@shared/money";
import { Money } from "../../core/money";
import Decimal from "decimal.js";
import {
  moneyFromDto,
  moneyFromValue,
  percentOf,
  ratioOf,
  toMoneyDtoSafe,
} from "./moneyUtils";
import { LIABILITY_ACCOUNT_TYPES } from "./constants";
import type { CashflowReportRepository } from "./CashflowReportRepository";

export type AnalyticsRatiosContext = {
  getHouseholdCurrency: (householdId: string) => Promise<string>;
  cashflow: CashflowReportRepository;
};

export async function getFinancialRatios(
  ctx: AnalyticsRatiosContext,
  householdId: string,
  query: { from: string; to: string; scope?: string; userId?: string }
) {
  const { from, to, scope = "household", userId } = query;
  const currency = await ctx.getHouseholdCurrency(householdId);
  const toMoneyValue = (value: Money) => toMoneyDtoSafe(value, currency);

  const cashflowData = await ctx.cashflow.getCashflow(householdId, {
    from,
    to,
    interval: "month",
    scope: scope as "household" | "mine",
    userId,
  });

  const monthCount = cashflowData.series.length || 1;
  const incomeTotal = moneyFromDto(cashflowData.totals.income, currency);
  const expensesTotal = moneyFromDto(cashflowData.totals.expenses, currency);
  const savingsTotal = moneyFromDto(cashflowData.totals.savings, currency);
  const monthlyIncome = incomeTotal.divide(monthCount);
  const monthlyExpenses = expensesTotal.divide(monthCount);

  const liquidAccounts = await db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        isNull(accounts.deletedAt),
        sql`${accounts.type} IN ('checking', 'savings', 'cash', 'mobile_money')`,
        scope === "mine" && userId
          ? eq(accounts.ownerUserId, userId)
          : sql`1=1`
      )
    );

  const liquidAssets = liquidAccounts.reduce(
    (sum, a) => sum.add(moneyFromValue(a.balance, currency)),
    Money.zero(currency)
  );

  const liabilityAccounts = await db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        isNull(accounts.deletedAt),
        inArray(accounts.type, LIABILITY_ACCOUNT_TYPES),
        scope === "mine" && userId
          ? eq(accounts.ownerUserId, userId)
          : sql`1=1`
      )
    );

  const currentLiabilities = liabilityAccounts.reduce(
    (sum, a) => sum.add(moneyFromValue(a.balance, currency).abs()),
    Money.zero(currency)
  );

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

  const debtAccounts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      balance: accounts.balance,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        isNull(accounts.deletedAt),
        inArray(accounts.type, LIABILITY_ACCOUNT_TYPES),
        scope === "mine" && userId
          ? eq(accounts.ownerUserId, userId)
          : sql`1=1`
      )
    )
    .orderBy(desc(accounts.balance));

  const totalDebt = debtAccounts.reduce(
    (sum, a) => sum.add(moneyFromValue(a.balance, currency).abs()),
    Money.zero(currency)
  );

  const byType = new Map<string, { balance: Money; accounts: number }>();
  for (const acct of debtAccounts) {
    const existing = byType.get(acct.type) || {
      balance: Money.zero(currency),
      accounts: 0,
    };
    existing.balance = existing.balance.add(
      moneyFromValue(acct.balance, currency).abs()
    );
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
      balance: toMoneyValue(moneyFromValue(a.balance, currency).abs()),
      type: a.type,
    })),
  };
}

export async function getGoalsProgress(
  ctx: AnalyticsRatiosContext,
  householdId: string,
  query: { year?: number; scope?: string; userId?: string }
) {
  const { scope = "household", userId } = query;
  const currency = await ctx.getHouseholdCurrency(householdId);
  const toMoneyValue = (value: Money) => toMoneyDtoSafe(value, currency);

  const goalsResult = await db
    .select({
      id: goals.id,
      name: goals.name,
      type: goals.type,
      targetAmount: goals.targetAmount,
      currentAmount: goals.currentAmount,
      targetDate: goals.targetDate,
      status: goals.status,
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
    const target = moneyFromValue(g.targetAmount, currency);
    const current = moneyFromValue(g.currentAmount, currency);
    const progress = target.amount.isZero()
      ? 0
      : new Decimal(current.amount)
          .div(target.amount)
          .times(100)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          .toNumber();

    let monthlyRequired: Money | null = null;
    if (g.targetDate && target.gt(current)) {
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
      type: g.type as "save_up" | "pay_down" | "investment",
      targetAmount: toMoneyValue(target),
      currentAmount: toMoneyValue(current),
      progress,
      projectedCompletion: null as string | null,
      onTrack: g.status === "on_track" || g.status === "completed",
      monthlyRequired: monthlyRequired ? toMoneyValue(monthlyRequired) : null,
    };
  });

  const summary = {
    totalGoals: goalsList.length,
    onTrackCount: goalsList.filter((g) => g.onTrack).length,
    behindCount: goalsList.filter((g) => !g.onTrack && g.progress < 100).length,
    completedCount: goalsList.filter((g) => g.progress >= 100).length,
  };

  return { goals: goalsList, summary };
}
