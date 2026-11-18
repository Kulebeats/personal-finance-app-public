import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "../db";
import { rules } from "@shared/schema";
import { withTransaction } from "../utils/withTransaction";

// Use Drizzle inferred types from schema
export type Rule = typeof rules.$inferSelect;
export type InsertRule = typeof rules.$inferInsert;

/**
 * RuleRepository
 * 
 * Provides typed query builders for rule operations.
 * Centralizes common query patterns for rules.
 * Returns typed results matching schema definitions.
 */
export class RuleRepository {
  /**
   * Find all rules for a household, ordered by priority
   */
  async findByHousehold(householdId: string): Promise<Rule[]> {
    return await db
      .select()
      .from(rules)
      .where(eq(rules.householdId, householdId))
      .orderBy(rules.priority);
  }

  /**
   * Find enabled rules for a household
   */
  async findEnabledByHousehold(householdId: string): Promise<Rule[]> {
    return await db
      .select()
      .from(rules)
      .where(
        and(eq(rules.householdId, householdId), eq(rules.enabled, true))
      )
      .orderBy(rules.priority);
  }

  /**
   * Find a single rule by ID
   */
  async findById(id: string): Promise<Rule | undefined> {
    const result = await db
      .select()
      .from(rules)
      .where(eq(rules.id, id))
      .limit(1);
    return result[0];
  }

  /**
   * Find a rule by ID within a specific household
   */
  async findByIdAndHousehold(
    id: string,
    householdId: string
  ): Promise<Rule | undefined> {
    const result = await db
      .select()
      .from(rules)
      .where(and(eq(rules.id, id), eq(rules.householdId, householdId)))
      .limit(1);
    return result[0];
  }

  /**
   * Create a new rule
   */
  async create(data: InsertRule): Promise<Rule> {
    const result = await db
      .insert(rules)
      .values({
        ...data,
        enabled: data.enabled ?? true,
        applyToPast: data.applyToPast ?? false,
      })
      .returning();
    return result[0];
  }

  /**
   * Update an existing rule
   */
  async update(id: string, data: Partial<Rule>): Promise<Rule | undefined> {
    const result = await db
      .update(rules)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(rules.id, id))
      .returning();
    return result[0];
  }

  /**
   * Update a rule within a specific household (with security check)
   */
  async updateByHousehold(
    id: string,
    householdId: string,
    data: Partial<Rule>
  ): Promise<Rule | undefined> {
    const result = await db
      .update(rules)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(rules.id, id), eq(rules.householdId, householdId)))
      .returning();
    return result[0];
  }

  /**
   * Delete a rule
   */
  async delete(id: string): Promise<void> {
    await db.delete(rules).where(eq(rules.id, id));
  }

  /**
   * Delete a rule within a specific household (with security check)
   */
  async deleteByHousehold(id: string, householdId: string): Promise<Rule | undefined> {
    const result = await db
      .delete(rules)
      .where(and(eq(rules.id, id), eq(rules.householdId, householdId)))
      .returning();
    return result[0];
  }

  /**
   * Enable a rule
   */
  async enable(id: string): Promise<Rule | undefined> {
    const result = await db
      .update(rules)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(rules.id, id))
      .returning();
    return result[0];
  }

  /**
   * Disable a rule
   */
  async disable(id: string): Promise<Rule | undefined> {
    const result = await db
      .update(rules)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(rules.id, id))
      .returning();
    return result[0];
  }

  /**
   * Reorder rules atomically
   * Updates priority for multiple rules in a single transaction
   */
  async reorder(householdId: string, orderedIds: string[]): Promise<void> {
    // Use transaction wrapper utility for automatic rollback
    await withTransaction(async (tx) => {
      // Update each rule's priority
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(rules)
          .set({ priority: i, updatedAt: new Date() })
          .where(
            and(
              eq(rules.id, orderedIds[i]),
              eq(rules.householdId, householdId)
            )
          );
      }
    });
  }

  /**
   * Get the highest priority value for a household
   * Used when creating new rules
   */
  async getMaxPriority(householdId: string): Promise<number> {
    const result = await db
      .select({ maxPriority: sql<number>`max(${rules.priority})` })
      .from(rules)
      .where(eq(rules.householdId, householdId));
    return Number(result[0]?.maxPriority ?? -1);
  }

  /**
   * Count rules in a household
   */
  async countByHousehold(householdId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(rules)
      .where(eq(rules.householdId, householdId));
    return Number(result[0]?.count ?? 0);
  }

  /**
   * Count enabled rules in a household
   */
  async countEnabledByHousehold(householdId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(rules)
      .where(and(eq(rules.householdId, householdId), eq(rules.enabled, true)));
    return Number(result[0]?.count ?? 0);
  }
}

// Export singleton instance
export const ruleRepository = new RuleRepository();
