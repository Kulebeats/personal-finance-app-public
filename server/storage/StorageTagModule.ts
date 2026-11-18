import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { StorageReceiptModule } from "./StorageReceiptModule";

export class StorageTagModule extends StorageReceiptModule {
  // ============================================================================
  // TAG METHODS
  // ============================================================================

  /**
   * Get all tags for a household
   */
  async getTags(householdId: string) {
    const { tags } = await import("@shared/schema");
    return await db
      .select()
      .from(tags)
      .where(eq(tags.householdId, householdId))
      .orderBy(tags.name);
  }

  /**
   * Get a single tag by ID
   */
  async getTagById(id: string, householdId: string) {
    const { tags } = await import("@shared/schema");
    const result = await db
      .select()
      .from(tags)
      .where(and(eq(tags.id, id), eq(tags.householdId, householdId)))
      .limit(1);
    return result[0];
  }

  /**
   * Get tag by name (for lookups during import)
   */
  async getTagByName(householdId: string, name: string) {
    const { tags } = await import("@shared/schema");
    const result = await db
      .select()
      .from(tags)
      .where(and(eq(tags.householdId, householdId), eq(tags.name, name)))
      .limit(1);
    return result[0];
  }

  /**
   * Create a new tag
   */
  async createTag(data: {
    householdId: string;
    name: string;
    color?: string | null;
    icon?: string | null;
    memberSpecific?: boolean;
    memberId?: string | null;
  }) {
    const { tags } = await import("@shared/schema");
    const result = await db.insert(tags).values(data).returning();
    return result[0];
  }

  /**
   * Update a tag
   */
  async updateTag(
    id: string,
    householdId: string,
    data: {
      name?: string;
      color?: string | null;
      icon?: string | null;
    }
  ) {
    const { tags } = await import("@shared/schema");
    const result = await db
      .update(tags)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(tags.id, id), eq(tags.householdId, householdId)))
      .returning();
    return result[0];
  }

  /**
   * Delete a tag (cascades to transaction_tags)
   */
  async deleteTag(id: string, householdId: string) {
    const { tags } = await import("@shared/schema");
    const result = await db
      .delete(tags)
      .where(and(eq(tags.id, id), eq(tags.householdId, householdId)))
      .returning();
    return result[0];
  }

  /**
   * Increment tag usage count
   */
  async incrementTagUsageCount(tagId: string) {
    const { tags } = await import("@shared/schema");
    await db
      .update(tags)
      .set({ usageCount: sql`${tags.usageCount} + 1` })
      .where(eq(tags.id, tagId));
  }

  /**
   * Decrement tag usage count
   */
  async decrementTagUsageCount(tagId: string) {
    const { tags } = await import("@shared/schema");
    await db
      .update(tags)
      .set({ usageCount: sql`GREATEST(${tags.usageCount} - 1, 0)` })
      .where(eq(tags.id, tagId));
  }
}
