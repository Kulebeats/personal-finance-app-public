import type { Goal, InsertGoal } from "@shared/schema";
import { Money } from "../../core/money";
import { accountRepository } from "../../repositories/AccountRepository";
import { goalRepository } from "../../repositories/GoalRepository";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import {
  calculateMonthlyProjection,
  calculatePercentComplete,
  calculateProjectedCompletion,
  calculateStatus,
} from "../goalCalculations";
import { goalActivityLogService } from "../GoalActivityLogService";
import { GoalQueryService } from "./GoalQueryService";

const DEBT_ACCOUNT_TYPES = new Set(["credit", "loan"]);

export class GoalMutationService extends GoalQueryService {
  async createGoal(
    data: Omit<InsertGoal, "householdId">,
    householdId: string,
    userId: string
  ): Promise<Goal> {
    if (data.type === "save_up") {
      const targetAmount = new Money(data.targetAmount);
      if (targetAmount.isNegative() || targetAmount.isZero()) {
        throw new ValidationError("Invalid target amount", [
          { field: "targetAmount", message: "Must be a positive number" },
        ]);
      }

      if (data.targetDate && data.startDate) {
        const startDate = new Date(data.startDate);
        const targetDate = new Date(data.targetDate);
        if (targetDate <= startDate) {
          throw new ValidationError("Invalid target date", [
            { field: "targetDate", message: "Must be after start date" },
          ]);
        }
      }

      const startDate =
        data.startDate ?? new Date().toISOString().split("T")[0];
      const goal: InsertGoal = {
        ...data,
        householdId,
        createdBy: userId,
        currentAmount: data.currentAmount ?? "0", // Money handles string "0" naturally when loaded
        startDate,
      };

      goal.status = calculateStatus(goal as Goal);
      goal.monthlyProjection =
        calculateMonthlyProjection(goal as Goal)?.toFixed(2) ?? null;
      goal.projectedCompletionDate = calculateProjectedCompletion(goal as Goal);

      const created = await goalRepository.create(goal);

      await goalActivityLogService.log({
        goalId: created.id,
        activityType: "goal_created",
        metadata: {
          initialTarget: created.targetAmount,
          initialDate: created.targetDate,
        },
        createdBy: userId,
      });

      logger.info("Goal created", { householdId });
      return created;
    }

    if (data.type === "investment") {
      const targetAmount = new Money(data.targetAmount);
      if (targetAmount.isNegative() || targetAmount.isZero()) {
        throw new ValidationError("Invalid target amount", [
          { field: "targetAmount", message: "Must be a positive number" },
        ]);
      }

      // FIX DATA-GOAL-003: Validate linkedAccountId belongs to household
      if (data.linkedAccountId) {
        const linkedAccount = await accountRepository.findById(
          data.linkedAccountId,
          householdId
        );
        if (!linkedAccount) {
          throw new ValidationError("Linked account not found", [
            {
              field: "linkedAccountId",
              message: "Account must belong to this household",
            },
          ]);
        }
        // Optionally validate it's an investment account
        if (linkedAccount.type !== "investment") {
          throw new ValidationError("Linked account must be an investment account", [
            {
              field: "linkedAccountId",
              message: "Account type must be 'investment'",
            },
          ]);
        }
      }

      const expectedReturn = data.expectedReturn
        ? Number(data.expectedReturn)
        : 0;
      const inflationRate = data.inflationRate
        ? Number(data.inflationRate)
        : 0;

      if (!Number.isFinite(expectedReturn) || expectedReturn < 0 || expectedReturn > 100) {
        throw new ValidationError("Return rate must be between 0 and 100");
      }
      if (!Number.isFinite(inflationRate) || inflationRate < 0 || inflationRate > 100) {
        throw new ValidationError("Inflation rate must be between 0 and 100");
      }

      const startDate =
        data.startDate ?? new Date().toISOString().split("T")[0];
      const progressSource = data.progressSource ?? "holdings";
      const goal: InsertGoal = {
        ...data,
        householdId,
        createdBy: userId,
        currentAmount: data.currentAmount ?? "0",
        startDate,
        expectedReturn: expectedReturn.toFixed(2),
        inflationRate: inflationRate.toFixed(2),
        progressSource,
      };

      goal.status = calculateStatus(goal as Goal);
      goal.monthlyProjection =
        calculateMonthlyProjection(goal as Goal)?.toFixed(2) ?? null;
      goal.projectedCompletionDate = calculateProjectedCompletion(goal as Goal);

      const created = await goalRepository.create(goal);

      await goalActivityLogService.log({
        goalId: created.id,
        activityType: "goal_created",
        metadata: {
          initialTarget: created.targetAmount,
          initialDate: created.targetDate,
        },
        createdBy: userId,
      });

      logger.info("Investment goal created", { householdId });
      return created;
    }

    if (data.type === "pay_down") {
      // FIX DATA-GOAL-002: Fetch debt account to derive target/current amounts from balance
      if (!data.debtAccountId) {
        throw new ValidationError("Debt account is required for pay_down goals", [
          { field: "debtAccountId", message: "Debt account ID is required" },
        ]);
      }

      const account = await accountRepository.findById(
        data.debtAccountId,
        householdId
      );
      if (!account) {
        throw new ValidationError("Debt account not found", [
          { field: "debtAccountId", message: "Account must belong to this household" },
        ]);
      }
      if (!DEBT_ACCOUNT_TYPES.has(account.type)) {
        throw new ValidationError("Debt account must be credit or loan type", [
          { field: "debtAccountId", message: "Invalid account type" },
        ]);
      }

      // FIX DATA-GOAL-001: Validate currency matches debt account
      if (data.currency !== account.currency) {
        throw new ValidationError("Currency mismatch with debt account", [
          {
            field: "currency",
            message: `Goal currency must match debt account currency (${account.currency})`,
          },
        ]);
      }

      // FIX DATA-GOAL-002: Derive amounts from debt account balance
      // Debt accounts have negative balances, so we use abs value
      const debtBalance = new Money(account.balance || "0");
      const absoluteDebt = debtBalance.abs();

      // For pay_down goals:
      // - originalBalance: initial debt (abs of current balance)
      // - targetAmount: 0 (goal is to reach zero debt)
      // - currentAmount: current debt (abs of current balance)
      const targetAmount = Money.zero(account.currency);
      const originalBalance = absoluteDebt;
      const currentAmount = absoluteDebt;

      const minimumPayment = new Money(data.minimumPayment ?? 0);
      const monthlyPayment = new Money(data.monthlyPayment ?? 0);
      if (monthlyPayment.lt(minimumPayment)) {
        throw new ValidationError(
          "Monthly payment must be at least the minimum payment"
        );
      }

      const startDate =
        data.startDate ?? new Date().toISOString().split("T")[0];
      const goal: InsertGoal = {
        ...data,
        householdId,
        createdBy: userId,
        targetAmount: targetAmount.toString(),
        originalBalance: originalBalance.toString(),
        currentAmount: currentAmount.toString(),
        startDate,
      };

      goal.status = calculateStatus(goal as Goal);

      const created = await goalRepository.create(goal);

      await goalActivityLogService.log({
        goalId: created.id,
        activityType: "goal_created",
        metadata: {
          initialTarget: created.targetAmount,
          initialDate: created.targetDate,
        },
        createdBy: userId,
      });

      logger.info("Pay down goal created", { householdId });
      return created;
    }

    throw new ValidationError("Invalid goal type");
  }

  async updateGoal(
    id: string,
    data: Partial<Goal>,
    householdId: string,
    userId: string
  ): Promise<Goal> {
    const existing = await this.getGoalById(id, householdId);

    if (existing.isArchived) {
      throw new ValidationError("Cannot modify archived goal", [
        { field: "goalId", message: "Goal is archived" },
      ]);
    }

    if (existing.isCompleted && data.isCompleted !== false) {
      throw new ValidationError("Cannot modify completed goal", [
        { field: "goalId", message: "Goal is completed" },
      ]);
    }

    if (data.type && data.type !== existing.type) {
      throw new ValidationError("Cannot change goal type");
    }

    if (data.currentAmount !== undefined) {
      throw new ValidationError("Cannot directly modify current amount", [
        { field: "currentAmount", message: "Use contribution or transfer endpoints" },
      ]);
    }

    if (data.spendingReducesProgress && existing.type === "save_up") {
      const hasAutoSync = await this.hasAutoSyncAssignments(existing.id);
      if (hasAutoSync) {
        throw new ValidationError(
          "Cannot enable spending reduces progress with auto-synced accounts"
        );
      }
    }

    const merged = { ...existing, ...data } as Goal;

    if (merged.targetDate && merged.startDate) {
      const startDate = new Date(merged.startDate);
      const targetDate = new Date(merged.targetDate);
      if (targetDate <= startDate) {
        throw new ValidationError("Invalid target date", [
          { field: "targetDate", message: "Must be after start date" },
        ]);
      }
    }

    if (merged.type === "pay_down" && data.debtAccountId) {
      const account = await accountRepository.findById(
        data.debtAccountId,
        householdId
      );
      if (!account) {
        throw new ValidationError("Debt account not found", [
          { field: "debtAccountId", message: "Account must belong to this household" },
        ]);
      }
      if (!DEBT_ACCOUNT_TYPES.has(account.type)) {
        throw new ValidationError("Debt account must be credit or loan type", [
          { field: "debtAccountId", message: "Invalid account type" },
        ]);
      }
    }

    if (merged.targetAmount) {
      const targetAmount = new Money(merged.targetAmount);
      if (targetAmount.isNegative() || targetAmount.isZero()) {
        throw new ValidationError("Invalid target amount", [
          { field: "targetAmount", message: "Must be a positive number" },
        ]);
      }
    }

    if (merged.type === "pay_down") {
      const minimumPayment = new Money(merged.minimumPayment ?? 0);
      const monthlyPayment = new Money(merged.monthlyPayment ?? 0);
      if (monthlyPayment.lt(minimumPayment)) {
        throw new ValidationError(
          "Monthly payment must be at least the minimum payment"
        );
      }
    }

    const status = calculateStatus(merged);
    const monthlyProjection = calculateMonthlyProjection(merged);
    const projectedCompletionDate = calculateProjectedCompletion(
      merged,
      monthlyProjection ?? undefined
    );
    const percentComplete = calculatePercentComplete(merged);

    const goal = await goalRepository.update(id, householdId, {
      ...data,
      status,
      monthlyProjection:
        monthlyProjection !== null ? monthlyProjection.toFixed(2) : null,
      projectedCompletionDate,
      isCompleted: percentComplete >= 100,
      completedAt:
        percentComplete >= 100 && !existing.isCompleted
          ? new Date()
          : existing.completedAt,
    });

    if (!goal) {
      throw new NotFoundError("Goal not found");
    }

    const updateFields = Object.keys(data);
    const previousValues = updateFields.reduce<Record<string, unknown>>(
      (acc, field) => {
        acc[field] = (existing as Record<string, unknown>)[field];
        return acc;
      },
      {}
    );

    await goalActivityLogService.log({
      goalId: goal.id,
      activityType: "goal_updated",
      metadata: { fields: updateFields, previousValues },
      createdBy: userId,
    });

    logger.info("Goal updated", { householdId });

    return goal;
  }

  async deleteGoal(id: string, householdId: string): Promise<void> {
    const deleted = await goalRepository.delete(id, householdId);

    if (!deleted) {
      throw new NotFoundError("Goal not found");
    }

    logger.info("Goal deleted", { householdId });
  }
}
