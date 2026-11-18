import { db } from "../db";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";

// Type for the transaction object passed to operations
export type TransactionType = PgTransaction<
  NodePgQueryResultHKT,
  typeof import("@shared/schema"),
  any
>;

/**
 * Transaction wrapper utility with automatic rollback
 * 
 * Wraps database operations in a transaction that automatically rolls back
 * on error and commits on success.
 * 
 * @param operation - Async function that performs database operations
 * @returns The result of the operation
 * @throws The error from the operation if it fails (after rollback)
 * 
 * @example
 * ```typescript
 * const result = await withTransaction(async (tx) => {
 *   await tx.update(categories).set({ displayOrder: 1 }).where(eq(categories.id, id1));
 *   await tx.update(categories).set({ displayOrder: 2 }).where(eq(categories.id, id2));
 *   return { success: true };
 * });
 * ```
 */
export async function withTransaction<T>(
  operation: (tx: TransactionType) => Promise<T>
): Promise<T> {
  return await db.transaction(async (tx) => {
    try {
      const result = await operation(tx);
      return result;
    } catch (error) {
      // Transaction will automatically rollback on error
      throw error;
    }
  });
}
