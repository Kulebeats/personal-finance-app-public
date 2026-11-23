import { and, desc, eq, sql } from "drizzle-orm";
import {
  accounts,
  goalAccountAssignments,
  goalActivityLog,
  goals,
  households,
  type Goal,
} from "@shared/schema";
import { db } from "../../db";
import { Money, toMoneyDto } from "../../core/money";
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
import type { HouseholdContext } from "../../middleware/householdGuard";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { visibleGoalActivitySources } from "../../core/authz/goal-activity-visibility";
import { visibleGoalProgressSources } from "../../core/authz/goal-progress-visibility";
import { NotFoundError } from "../../utils/errorHandler";
import { readGoalsWithVisibility, type ViewerGoal } from "./GoalViewerProgress";
import { calendarDaysForMonths, wholeCalendarMonthsBetween } from "./goalCalendarDays";
import { householdToday } from "../householdCalendarToday";
import { householdGoalTotals } from "./goalSummaryTotals";

type GoalListOptions = NonNullable<Parameters<GoalBaseService["getGoals"]>[1]>;

/** Status and completion filters on what this viewer may see: a hidden goal matches no status and is never completed. */
function matchesViewerFilters(goal: ViewerGoal<Goal>, options: GoalListOptions): boolean {
  if (options.status && goal.status !== options.status) return false;
  return options.includeCompleted === true || goal.isCompleted !== true;
}

/** A visible goal's remaining amount and percent complete, from its live progress. */
function remainingAndPercent(goal: Goal) {
  const current = new Money(goal.currentAmount);
  const remainingMoney = goal.type === "pay_down" ? current : new Money(goal.targetAmount).subtract(current);
  return {
    remaining: remainingMoney.isNegative() ? 0 : remainingMoney.toNumber(),
    percentComplete: calculatePercentComplete(goal),
  };
}

/**
 * A debt goal's projected interest, in the goal's own currency.
 * debtPayoffCalculator.calculatePayoff takes numbers (legacy boundary).
 */
function projectedInterestFor(goal: Goal): Money {
  const balance = new Money(goal.currentAmount).abs().toNumber();
  const apr = Number(goal.interestRate ?? 0); // Interest rate is a percentage, not currency
  const monthlyPaymentMoney = new Money(goal.monthlyPayment ?? 0);
  if (!Number.isFinite(balance) || !Number.isFinite(apr) || monthlyPaymentMoney.isNegativeOrZero()) {
    return Money.zero();
  }
  const oneTimePayment = goal.oneTimePayment ? new Money(goal.oneTimePayment) : Money.zero();
  const scenario = debtPayoffCalculator.calculatePayoff(
    balance, apr, monthlyPaymentMoney.toNumber(), oneTimePayment.toNumber(),
  );
  return new Money(scenario.totalInterest);
}

export class GoalQueryService extends GoalBaseService {
  /**
   * One goal as this viewer may see it, the row and the verdict from one read.
   * Every response that carries a goal, writes included, returns this (#235 M1).
   */
  async getViewerGoal(id: string, actor: HouseholdContext): Promise<ViewerGoal<Goal>> {
    const [row] = await readGoalsWithVisibility(actor, { goalId: id });
    if (!row) throw new NotFoundError("Goal not found");
    return (await this.valueGoalForViewer(row.goal, row.visibility)).viewer;
  }

  /** List for one viewer: hidden progress sources withhold the progress (FIN-01). */
  async getGoalsForViewer(actor: HouseholdContext, options: GoalListOptions = {}) {
    const rows = await readGoalsWithVisibility(actor, { type: options.type, includeArchived: options.includeArchived });
    const viewerGoals = await Promise.all(rows.map(async ({ goal, visibility }) =>
      (await this.valueGoalForViewer(goal, visibility)).viewer));
    return viewerGoals.filter((goal) => matchesViewerFilters(goal, options));
  }

  async getGoalWithProgress(id: string, actor: HouseholdContext) {
    const [row] = await readGoalsWithVisibility(actor, { goalId: id });
    if (!row) throw new NotFoundError("Goal not found");
    const { viewer: viewerGoal, valued: goal } = await this.valueGoalForViewer(row.goal, row.visibility);
    const timezone = await this.getUserTimezone(actor.userId);
    const today = this.getTodayInTimezone(timezone);

    const { remaining, percentComplete } = goal ? remainingAndPercent(goal) : { remaining: null, percentComplete: null };
    const targetDate = row.goal.targetDate;

    let daysLeft: number | null = null;
    if (targetDate) {
      const target = new Date(`${targetDate}T00:00:00Z`);
      daysLeft = Math.max(
        0,
        Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      );
    }

    const assignments = await db
      .select({ assignment: goalAccountAssignments, account: accounts })
      .from(goalAccountAssignments)
      .innerJoin(goals, eq(goalAccountAssignments.goalId, goals.id))
      .innerJoin(accounts, eq(goalAccountAssignments.accountId, accounts.id))
      .where(and(
        eq(goals.id, row.goal.id),
        eq(goals.householdId, actor.householdId),
        visibleAccountPredicate(actor),
      ));

    return {
      ...viewerGoal,
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

  async getProjection(id: string, actor: HouseholdContext) {
    const [row] = await readGoalsWithVisibility(actor, { goalId: id });
    if (!row) throw new NotFoundError("Goal not found");
    const { valued: goal } = await this.valueGoalForViewer(row.goal, row.visibility);
    // Hidden sources, or a price or rate the valuation needs is missing: no forecast number.
    if (!goal) {
      return { availability: "unavailable" as const, monthlyProjection: null, projectedCompletionDate: null,
        status: null, monthsRemaining: null };
    }
    // NEW-15: calendar months from the household's calendar date, in Money.
    const today = await householdToday(db, actor.householdId);
    const monthlyProjection = calculateMonthlyProjection(goal, today);

    return {
      availability: "available" as const,
      monthlyProjection: monthlyProjection ? toMoneyDto(monthlyProjection, goal.currency) : null,
      projectedCompletionDate: calculateProjectedCompletion(goal, today, monthlyProjection),
      status: calculateStatus(goal, undefined, today),
      monthsRemaining: goal.targetDate ? wholeCalendarMonthsBetween(today, goal.targetDate) : null,
    };
  }

  async getSummary(actor: HouseholdContext) {
    const { householdId } = actor;
    // Totals, statuses and milestones aggregate progress, so a goal whose
    // sources are hidden from this viewer contributes only to the counts.
    // Rows and verdicts come from one read (one snapshot).
    const rows = await readGoalsWithVisibility(actor, { includeArchived: false });
    // A-04 / A-30: only goals whose progress is shown are valued, and only they reach the totals.
    const valued = await Promise.all(rows.map(({ goal, visibility }) => this.valueGoalForViewer(goal, visibility)));
    const goalsList = valued.flatMap(({ valued: goal }) => (goal ? [goal] : []));
    const countByType = (type: Goal["type"]) => rows.filter(({ goal }) => goal.type === type).length;
    // NEW-35: summary money is MoneyDto in the household currency.
    const [household] = await db.select({ currency: households.currency }).from(households)
      .where(eq(households.id, householdId)).limit(1);
    const currency = household?.currency ?? "ZMW";
    const dto = (value: Money) => toMoneyDto(value.toString(), currency);
    // A-09: each goal is converted from its own currency; one with no rate is left out and counted.
    const totals = await householdGoalTotals(goalsList, currency, householdId);

    const saveUpGoals = goalsList.filter((g) => g.type === "save_up");
    const payDownGoals = goalsList.filter((g) => g.type === "pay_down");
    const investmentGoals = goalsList.filter((g) => g.type === "investment");

    const sumAmounts = (list: Goal[], field: "currentAmount" | "targetAmount") =>
      totals.sum(list, (g) => new Money(g[field]));

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

    const payDownTotalDebt = totals.sum(payDownGoals, (g) => new Money(g.currentAmount).abs());
    // Assumed positive as per create logic
    const payDownTotalOriginal = totals.sum(payDownGoals, (g) =>
      new Money(g.originalBalance ? g.originalBalance : g.targetAmount));
    // Each goal's projected interest in its own currency, converted like the other totals.
    const projectedInterestMoney = totals.sum(payDownGoals, projectedInterestFor);

    const recentActivity = await db
      .select({
        goalId: goalActivityLog.goalId,
        activityType: goalActivityLog.activityType,
        amount: goalActivityLog.amount,
        createdAt: goalActivityLog.createdAt,
        goalName: goals.name,
        goalCurrency: goals.currency,
        // In the same read: an amount on a goal whose progress is hidden is withheld (#235 M6).
        progressVisible: sql<boolean>`coalesce((${visibleGoalProgressSources(actor)}), false)`,
      })
      .from(goalActivityLog)
      .innerJoin(goals, eq(goalActivityLog.goalId, goals.id))
      .where(and(eq(goals.householdId, householdId), visibleGoalActivitySources(actor)))
      .orderBy(desc(goalActivityLog.createdAt))
      .limit(10);

    const milestonePercents = [25, 50, 75, 100];
    // Days away count real calendar months from the household's today, not 30-day months (NEW-15).
    const today = await householdToday(db, householdId);

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

        return calendarDaysForMonths(today, entry.month);
      }

      const monthlyProjection = goal.monthlyProjection
        ? new Money(goal.monthlyProjection)
        : calculateMonthlyProjection(goal, today);
      if (!monthlyProjection || monthlyProjection.isNegativeOrZero()) {
        return null;
      }

      // A ratio of two amounts (months), not money.
      const months = remainingToMilestone / monthlyProjection.toNumber();
      if (!Number.isFinite(months) || months < 0) {
        return null;
      }

      return calendarDaysForMonths(today, months);
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
        total: countByType("save_up"),
        onTrack: saveUpGoals.filter((g) => g.status === "on_track").length,
        behind: saveUpGoals.filter((g) => g.status === "behind").length,
        atRisk: saveUpGoals.filter((g) => g.status === "at_risk").length,
        completed: saveUpGoals.filter((g) => g.status === "completed").length,
        totalSaved: dto(saveUpTotalSaved),
        totalTarget: dto(saveUpTotalTarget),
        overallProgress,
        // A-09: goals left out of these totals because their currency has no rate.
        excludedCount: totals.excludedCount(saveUpGoals),
      },
      payDown: {
        total: countByType("pay_down"),
        totalDebt: dto(payDownTotalDebt),
        totalPaid: dto(
          payDownTotalOriginal.subtract(payDownTotalDebt).isNegative()
            ? Money.zero()
            : payDownTotalOriginal.subtract(payDownTotalDebt)
        ),
        projectedInterest: dto(projectedInterestMoney),
        onTrack: payDownGoals.filter((g) => g.status === "on_track").length,
        behind: payDownGoals.filter((g) => g.status === "behind").length,
        excludedCount: totals.excludedCount(payDownGoals),
      },
      investment: {
        total: countByType("investment"),
        totalSaved: dto(sumAmounts(investmentGoals, "currentAmount")),
        totalTarget: dto(sumAmounts(investmentGoals, "targetAmount")),
        excludedCount: totals.excludedCount(investmentGoals),
      },
      recentActivity: recentActivity.map((activity) => ({
        goalId: activity.goalId,
        goalName: activity.goalName,
        activityType: activity.activityType,
        amount: activity.amount === null || activity.progressVisible !== true
          ? null
          : toMoneyDto(activity.amount, activity.goalCurrency),
        createdAt: activity.createdAt?.toISOString() ?? null,
      })),
      upcomingMilestones,
    };
  }
}
