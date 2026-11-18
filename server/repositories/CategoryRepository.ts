import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import { categories, type Category, type InsertCategory } from "@shared/schema";
import { withTransaction } from "../utils/withTransaction";

/**
 * CategoryRepository
 *
 * Provides typed query builders for category operations.
 * Uses parameterized queries to prevent SQL injection.
 * Centralizes category-related database operations.
 */
export class CategoryRepository {
  /**
   * Find all categories for a household, ordered by display order
   */
  async findByHousehold(householdId: string): Promise<Category[]> {
    return await db
      .select()
      .from(categories)
      .where(eq(categories.householdId, householdId))
      .orderBy(categories.displayOrder);
  }

  /**
   * Find a single category by ID, scoped to a household.
   *
   * SCP-335: householdId is required so a category can never be read across
   * household boundaries. Use findByIdAndHousehold for the same guarantee with
   * the conventional name.
   */
  async findById(
    id: string,
    householdId: string,
  ): Promise<Category | undefined> {
    const result = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
      .limit(1);
    return result[0];
  }

  /**
   * Find a category by ID within a specific household
   */
  async findByIdAndHousehold(
    id: string,
    householdId: string,
  ): Promise<Category | undefined> {
    const result = await db
      .select()
      .from(categories)
      .where(
        and(eq(categories.id, id), eq(categories.householdId, householdId)),
      )
      .limit(1);
    return result[0];
  }

  /**
   * TODO-015: Find a category by name within a household (case-insensitive)
   * Used for CSV import to resolve category names to IDs.
   */
  async findByNameInHousehold(
    name: string,
    householdId: string,
  ): Promise<Category | undefined> {
    const result = await db
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.householdId, householdId),
          sql`LOWER(${categories.name}) = LOWER(${name})`,
        ),
      )
      .limit(1);
    return result[0];
  }

  /**
   * Create a new category
   */
  async create(data: InsertCategory): Promise<Category> {
    const result = await db.insert(categories).values(data).returning();
    return result[0];
  }

  /**
   * Update an existing category, scoped to a household.
   *
   * SCP-335: householdId is required and added to the WHERE clause so an update
   * can never touch another household's category, even if a stale or spoofed id
   * is supplied.
   */
  async update(
    id: string,
    householdId: string,
    data: Partial<Category>,
  ): Promise<Category | undefined> {
    const result = await db
      .update(categories)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
      .returning();
    return result[0];
  }

  /**
   * Delete a category (soft delete by setting deletedAt), scoped to a household.
   */
  async delete(id: string, householdId: string): Promise<void> {
    await db
      .update(categories)
      .set({ deletedAt: new Date(), isArchived: true })
      .where(
        and(eq(categories.id, id), eq(categories.householdId, householdId)),
      );
  }

  /**
   * Hard delete a category (permanent removal), scoped to a household.
   */
  async hardDelete(id: string, householdId: string): Promise<void> {
    await db
      .delete(categories)
      .where(
        and(eq(categories.id, id), eq(categories.householdId, householdId)),
      );
  }

  /**
   * Reorder categories atomically
   * Updates display order for multiple categories in a single transaction
   */
  async reorder(householdId: string, orderedIds: string[]): Promise<void> {
    // Use transaction wrapper utility for automatic rollback
    await withTransaction(async (tx) => {
      // Update each category's display order
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(categories)
          .set({ displayOrder: i, updatedAt: new Date() })
          .where(
            and(
              eq(categories.id, orderedIds[i]),
              eq(categories.householdId, householdId),
            ),
          );
      }
    });
  }

  /**
   * Archive a category, scoped to a household.
   */
  async archive(
    id: string,
    householdId: string,
  ): Promise<Category | undefined> {
    const result = await db
      .update(categories)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
      .returning();
    return result[0];
  }

  /**
   * Unarchive a category, scoped to a household.
   */
  async unarchive(
    id: string,
    householdId: string,
  ): Promise<Category | undefined> {
    const result = await db
      .update(categories)
      .set({ isArchived: false, updatedAt: new Date() })
      .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
      .returning();
    return result[0];
  }

  /**
   * Get categories by group, scoped to a household.
   *
   * SCP-335: householdId is required so a caller cannot enumerate another
   * household's categories by guessing a group id.
   */
  async findByGroup(
    groupId: string,
    householdId: string,
  ): Promise<Category[]> {
    return await db
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.groupId, groupId),
          eq(categories.householdId, householdId),
        ),
      )
      .orderBy(categories.displayOrder);
  }

  /**
   * Count categories in a household
   */
  async countByHousehold(householdId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(categories)
      .where(
        and(
          eq(categories.householdId, householdId),
          eq(categories.isArchived, false),
        ),
      );
    return Number(result[0]?.count ?? 0);
  }
}

// Export singleton instance
export const categoryRepository = new CategoryRepository();
