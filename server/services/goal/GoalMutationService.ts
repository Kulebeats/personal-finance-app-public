import { accounts, goals, householdMembers, households, type Account, type Goal, type InsertGoal } from "@shared/schema";
import { Money } from "../../core/money";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { goalRepository } from "../../repositories/GoalRepository";
import { db } from "../../db";
import { householdToday } from "../householdCalendarToday";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import {
  calculateMonthlyProjection,
  calculatePercentComplete,
  calculateProjectedCompletion,
  calculateStatus,
} from "../goalCalculations";
import { goalActivityLogService } from "../GoalActivityLogService";
import { businessAuditService } from "../BusinessAuditService";
import { GoalQueryService } from "./GoalQueryService";
import { readGoalSourceVisibility } from "./GoalViewerProgress";
import { HIDDEN_GOAL_WRITE_REFUSAL } from "./GoalProgressSources";
import { hasAutoSyncAssignments } from "./assignment.calculations";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { can } from "../../core/authz/capabilities";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { deleteGoalWithAudit, insertGoalWithAudit, type GoalAuditRequest } from "./GoalWriteAudit";
// The household row is locked first in each audited write, so the audit
// insert's household FK lock never waits behind rows this transaction holds
// (audit FK lock order, FIN-13).
import { lockAccountHousehold } from "../../repositories/AccountCreationGrant";

const DEBT_ACCOUNT_TYPES = new Set(["credit", "loan"]);

type LinkedGoalType = "investment" | "pay_down";

interface GoalUpdateContext {
  userId: string;
  viewer?: HouseholdContext;
  audit?: { ipAddress?: string };
  tx: TransactionType;
  destination?: Account;
}

/**
 * Lock the account a goal is created against. A-70: with an `actor`, an account
 * that member cannot see is refused exactly like a missing one, so a private
 * loan's balance never becomes another member's goal progress.
 */
async function lockGoalAccount(
  tx: TransactionType, id: string, householdId: string, type: LinkedGoalType, actor?: HouseholdContext,
) {
  const [account] = await tx.select().from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.householdId, householdId), isNull(accounts.deletedAt),
      actor ? visibleAccountPredicate(actor) : undefined)).for("share");
  return requireGoalAccount(account, type);
}

function requireGoalAccount(account: Account | undefined, type: LinkedGoalType, keepExistingLink = false): Account {
  const investment = type === "investment";
  const field = investment ? "linkedAccountId" : "debtAccountId";
  if (!account || (!keepExistingLink && account.isArchived !== false)) {
    throw new ValidationError(investment ? "Linked account not found" : "Debt account not found", [
      { field, message: "Account must belong to this household" },
    ]);
  }
  if (investment ? account.type !== "investment" : !DEBT_ACCOUNT_TYPES.has(account.type)) {
    throw new ValidationError(investment ? "Linked account must be an investment account" : "Debt account must be credit or loan type", [
      { field, message: investment ? "Account type must be 'investment'" : "Invalid account type" },
    ]);
  }
  return account;
}

async function lockGoalEditor(
  tx: TransactionType, householdId: string, userId: string, actor?: HouseholdContext,
): Promise<HouseholdContext | undefined> {
  if (!actor) return;
  if (actor.householdId !== householdId || actor.userId !== userId) {
    throw new ForbiddenError("Financial write access required");
  }
  await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("key share");
  const [grant] = await tx.select({ role: householdMembers.role }).from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId))).for("share");
  if (!grant || !can(grant.role, "financial.write")) throw new ForbiddenError("Financial write access required");
  return { householdId, userId, role: grant.role };
}

function goalAuditValues({ name, targetAmount, currentAmount, status }: Goal) {
  return { name, targetAmount, currentAmount, status };
}

export class GoalMutationService extends GoalQueryService {
  async createGoal(
    data: Omit<InsertGoal, "householdId">,
    householdId: string,
    userId: string,
    /** The member creating over HTTP: the goal's account must be one they can see (A-70). */
    actor?: HouseholdContext,
    /** Request context for the business audit row, written in the same transaction (FIN-13). */
    audit?: GoalAuditRequest,
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

      // NEW-15: an undated goal starts on the household's calendar date, and forecasts count from it.
      const today = await householdToday(db, householdId);
      const startDate = data.startDate ?? today;
      const goal: InsertGoal = {
        ...data,
        householdId,
        createdBy: userId,
        currentAmount: data.currentAmount ?? "0", // Money handles string "0" naturally when loaded
        startDate,
      };

      goal.status = calculateStatus(goal as Goal, undefined, today);
      const monthlyProjection = calculateMonthlyProjection(goal as Goal, today);
      goal.monthlyProjection = monthlyProjection?.toString() ?? null;
      goal.projectedCompletionDate = calculateProjectedCompletion(goal as Goal, today, monthlyProjection);

      const created = await withTransaction(async tx => {
        await lockAccountHousehold(tx, householdId);
        return insertGoalWithAudit(tx, goal, userId, audit);
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

      // NEW-15: an undated goal starts on the household's calendar date, and forecasts count from it.
      const today = await householdToday(db, householdId);
      const startDate = data.startDate ?? today;
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

      goal.status = calculateStatus(goal as Goal, undefined, today);
      const monthlyProjection = calculateMonthlyProjection(goal as Goal, today);
      goal.monthlyProjection = monthlyProjection?.toString() ?? null;
      goal.projectedCompletionDate = calculateProjectedCompletion(goal as Goal, today, monthlyProjection);

      const linkedAccountId = data.linkedAccountId;
      const created = await withTransaction(async tx => {
        await lockAccountHousehold(tx, householdId);
        if (linkedAccountId) {
          const editor = await lockGoalEditor(tx, householdId, userId, actor);
          await lockGoalAccount(tx, linkedAccountId, householdId, "investment", editor);
        }
        return insertGoalWithAudit(tx, goal, userId, audit);
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

      const minimumPayment = new Money(data.minimumPayment ?? 0);
      const monthlyPayment = new Money(data.monthlyPayment ?? 0);
      if (monthlyPayment.lt(minimumPayment)) {
        throw new ValidationError(
          "Monthly payment must be at least the minimum payment"
        );
      }

      // NEW-15: an undated goal starts on the household's calendar date.
      const today = await householdToday(db, householdId);
      const startDate = data.startDate ?? today;
      const debtAccountId = data.debtAccountId;
      const created = await withTransaction(async tx => {
        await lockAccountHousehold(tx, householdId);
        const editor = await lockGoalEditor(tx, householdId, userId, actor);
        const account = await lockGoalAccount(tx, debtAccountId, householdId, "pay_down", editor);
        if (data.currency !== account.currency) {
          throw new ValidationError("Currency mismatch with debt account", [
            { field: "currency", message: `Goal currency must match debt account currency (${account.currency})` },
          ]);
        }
        const debt = new Money(account.balance).abs().toString();
        const goal: InsertGoal = {
          ...data, householdId, createdBy: userId, startDate,
          targetAmount: Money.zero(account.currency).toString(), originalBalance: debt, currentAmount: debt,
        };
        goal.status = calculateStatus(goal as Goal, undefined, today);
        return insertGoalWithAudit(tx, goal, userId, audit);
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
    userId: string,
    /** The member editing over HTTP; system callers omit it. */
    viewer?: HouseholdContext,
    audit?: GoalUpdateContext["audit"],
  ): Promise<Goal> {
    const candidate = await this.getGoalById(id, householdId);
    const link = candidate.type === "pay_down" ? data.debtAccountId :
      candidate.type === "investment" ? data.linkedAccountId : undefined;
    const goal = await withTransaction(async tx => {
      const editor = await lockGoalEditor(tx, householdId, userId, viewer);
      // A relink takes account locks before the goal. A metadata-only edit
      // goes straight to the goal after checking the editor's grant.
      const accountIds = link === undefined ? [] : [candidate.linkedAccountId, candidate.debtAccountId, link]
        .filter((accountId): accountId is string => accountId != null);
      const references = accountIds.length ? await tx.select().from(accounts)
        .where(and(eq(accounts.householdId, householdId), inArray(accounts.id, accountIds)))
        .orderBy(accounts.id).for("share") : [];
      const [existing] = await tx.select().from(goals)
        .where(and(eq(goals.id, id), eq(goals.householdId, householdId))).for("update");
      if (!existing) throw new NotFoundError("Goal not found");
      if (link !== undefined &&
          (existing.linkedAccountId !== candidate.linkedAccountId || existing.debtAccountId !== candidate.debtAccountId)) {
        throw new ConflictError("Goal account changed. Refresh the goal and try again.");
      }
      const destination = link ? references.find(account =>
        account.id === link.toLowerCase() && account.deletedAt === null &&
        (!editor || account.isPrivate === false || account.ownerUserId === editor.userId)) : undefined;
      return this.writeGoalUpdate(existing, data, { userId, viewer: editor, audit, tx, destination });
    });

    logger.info("Goal updated", { householdId });
    return goal;
  }

  private async writeGoalUpdate(
    existing: Goal,
    data: Partial<Goal>,
    { userId, viewer, audit, tx, destination }: GoalUpdateContext,
  ): Promise<Goal> {
    const { id, householdId } = existing;

    if (existing.isArchived) {
      throw new ValidationError("Cannot modify archived goal", [
        { field: "goalId", message: "Goal is archived" },
      ]);
    }

    // #235 M2, R2-5: completion follows progress, so a member who cannot see
    // all of it gets one refusal whether or not the goal is completed.
    if (viewer && (await readGoalSourceVisibility(viewer, [id], tx)).get(id)?.progressVisible !== true) {
      throw new ConflictError(HIDDEN_GOAL_WRITE_REFUSAL);
    }
    if (existing.isCompleted && data.isCompleted !== false) {
      throw new ValidationError("Cannot modify completed goal", [
        { field: "goalId", message: "Goal is completed" },
      ]);
    }

    // Progress is stored in the goal's currency, so a new currency would
    // relabel it (goals QA F2). Changing a goal's currency is not supported.
    if (data.currency !== undefined && data.currency !== existing.currency) {
      throw new ValidationError(existing.type === "pay_down"
        ? "Payment currency must match the existing debt goal"
        : "Target currency must match the goal currency", [
        { field: existing.type === "pay_down" ? "currency" : "targetAmount.currency",
          message: `This goal is in ${existing.currency}` },
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
      const hasAutoSync = await hasAutoSyncAssignments(existing.id, tx);
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

    // Pay-down goals use a zero target; the repayment schedule has its own validation.
    if (merged.type !== "pay_down" && merged.targetAmount) {
      const targetAmount = new Money(merged.targetAmount, merged.currency);
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

    const link = merged.type === "pay_down" ? data.debtAccountId : data.linkedAccountId;
    if (link && (merged.type === "investment" || merged.type === "pay_down")) {
      const priorAccountId = merged.type === "pay_down" ? existing.debtAccountId : existing.linkedAccountId;
      const account = requireGoalAccount(destination, merged.type, priorAccountId === link.toLowerCase());
      if (merged.type === "pay_down" && account.currency !== merged.currency) {
        throw new ValidationError("Currency mismatch with debt account");
      }
    }

    // NEW-15: forecasts count calendar months from the household's calendar date.
    const today = await householdToday(tx, householdId);
    const status = calculateStatus(merged, undefined, today);
    const monthlyProjection = calculateMonthlyProjection(merged, today);
    const projectedCompletionDate = calculateProjectedCompletion(merged, today, monthlyProjection);
    const percentComplete = calculatePercentComplete(merged);

    const patch = {
      ...data,
      status,
      monthlyProjection: monthlyProjection?.toString() ?? null,
      projectedCompletionDate,
      isCompleted: percentComplete >= 100,
      completedAt:
        percentComplete >= 100 && !existing.isCompleted
          ? new Date()
          : existing.completedAt,
    };

    const goal = await goalRepository.update(id, householdId, patch, tx);

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
      tx,
    });

    if (audit) {
      await businessAuditService.logUpdate({
        userId, householdId, entityId: id, entityType: "goal",
        oldValue: goalAuditValues(existing), newValue: goalAuditValues(goal),
        ipAddress: audit.ipAddress, tx,
      });
    }
    return goal;
  }

  async deleteGoal(
    id: string, householdId: string,
    /** The deleting member and request context for the DELETE audit row, written in the same transaction (FIN-13). */
    audit?: GoalAuditRequest & { userId: string },
  ): Promise<void> {
    await withTransaction(tx => deleteGoalWithAudit(tx, id, householdId, audit));

    logger.info("Goal deleted", { householdId });
  }
}
