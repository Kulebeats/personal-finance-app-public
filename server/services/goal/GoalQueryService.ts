import { desc, eq } from "drizzle-orm";
import {
  accounts,
  goalAccountAssignments,
  goalActivityLog,
  goals,
  type Goal,
} from "@shared/schema";
import { db } from "../../db";
import { Money } from "../../core/money";
import {
  calculateMonthlyProjection,
  calculatePercentComplete,
  calculateProjectedCompletion,
  calculateStatus,
  getGoalProgressAmount,
  getGoalProgressAmountMoney,
  getGoalTargetAmount,
  getGoalTargetAmountMoney,
} from "../goalCalculations";
import { debtPayoffCalculator } from "../DebtPayoffCalculator";
import { GoalBaseService } from "./GoalBaseService";

export class GoalQueryService extends GoalBaseService {
  async getGoalWithProgress(id: string, householdId: string, userId: string) {
    const baseGoal = await this.getGoalById(id, householdId);
    const goal = await this.applyInvestmentHoldingsProgress(baseGoal);
    const timezone = await this.getUserTimezone(userId);
    const today = this.getTodayInTimezone(timezone);

    const currentAmountMoney = new Money(goal.currentAmount);
    const remainingMoney =
      goal.type === "pay_down"
        ? currentAmountMoney
        : new Money(goal.targetAmount).subtract(currentAmountMoney);
    const remaining = remainingMoney.isNegative() ? 0 : remainingMoney.toNumber();
    const percentComplete = calculatePercentComplete(goal);

    let daysLeft: number | null = null;
    if (goal.targetDate) {
      const target = new Date(`${goal.targetDate}T00:00:00Z`);
      daysLeft = Math.max(
        0,
        Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      );
    }

    const assignments = await db
      .select({ assignment: goalAccountAssignments, account: accounts })
      .from(goalAccountAssignments)
      .innerJoin(accounts, eq(goalAccountAssignments.accountId, accounts.id))
      .where(eq(goalAccountAssignments.goalId, goal.id));

    return {
      ...goal,
      percentComplete,
      remaining,
      daysLeft,
      assignments: assignments.map((row) => ({
        ...row.assignment,
        accountName: row.account.name,
        accountBalance: row.account.balance,
        accountCurrency: row.account.currency,
      })),
    };
  }

  async getProjection(id: string, householdId: string, userId: string) {
    const baseGoal = await this.getGoalById(id, householdId);
    const goal = await this.applyInvestmentHoldingsProgress(baseGoal);
    const timezone = await this.getUserTimezone(userId);
    const today = this.getTodayInTimezone(timezone);

    const monthlyProjection = calculateMonthlyProjection(goal);
    const projectedCompletionDate = calculateProjectedCompletion(
      goal,
      monthlyProjection ?? undefined
    );
    const status = calculateStatus(goal);

    let monthsRemaining: number | null = null;
    if (goal.targetDate) {
      const target = new Date(`${goal.targetDate}T00:00:00Z`);
      monthsRemaining =
        (target.getFullYear() - today.getFullYear()) * 12 +
        (target.getMonth() - today.getMonth());
    }

    return {
      monthlyProjection: monthlyProjection ?? null,
      projectedCompletionDate,
      status,
      monthsRemaining,
    };
  }

  async getSummary(householdId: string) {
    const goalsList = await this.getGoals(householdId, {
      includeArchived: false,
      includeCompleted: true,
    });

    const saveUpGoals = goalsList.filter((g) => g.type === "save_up");
    const payDownGoals = goalsList.filter((g) => g.type === "pay_down");

    const sumAmounts = (
      list: Goal[],
      field: "currentAmount" | "targetAmount"
    ) =>
      list.reduce((sum, g) => {
        const val = new Money(g[field]);
        return sum.add(val);
      }, new Money(0));

    const saveUpTotalSaved = sumAmounts(saveUpGoals, "currentAmount");
    const saveUpTotalTarget = sumAmounts(saveUpGoals, "targetAmount");
    // Calculate progress percentage using Money arithmetic, convert to number only at the end
    const overallProgress = saveUpTotalTarget.isZero()
      ? 0
      : Math.round(
          saveUpTotalSaved
            .divide(saveUpTotalTarget.toFullString())
            .multiply(100)
            .toNumber()
        );

    const payDownTotalDebt = payDownGoals.reduce((sum, g) => {
      const val = new Money(g.currentAmount);
      return sum.add(val.abs());
    }, Money.zero());

    // Note: I am converting to number at end to preserve return signature of getSummary if it returns numbers.
    // Ideally update getSummary return type to string/Money, but frontend expects numbers?
    // Let's keep strict return types for now or update DTO later.
    // Wait, payDownTotalOriginal...

    const payDownTotalOriginal = payDownGoals.reduce((sum, g) => {
      const original = g.originalBalance
        ? new Money(g.originalBalance)
        : new Money(g.targetAmount);
      return sum.add(original); // Assumed positive as per create logic
    }, Money.zero());
    // Calculate projected interest using Money for accumulation
    // Note: debtPayoffCalculator.calculatePayoff requires number inputs (legacy boundary)
    const projectedInterestMoney = payDownGoals.reduce((sum, goal) => {
      const balanceMoney = new Money(goal.currentAmount).abs();
      const balance = balanceMoney.toNumber();
      const apr = Number(goal.interestRate ?? 0); // Interest rate is a percentage, not currency
      const monthlyPaymentMoney = new Money(goal.monthlyPayment ?? 0);
      const monthlyPayment = monthlyPaymentMoney.toNumber();
      if (
        !Number.isFinite(balance) ||
        !Number.isFinite(apr) ||
        monthlyPaymentMoney.isNegativeOrZero()
      ) {
        return sum;
      }

      const oneTimePaymentMoney = goal.oneTimePayment
        ? new Money(goal.oneTimePayment)
        : Money.zero();

      const scenario = debtPayoffCalculator.calculatePayoff(
        balance,
        apr,
        monthlyPayment,
        oneTimePaymentMoney.toNumber()
      );

      // Accumulate using Money to maintain precision
      return sum.add(new Money(scenario.totalInterest));
    }, Money.zero());

    const recentActivity = await db
      .select({
        goalId: goalActivityLog.goalId,
        activityType: goalActivityLog.activityType,
        amount: goalActivityLog.amount,
        createdAt: goalActivityLog.createdAt,
        goalName: goals.name,
      })
      .from(goalActivityLog)
      .innerJoin(goals, eq(goalActivityLog.goalId, goals.id))
      .where(eq(goals.householdId, householdId))
      .orderBy(desc(goalActivityLog.createdAt))
      .limit(10);

    const milestonePercents = [25, 50, 75, 100];

    const estimateMilestoneDays = (
      goal: Goal,
      milestonePercent: number,
      remainingToMilestone: number
    ): number | null => {
      if (goal.type === "pay_down") {
        const monthlyPaymentMoney = new Money(
          goal.monthlyPayment ?? goal.minimumPayment ?? 0
        );
        if (monthlyPaymentMoney.isNegativeOrZero()) {
          return null;
        }

        const balanceMoney = new Money(goal.currentAmount).abs();
        if (balanceMoney.isNegativeOrZero()) {
          return null;
        }

        const apr = Number(goal.interestRate ?? 0); // Interest rate is a percentage, not currency
        const oneTimePaymentMoney = goal.oneTimePayment
          ? new Money(goal.oneTimePayment)
          : Money.zero();

        // Convert to numbers at the boundary for debtPayoffCalculator (legacy API)
        const scenario = debtPayoffCalculator.calculatePayoff(
          balanceMoney.toNumber(),
          apr,
          monthlyPaymentMoney.toNumber(),
          oneTimePaymentMoney.toNumber()
        );
        if (scenario.schedule.length === 0) {
          return null;
        }

        const original = getGoalTargetAmount(goal);
        if (!Number.isFinite(original) || original <= 0) {
          return null;
        }

        const milestoneBalance = Math.max(
          0,
          original - (original * milestonePercent) / 100
        );
        const entry = scenario.schedule.find(
          (item) => item.balance <= milestoneBalance
        );
        if (!entry) {
          return null;
        }

        return Math.max(0, Math.ceil(entry.month * 30));
      }

      const monthlyProjectionMoney = goal.monthlyProjection
        ? new Money(goal.monthlyProjection)
        : null;
      const monthlyProjection = monthlyProjectionMoney?.toNumber() ?? calculateMonthlyProjection(goal) ?? 0;

      if (!Number.isFinite(monthlyProjection) || monthlyProjection <= 0) {
        return null;
      }

      const months = remainingToMilestone / monthlyProjection;
      if (!Number.isFinite(months) || months < 0) {
        return null;
      }

      return Math.max(0, Math.ceil(months * 30));
    };

    const upcomingMilestones = goalsList
      .filter((goal) => !goal.isCompleted)
      .map((goal) => {
        // FIX: DATA-MONEY-CROSS-001 - Use Money throughout calculations
        const targetAmountMoney = getGoalTargetAmountMoney(goal);
        if (targetAmountMoney.isNegativeOrZero()) {
          return null;
        }

        const progressAmountMoney = getGoalProgressAmountMoney(goal);
        // Calculate percent using Money division
        const percentComplete = progressAmountMoney
          .divide(targetAmountMoney.toFullString())
          .multiply(100)
          .toNumber();
        const nextMilestone = milestonePercents.find(
          (milestone) => percentComplete < milestone
        );

        if (!nextMilestone) {
          return null;
        }

        // Calculate milestone amount and remaining using Money arithmetic
        const milestoneAmountMoney = targetAmountMoney.multiply(
          nextMilestone / 100
        );
        const remainingToMilestoneMoney =
          milestoneAmountMoney.subtract(progressAmountMoney);
        if (remainingToMilestoneMoney.isNegativeOrZero()) {
          return null;
        }

        // Convert to number only at legacy boundary (estimateMilestoneDays uses debtPayoffCalculator)
        const daysAway = estimateMilestoneDays(
          goal,
          nextMilestone,
          remainingToMilestoneMoney.toNumber()
        );

        if (daysAway === null) {
          return null;
        }

        return {
          goalId: goal.id,
          goalName: goal.name,
          milestone: `${nextMilestone}%`,
          daysAway,
        };
      })
      .filter(
        (
          item
        ): item is {
          goalId: string;
          goalName: string;
          milestone: string;
          daysAway: number;
        } => item !== null
      )
      .sort((a, b) => a.daysAway - b.daysAway)
      .slice(0, 5);

    return {
      saveUp: {
        total: saveUpGoals.length,
        onTrack: saveUpGoals.filter((g) => g.status === "on_track").length,
        behind: saveUpGoals.filter((g) => g.status === "behind").length,
        atRisk: saveUpGoals.filter((g) => g.status === "at_risk").length,
        completed: saveUpGoals.filter((g) => g.status === "completed").length,
        totalSaved: Number(saveUpTotalSaved.toString()),
        totalTarget: Number(saveUpTotalTarget.toString()),
        overallProgress,
      },
      payDown: {
        total: payDownGoals.length,
        totalDebt: Number(payDownTotalDebt.toString()),
        totalPaid: Number(
          (payDownTotalOriginal.subtract(payDownTotalDebt).isNegative()
            ? Money.zero()
            : payDownTotalOriginal.subtract(payDownTotalDebt)
          ).toString()
        ),
        projectedInterest: Number(projectedInterestMoney.toString()),
        onTrack: payDownGoals.filter((g) => g.status === "on_track").length,
        behind: payDownGoals.filter((g) => g.status === "behind").length,
      },
      investment: {
        total: goalsList.filter((g) => g.type === "investment").length,
        totalSaved: Number(
          sumAmounts(
            goalsList.filter((g) => g.type === "investment"),
            "currentAmount"
          ).toString()
        ),
        totalTarget: Number(
          sumAmounts(
            goalsList.filter((g) => g.type === "investment"),
            "targetAmount"
          ).toString()
        ),
      },
      recentActivity: recentActivity.map((activity) => ({
        goalId: activity.goalId,
        goalName: activity.goalName,
        activityType: activity.activityType,
        amount: activity.amount ? new Money(activity.amount).toNumber() : 0,
        createdAt: activity.createdAt?.toISOString() ?? null,
      })),
      upcomingMilestones,
    };
  }
}
