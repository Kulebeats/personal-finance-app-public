import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "../db";
import { householdMembers, households, rules } from "@shared/schema";
import { withTransaction, type TransactionType } from "../utils/withTransaction";
import { can } from "../core/authz/capabilities";
import { ForbiddenError, NotFoundError } from "../core/errors";

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
  /** Fence live author access before rule and tag locks, in tag-writer order. */
  async lockAuthorContext(householdId: string, userId: string, tx: TransactionType): Promise<void> {
    const [household] = await tx.select({ id: households.id }).from(households)
      .where(eq(households.id, householdId)).for("key share").limit(1);
    if (!household) throw new NotFoundError("Household not found");
    const [member] = await tx.select({ role: householdMembers.role }).from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
      .for("share").limit(1);
    if (!member || !can(member.role, "financial.write")) {
      throw new ForbiddenError("Rule write access required");
    }
  }

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

  /** Lock the persisted action set before a merged update or enable. */
  async findByIdAndHouseholdForUpdate(
    id: string,
    householdId: string,
    tx: TransactionType,
  ): Promise<Rule | undefined> {
    const [rule] = await tx
      .select()
      .from(rules)
      .where(and(eq(rules.id, id), eq(rules.householdId, householdId)))
      .for("update")
      .limit(1);
    return rule;
  }

  /**
   * Create a new rule
   */
  async create(data: InsertRule, tx?: TransactionType): Promise<Rule> {
    const result = await (tx ?? db)
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
    data: Partial<Rule>,
    tx?: TransactionType,
  ): Promise<Rule | undefined> {
    const result = await (tx ?? db)
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
  async deleteByHousehold(id: string, householdId: string, tx?: TransactionType): Promise<Rule | undefined> {
    const result = await (tx ?? db)
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
  async reorder(householdId: string, orderedIds: string[], userId?: string, externalTx?: TransactionType): Promise<void> {
    const operation = async (tx: TransactionType) => {
      if (userId) {
        await this.lockAuthorContext(householdId, userId, tx);
        // The HTTP writer shares bulk-enable's canonical lock order while
        // retaining requested priority assignments below.
        const lockIds = Array.from(new Set(orderedIds.map((id) => id.toLowerCase()))).sort();
        for (const id of lockIds) {
          // A rule outside the caller's household is reported as missing, never reordered.
          if (!(await this.findByIdAndHouseholdForUpdate(id, householdId, tx))) throw new NotFoundError("Rule");
        }
      }
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
    };
    if (externalTx) return operation(externalTx);
    return withTransaction(operation);
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
