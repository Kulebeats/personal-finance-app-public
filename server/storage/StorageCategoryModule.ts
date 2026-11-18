import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  categories,
  categoryGroups,
  type Category,
  type InsertCategory,
} from "@shared/schema";
import { StorageHouseholdModule } from "./StorageHouseholdModule";

export class StorageCategoryModule extends StorageHouseholdModule {
  // ============================================================================
  // CATEGORY METHODS
  // ============================================================================

  async getCategoriesByHousehold(householdId: string): Promise<Category[]> {
    return await db
      .select()
      .from(categories)
      .where(eq(categories.householdId, householdId))
      .orderBy(categories.displayOrder);
  }

  async createCategory(insertCategory: InsertCategory): Promise<Category> {
    const result = await db
      .insert(categories)
      .values(insertCategory)
      .returning();
    return result[0];
  }

  async updateCategory(
    id: string,
    data: Partial<Category>
  ): Promise<Category | undefined> {
    const result = await db
      .update(categories)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(categories.id, id))
      .returning();
    return result[0];
  }

  async deleteCategory(id: string): Promise<void> {
    await db.delete(categories).where(eq(categories.id, id));
  }

  // ============================================================================
  // CATEGORY GROUP METHODS
  // ============================================================================

  async getCategoryGroups(householdId: string) {
    return await db
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.householdId, householdId))
      .orderBy(categoryGroups.displayOrder);
  }

  async createCategoryGroup(data: {
    householdId: string;
    name: string;
    type: string;
    displayOrder: number;
    budgetMode?: string;
    rolloverEnabled?: boolean;
    isArchived?: boolean;
  }) {
    const result = await db
      .insert(categoryGroups)
      .values({
        householdId: data.householdId,
        name: data.name,
        type: data.type,
        displayOrder: data.displayOrder,
        budgetMode: data.budgetMode ?? "by_category",
        rolloverEnabled: data.rolloverEnabled ?? false,
        isArchived: data.isArchived ?? false,
      })
      .returning();
    return result[0];
  }

  async updateCategoryGroup(
    id: string,
    data: Partial<{
      name: string;
      type: string;
      displayOrder: number;
      budgetMode: string;
      rolloverEnabled: boolean;
      isArchived: boolean;
    }>
  ) {
    const result = await db
      .update(categoryGroups)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(categoryGroups.id, id))
      .returning();
    return result[0];
  }
}
