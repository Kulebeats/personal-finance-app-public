import { eq } from "drizzle-orm";
import { categories, categoryGroups, households } from "@shared/schema";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_GROUPS,
  DEFAULT_GROUP_COLORS,
} from "./config/defaultCategories";
import { ConflictError, NotFoundError } from "./core/errors";
import { withTransaction, type TransactionType } from "./utils/withTransaction";

/**
 * First-run defaults only: an existing category tree belongs to the user, even
 * when renamed, archived or soft-deleted. Without seed provenance we cannot
 * identify missing defaults safely, so this operation never repairs that tree.
 */
async function seedInTransaction(householdId: string, tx: TransactionType) {
  // The parent row is a stable lock anchor even when both child tables are
  // empty. All seed callers take this lock before checking or inserting rows.
  const [household] = await tx.select({ id: households.id }).from(households)
    .where(eq(households.id, householdId)).for("update");
  if (!household) throw new NotFoundError("Household not found");

  const existingCategories = await tx.select({ id: categories.id }).from(categories)
    .where(eq(categories.householdId, householdId)).limit(1);
  if (existingCategories.length > 0) return;

  const existingGroups = await tx.select({ id: categoryGroups.id }).from(categoryGroups)
    .where(eq(categoryGroups.householdId, householdId)).limit(1);
  if (existingGroups.length > 0) {
    throw new ConflictError("Existing category groups require explicit setup");
  }

  const createdGroups = await tx.insert(categoryGroups).values(
    DEFAULT_CATEGORY_GROUPS.map((group) => ({ householdId, ...group })),
  ).returning();
  const groupIds = new Map(createdGroups.map((group) => [group.name, group.id]));

  await tx.insert(categories).values(DEFAULT_CATEGORIES.map((category, index) => {
    const groupId = groupIds.get(category.group);
    if (!groupId) throw new Error("Default category group configuration is inconsistent");
    return {
      householdId,
      groupId,
      name: category.name,
      icon: category.icon || null,
      color: DEFAULT_GROUP_COLORS[category.group] || "#6B7280",
      includeInBudget: category.group !== "Transfers & Adjustments",
      rolloverEnabled: false,
      rolloverStartBalance: null,
      isArchived: false,
      displayOrder: index + 1,
    };
  }));
}

/** Reuse the caller's transaction, or make standalone seeding atomic. */
export async function seedDefaultCategories(householdId: string, tx?: TransactionType) {
  if (tx) return seedInTransaction(householdId, tx);
  return withTransaction((transaction) => seedInTransaction(householdId, transaction));
}
