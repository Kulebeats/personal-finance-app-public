import { and, eq, inArray } from "drizzle-orm";
import {
  goalAccountAssignments,
  holdings,
  securities,
  type Goal,
} from "@shared/schema";
import { db } from "../../db";
import { getLatestFxRates } from "../../core/calculations";
import { Money } from "../../core/money";
import { goalRepository } from "../../repositories/GoalRepository";
import { userRepository } from "../../repositories/UserRepository";
import { NotFoundError } from "../../utils/errorHandler";
import { buildGoalBalanceUpdate } from "../goalCalculations";
import { householdToday } from "../householdCalendarToday";
import {
  assertHouseholdSecurityPriceAvailable,
  householdPricedSecurityColumns,
  householdSecurityPriceEvidence,
  isHouseholdSecurityPriceUnavailable,
} from "../investment/householdSecurityPriceRead";
import { toViewerGoal, type GoalSourceVisibility, type ViewerGoal } from "./GoalViewerProgress";
import type { TransactionType } from "../../utils/withTransaction";
import { CalculationError } from "../../core/calculations/errors";

type DbExecutor = typeof db | TransactionType;

const isMissingFxRate = (error: unknown) => error instanceof CalculationError && error.code === "MISSING_FX_RATE";

export class GoalBaseService {
  async getGoals(
    householdId: string,
    options?: {
      includeArchived?: boolean;
      includeCompleted?: boolean;
      type?: "save_up" | "pay_down" | "investment";
      status?: "on_track" | "behind" | "at_risk" | "completed";
    }
  ): Promise<Goal[]> {
    const goalsList = await goalRepository.findByHousehold(
      householdId,
      options
    );
    const resolved = await Promise.all(
      goalsList.map((goal) => this.applyInvestmentHoldingsProgress(goal))
    );
    return resolved;
  }

  async getGoalById(id: string, householdId: string): Promise<Goal> {
    const goal = await goalRepository.findById(id, householdId);

    if (!goal) {
      throw new NotFoundError("Goal not found");
    }

    return goal;
  }

  protected async hasAutoSyncAssignments(goalId: string) {
    const assignments = await db
      .select()
      .from(goalAccountAssignments)
      .where(eq(goalAccountAssignments.goalId, goalId));

    return assignments.some(
      (assignment) =>
        assignment.assignmentType === "full_balance" && assignment.autoUpdate
    );
  }

  protected async getUserTimezone(userId: string): Promise<string> {
    const settings = await userRepository.getDisplaySettings(userId);
    if (settings?.timezone) {
      return settings.timezone;
    }

    const user = await userRepository.findById(userId);
    return user?.timezone ?? "UTC";
  }

  protected getTodayInTimezone(timezone: string): Date {
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: timezone,
    });
    return new Date(`${today}T00:00:00Z`);
  }

  protected async applyInvestmentHoldingsProgress(goal: Goal): Promise<Goal> {
    if (goal.type !== "investment" || goal.progressSource !== "holdings") {
      return goal;
    }

    const holdingsTotal = await this.calculateHoldingsValue(goal);
    // NEW-15: the forecast counts from the household's calendar date.
    const update = buildGoalBalanceUpdate(goal, holdingsTotal, await householdToday(db, goal.householdId));

    return {
      ...goal,
      currentAmount: update.currentAmount,
      status: update.status,
      monthlyProjection: update.monthlyProjection,
      projectedCompletionDate: update.projectedCompletionDate,
      isCompleted: update.isCompleted,
      completedAt: update.completedAt,
    };
  }

  /**
   * One goal as this viewer may see it, with its live progress (`valued`) when
   * that is shown. A-04: a goal whose sources are hidden is never valued, so a
   * hidden holding's price, rate or currency can neither reach the response nor
   * fail it. A-30: a visible holdings goal with no usable price shows
   * "unavailable" progress, never zero. NEW-15: so does one priced in a
   * currency with no rate to the goal's, and neither gets a forecast number.
   */
  protected async valueGoalForViewer(
    goal: Goal,
    visibility: GoalSourceVisibility,
  ): Promise<{ viewer: ViewerGoal<Goal>; valued: Goal | null }> {
    if (!visibility.progressVisible) return { viewer: toViewerGoal(goal, visibility), valued: null };
    try {
      const valued = await this.applyInvestmentHoldingsProgress(goal);
      return { viewer: toViewerGoal(valued, visibility), valued };
    } catch (error) {
      if (!isHouseholdSecurityPriceUnavailable(error) && !isMissingFxRate(error)) throw error;
      return { viewer: toViewerGoal(goal, { ...visibility, progressVisible: false }), valued: null };
    }
  }

  protected async resolveInvestmentGoalAccount(goal: Goal, tx?: TransactionType) {
    if (goal.linkedAccountId) return goal.linkedAccountId;

    const executor: DbExecutor = tx ?? db;
    const [assignment] = await executor
      .select({ accountId: goalAccountAssignments.accountId })
      .from(goalAccountAssignments)
      .where(eq(goalAccountAssignments.goalId, goal.id))
      .limit(1);

    return assignment?.accountId ?? null;
  }

  protected async calculateHoldingsValue(
    goal: Goal,
    tx?: TransactionType
  ): Promise<Money> {
    const executor: DbExecutor = tx ?? db;
    const assignments = await executor
      .select()
      .from(goalAccountAssignments)
      .where(eq(goalAccountAssignments.goalId, goal.id));

    const accountIds: string[] = assignments.map(
      (assignment: { accountId: string | null }) => String(assignment.accountId)
    );
    if (accountIds.length === 0 && goal.linkedAccountId) {
      accountIds.push(goal.linkedAccountId);
    }

    if (accountIds.length === 0) {
      return Money.zero(goal.currency || "ZMW");
    }

    const results = await executor
      .select({
        holding: holdings,
        security: householdPricedSecurityColumns(goal.householdId),
        priceEvidence: householdSecurityPriceEvidence(goal.householdId),
      })
      .from(holdings)
      .innerJoin(securities, eq(holdings.securityId, securities.id))
      .where(
        and(
          eq(holdings.householdId, goal.householdId),
          inArray(holdings.accountId, accountIds)
        )
      );

    const baseCurrency = (goal.currency || "ZMW").toUpperCase();
    const currencies: string[] = Array.from(
      new Set(
        results
          .map(({ security }: { security: { currency?: string | null } }) =>
            (security.currency || baseCurrency).toUpperCase()
          )
          .filter((currency: string) => currency !== baseCurrency)
      )
    );
    // A-30: the holdings screen's price-evidence check, before any rate is read.
    for (const { holding, priceEvidence } of results) {
      assertHouseholdSecurityPriceAvailable(priceEvidence, holding.quantity);
    }
    const fxRatesByCurrency = await getLatestFxRates(currencies, baseCurrency, goal.householdId);

    let totalValue = Money.zero(baseCurrency);
    for (const { holding, security } of results) {
      const currency = (security.currency || baseCurrency).toUpperCase();
      // After the check above, only a zero-share position can lack a price.
      const price = new Money(security.currentPrice ?? "0");
      // Quantity is a share count, not money: it stays a decimal string into Decimal
      // multiplication. A float keeps ~17 significant digits and loses cents (P2).
      const localValue = price.multiply(holding.quantity ?? "0");

      // R12: the household's own rate, else the shared rate. A missing rate is
      // a typed error, never 1 and never the stale acquisition rate (D11).
      const fxRate = currency === baseCurrency ? 1 : fxRatesByCurrency.get(currency);
      if (fxRate === undefined) {
        throw new CalculationError("MISSING_FX_RATE", { from: currency, to: baseCurrency, householdId: goal.householdId },
          `Exchange rate unavailable for ${currency} -> ${baseCurrency}`);
      }

      totalValue = totalValue.add(localValue.multiply(fxRate));
    }

    return totalValue;
  }
}
