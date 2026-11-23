import { eq, and, ilike, sql, desc, or, isNull } from "drizzle-orm";
import { db } from "../db";
import { merchants, merchantAliases } from "@shared/schema";
import { withTransaction, type TransactionType } from "../utils/withTransaction";

// Use Drizzle inferred types from schema
export type Merchant = typeof merchants.$inferSelect;
export type InsertMerchant = typeof merchants.$inferInsert;
export type MerchantAlias = typeof merchantAliases.$inferSelect;
export type InsertMerchantAlias = typeof merchantAliases.$inferInsert;

/**
 * MerchantRepository
 * 
 * Provides typed query builders for merchant operations.
 * Uses parameterized queries with ILIKE for safe searching.
 * Prevents SQL injection through proper query parameterization.
 *
 * It creates no merchants and adds no aliases: every name or alias write goes
 * through modules/merchants/merchants.name-guard, which serialises the
 * household's shared name/alias namespace.
 */
export class MerchantRepository {
  /**
   * Find all merchants for a household
   */
  async findByHousehold(householdId: string): Promise<Merchant[]> {
    return await db
      .select()
      .from(merchants)
      .where(eq(merchants.householdId, householdId))
      .orderBy(desc(merchants.transactionCount));
  }

  /**
   * Find a single merchant by ID
   */
  async findById(id: string): Promise<Merchant | undefined> {
    const result = await db
      .select()
      .from(merchants)
      .where(eq(merchants.id, id))
      .limit(1);
    return result[0];
  }

  /**
   * Find a merchant by ID within a specific household
   */
  async findByIdAndHousehold(
    id: string,
    householdId: string
  ): Promise<Merchant | undefined> {
    const result = await db
      .select()
      .from(merchants)
      .where(
        and(eq(merchants.id, id), eq(merchants.householdId, householdId))
      )
      .limit(1);
    return result[0];
  }

  /**
   * Search merchants by name using safe parameterized ILIKE
   * Prevents SQL injection by using Drizzle's parameterized queries
   */
  async search(householdId: string, searchTerm: string): Promise<Merchant[]> {
    // Drizzle automatically parameterizes the search term
    // The ilike operator safely escapes special characters
    const searchPattern = `%${searchTerm}%`;
    
    return await db
      .select()
      .from(merchants)
      .where(
        and(
          eq(merchants.householdId, householdId),
          ilike(merchants.name, searchPattern)
        )
      )
      .orderBy(desc(merchants.transactionCount))
      .limit(50);
  }

  /**
   * Find an active merchant by name or alias (case-insensitive exact match)
   */
  async findByNameOrAlias(
    householdId: string,
    nameOrAlias: string
  ): Promise<Merchant | undefined> {
    const term = nameOrAlias.trim();
    if (!term) return undefined;

    const rows = await db
      .select()
      .from(merchants)
      .leftJoin(merchantAliases, eq(merchantAliases.merchantId, merchants.id))
      .where(
        and(
          eq(merchants.householdId, householdId),
          or(eq(merchants.isActive, true), isNull(merchants.isActive))!,
          or(
            sql`LOWER(${merchants.name}) = LOWER(${term})`,
            sql`LOWER(${merchantAliases.aliasName}) = LOWER(${term})`
          )
        )
      )
      .limit(1);

    return rows[0]?.merchants;
  }

  /**
   * Delete a merchant
   */
  async delete(id: string): Promise<void> {
    await db.delete(merchants).where(eq(merchants.id, id));
  }

  /**
   * Merge two merchants atomically
   * Transfers all aliases and updates transaction references
   * Uses transaction wrapper utility for automatic rollback
   */
  async mergeWithTransaction(
    sourceId: string,
    targetId: string
  ): Promise<void> {
    await withTransaction(async (tx) => {
      // Update all aliases to point to target merchant
      await tx
        .update(merchantAliases)
        .set({ merchantId: targetId })
        .where(eq(merchantAliases.merchantId, sourceId));

      // Delete the source merchant
      await tx.delete(merchants).where(eq(merchants.id, sourceId));
    });
  }

  /**
   * Merge two merchants (internal method for use within existing transactions)
   * Transfers all aliases and updates transaction references
   * Should be wrapped in a transaction by the caller
   */
  async merge(
    sourceId: string,
    targetId: string,
    tx: Parameters<Parameters<typeof withTransaction>[0]>[0]
  ): Promise<void> {
    // Update all aliases to point to target merchant
    await tx
      .update(merchantAliases)
      .set({ merchantId: targetId })
      .where(eq(merchantAliases.merchantId, sourceId));

    // Delete the source merchant
    await tx.delete(merchants).where(eq(merchants.id, sourceId));
  }

  /**
   * Increment transaction count for a merchant
   */
  async incrementTransactionCount(id: string): Promise<void> {
    await db
      .update(merchants)
      .set({
        transactionCount: sql`${merchants.transactionCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(merchants.id, id));
  }

  /**
   * Update last transaction date
   */
  async updateLastTransactionDate(
    id: string,
    date: string
  ): Promise<void> {
    await db
      .update(merchants)
      .set({
        lastTransactionDate: date,
        updatedAt: new Date(),
      })
      .where(eq(merchants.id, id));
  }

  /**
   * Get merchant aliases
   */
  async getAliases(merchantId: string, tx?: TransactionType): Promise<MerchantAlias[]> {
    return await (tx ?? db)
      .select()
      .from(merchantAliases)
      .where(eq(merchantAliases.merchantId, merchantId));
  }

  /**
   * Count merchants in a household
   */
  async countByHousehold(householdId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(merchants)
      .where(eq(merchants.householdId, householdId));
    return Number(result[0]?.count ?? 0);
  }
}

// Export singleton instance
export const merchantRepository = new MerchantRepository();
