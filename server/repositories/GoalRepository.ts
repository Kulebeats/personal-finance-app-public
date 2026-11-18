import { db } from "../db";
import {
  goals,
  goalContributions,
  type Goal,
  type InsertGoal,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { withTransaction } from "../utils/withTransaction";
import { Money } from "../core/money";

/**
 * GoalRepository
 *
 * Data access layer for savings goals.
 */
export class GoalRepository {
  /**
   * Find all goals for a household
   */
  async findByHousehold(
    householdId: string,
    options?: {
      includeArchived?: boolean;
      includeCompleted?: boolean;
      type?: "save_up" | "pay_down" | "investment";
      status?: "on_track" | "behind" | "at_risk" | "completed";
    }
  ): Promise<Goal[]> {
    const conditions = [eq(goals.householdId, householdId)];

    if (options?.type) {
      conditions.push(eq(goals.type, options.type));
    }

    if (options?.status) {
      conditions.push(eq(goals.status, options.status));
    }

    if (!options?.includeArchived) {
      conditions.push(eq(goals.isArchived, false));
    }

    if (!options?.includeCompleted) {
      conditions.push(eq(goals.isCompleted, false));
    }

    return await db
      .select()
      .from(goals)
      .where(and(...conditions))
      .orderBy(goals.createdAt);
  }

  /**
   * Find a goal by ID
   */
  async findById(id: string, householdId: string): Promise<Goal | undefined> {
    const [goal] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.id, id), eq(goals.householdId, householdId)))
      .limit(1);

    return goal;
  }

  /**
   * Create a new goal
   */
  async create(data: InsertGoal): Promise<Goal> {
    const [goal] = await db.insert(goals).values(data).returning();
    return goal;
  }

  /**
   * Update a goal
   */
  async update(
    id: string,
    householdId: string,
    data: Partial<Goal>
  ): Promise<Goal | undefined> {
    const [goal] = await db
      .update(goals)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(goals.id, id), eq(goals.householdId, householdId)))
      .returning();

    return goal;
  }

  /**
   * Delete a goal (hard delete)
   */
  async delete(id: string, householdId: string): Promise<boolean> {
    const result = await db
      .delete(goals)
      .where(and(eq(goals.id, id), eq(goals.householdId, householdId)))
      .returning({ id: goals.id });

    return result.length > 0;
  }

  /**
   * Add a contribution to a goal
   */
  async addContribution(
    goalId: string,
    householdId: string,
    amount: number,
    options?: { date?: string; notes?: string; transactionId?: string }
  ): Promise<{
    goal: Goal;
    contribution: typeof goalContributions.$inferSelect;
  }> {
    return await withTransaction(async (tx) => {
      // Get current goal
      const [currentGoal] = await tx
        .select()
        .from(goals)
        .where(and(eq(goals.id, goalId), eq(goals.householdId, householdId)))
        .limit(1);

      if (!currentGoal) {
        throw new Error("Goal not found");
      }

      // Calculate new amount using Money class for precision
      const currentAmountMoney = new Money(currentGoal.currentAmount);
      const newAmountMoney = currentAmountMoney.add(amount);
      const targetAmountMoney = new Money(currentGoal.targetAmount);

      // Check if goal is completed using Money comparison
      const isCompleted = newAmountMoney.gte(targetAmountMoney);

      // Update goal
      const [updatedGoal] = await tx
        .update(goals)
        .set({
          currentAmount: newAmountMoney.toString(),
          isCompleted,
          completedAt: isCompleted ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(goals.id, goalId))
        .returning();

      // Create contribution record
      const contributionMoney = new Money(amount);
      const [contribution] = await tx
        .insert(goalContributions)
        .values({
          goalId,
          amount: contributionMoney.toString(),
          date: options?.date || new Date().toISOString().split("T")[0],
          notes: options?.notes,
          transactionId: options?.transactionId,
        })
        .returning();

      return { goal: updatedGoal, contribution };
    });
  }

  /**
   * Get contribution history for a goal
   */
  async getContributions(
    goalId: string
  ): Promise<Array<typeof goalContributions.$inferSelect>> {
    return await db
      .select()
      .from(goalContributions)
      .where(eq(goalContributions.goalId, goalId))
      .orderBy(goalContributions.date);
  }

  /**
   * Archive a goal
   */
  async archive(id: string, householdId: string): Promise<Goal | undefined> {
    return this.update(id, householdId, {
      isArchived: true,
      archivedAt: new Date(),
    });
  }

  /**
   * Unarchive a goal
   */
  async unarchive(id: string, householdId: string): Promise<Goal | undefined> {
    return this.update(id, householdId, { isArchived: false, archivedAt: null });
  }
}

// Export singleton instance
export const goalRepository = new GoalRepository();
