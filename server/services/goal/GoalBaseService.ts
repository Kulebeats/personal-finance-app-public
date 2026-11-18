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
import type { TransactionType } from "../../utils/withTransaction";

type DbExecutor = typeof db | TransactionType;

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
    const update = buildGoalBalanceUpdate(goal, holdingsTotal);

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
      .select({ holding: holdings, security: securities })
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
    const fxRatesByCurrency = await getLatestFxRates(currencies, baseCurrency);

    let totalValue = Money.zero(baseCurrency);
    for (const { holding, security } of results) {
      const currency = (security.currency || baseCurrency).toUpperCase();
      const quantity = parseFloat(holding.quantity ?? "0"); // Quantity is share count, not currency
      const price = new Money(security.currentPrice ?? "0");
      const localValue = price.multiply(quantity);

      const fxRate =
        currency === baseCurrency
          ? 1
          : fxRatesByCurrency.get(currency) ??
            (holding.acquisitionFxRate
              ? parseFloat(String(holding.acquisitionFxRate))
              : 1);

      totalValue = totalValue.add(localValue.multiply(fxRate));
    }

    return totalValue;
  }
}
