import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  categoryGroups,
  type CategoryGroup,
  type InsertCategoryGroup,
} from "@shared/schema";
import { withTransaction } from "../utils/withTransaction";
import { NotFoundError } from "../core/errors";

export class CategoryGroupRepository {
  async findByHousehold(householdId: string): Promise<CategoryGroup[]> {
    return await db
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.householdId, householdId))
      .orderBy(categoryGroups.displayOrder);
  }

  async findByIdAndHousehold(
    id: string,
    householdId: string
  ): Promise<CategoryGroup | undefined> {
    const result = await db
      .select()
      .from(categoryGroups)
      .where(
        and(
          eq(categoryGroups.id, id),
          eq(categoryGroups.householdId, householdId)
        )
      )
      .limit(1);
    return result[0];
  }

  async create(data: InsertCategoryGroup): Promise<CategoryGroup> {
    const result = await db.insert(categoryGroups).values(data).returning();
    return result[0];
  }

  async update(
    id: string,
    data: Partial<CategoryGroup>
  ): Promise<CategoryGroup | undefined> {
    const result = await db
      .update(categoryGroups)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(categoryGroups.id, id))
      .returning();
    return result[0];
  }

  /**
   * Reorder category groups atomically within a household.
   *
   * SCP-335: previously the controller looped findByIdAndHousehold + update
   * with no transaction, so a failure mid-loop left a partially reordered set.
   * This wraps every ownership re-check and displayOrder write in one
   * transaction (rolls back on any error) and scopes each write by householdId
   * so a caller cannot reorder another household's groups.
   */
  async reorder(householdId: string, orderedIds: string[]): Promise<void> {
    await withTransaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        const result = await tx
          .update(categoryGroups)
          .set({ displayOrder: i, updatedAt: new Date() })
          .where(
            and(
              eq(categoryGroups.id, orderedIds[i]),
              eq(categoryGroups.householdId, householdId)
            )
          )
          .returning();

        if (result.length === 0) {
          throw new NotFoundError(
            `Category group not found: ${orderedIds[i]}`
          );
        }
      }
    });
  }
}

export const categoryGroupRepository = new CategoryGroupRepository();
