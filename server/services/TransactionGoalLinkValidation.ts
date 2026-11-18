/**
 * Transaction Goal Link Validation
 *
 * Validation logic for linking transactions to goals.
 * Split from TransactionGoalLinkService to maintain LOC limits.
 *
 * @module services/TransactionGoalLinkValidation
 */

import { db } from "../db";
import {
  categories,
  categoryGroups,
  goalAccountAssignments,
  tags,
  transactionTags,
  type Goal,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { ValidationError } from "../utils/errorHandler";

/**
 * Check if a goal has auto-sync assignments
 */
export async function hasAutoSyncAssignments(goalId: string): Promise<boolean> {
  const assignments = await db
    .select()
    .from(goalAccountAssignments)
    .where(eq(goalAccountAssignments.goalId, goalId));

  return assignments.some(
    (assignment) =>
      assignment.assignmentType === "full_balance" && assignment.autoUpdate
  );
}

/**
 * Validate that a transaction can be linked to a goal
 */
export async function validateTransactionLink(
  goal: Goal,
  transaction: {
    id: string;
    type: string;
    amount: string;
    categoryId?: string | null;
    notes?: string | null;
  },
  linkType: "contribution" | "spending"
): Promise<void> {
  const hasAutoSync = await hasAutoSyncAssignments(goal.id);
  if (hasAutoSync) {
    throw new ValidationError(
      "Cannot link transactions to goals with auto-synced accounts"
    );
  }

  if (transaction.type === "transfer") {
    throw new ValidationError(
      "Transfer transactions cannot be linked to goals. Use goal transfers instead."
    );
  }

  if (linkType === "spending") {
    if (transaction.type !== "expense") {
      throw new ValidationError("Only expense transactions can be linked as spending");
    }

    if (!goal.spendingReducesProgress) {
      throw new ValidationError(
        "Goal does not allow spending to reduce progress"
      );
    }
  }

  if (linkType === "contribution") {
    if (transaction.type === "expense") {
      const isGoalContribution = await isGoalContributionTransaction(
        transaction,
        goal.householdId
      );
      if (!isGoalContribution) {
        throw new ValidationError(
          "Expense transactions can only be linked as contributions when flagged as goal contributions"
        );
      }
    }
  }
}

/**
 * Check if a transaction is flagged as a goal contribution
 * (via notes, category, or tags)
 */
export async function isGoalContributionTransaction(
  transaction: {
    id: string;
    categoryId?: string | null;
    notes?: string | null;
  },
  householdId: string
): Promise<boolean> {
  const notes = (transaction.notes || "").toLowerCase();
  if (
    notes.includes("goal contribution") ||
    notes.includes("goal_contribution") ||
    notes.includes("goal:")
  ) {
    return true;
  }

  if (transaction.categoryId) {
    const [categoryRow] = await db
      .select({
        categoryName: categories.name,
        groupName: categoryGroups.name,
      })
      .from(categories)
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(
        and(
          eq(categories.id, transaction.categoryId),
          eq(categories.householdId, householdId)
        )
      )
      .limit(1);

    const categoryText = `${categoryRow?.categoryName ?? ""} ${
      categoryRow?.groupName ?? ""
    }`.toLowerCase();
    if (
      categoryText.includes("goal") ||
      categoryText.includes("savings") ||
      categoryText.includes("invest")
    ) {
      return true;
    }
  }

  const tagRows = await db
    .select({ name: tags.name })
    .from(transactionTags)
    .innerJoin(tags, eq(transactionTags.tagId, tags.id))
    .where(
      and(
        eq(transactionTags.transactionId, transaction.id),
        eq(tags.householdId, householdId)
      )
    );

  return tagRows.some((tag) => {
    const name = tag.name.toLowerCase();
    return name.includes("goal") || name.includes("contribution");
  });
}
