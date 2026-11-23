import { db } from "../db";
import { logger } from "./logger";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";

// Type for the transaction object passed to operations
export type TransactionType = PgTransaction<
  NodePgQueryResultHKT,
  typeof import("@shared/schema"),
  any
>;

export type TransactionRunner = <T>(operation: (tx: TransactionType) => Promise<T>) => Promise<T>;

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
  operation: (tx: TransactionType) => Promise<T>,
  executor: Pick<typeof db, "transaction"> = db,
): Promise<T> {
  const hooks: AfterCommitHook[] = [];
  // A rollback rejects here, so the hooks it registered never run.
  const result = await executor.transaction(async (tx) => {
    afterCommitHooks.set(tx, hooks);
    return await operation(tx);
  });
  for (const hook of hooks) {
    try {
      hook();
    } catch (error) {
      // The write has committed; a failed follow-up must not report it as failed.
      logger.error("After-commit hook failed", {}, error instanceof Error ? error : undefined);
    }
  }
  return result;
}

type AfterCommitHook = () => void;
const afterCommitHooks = new WeakMap<object, AfterCommitHook[]>();

/**
 * Runs `hook` once the transaction `withTransaction` opened commits; a
 * rollback discards it (#235 R3-1). A transaction opened any other way has no
 * commit this can wait for, so registering on one throws rather than running
 * the hook before the write is durable.
 */
export function runAfterCommit(tx: TransactionType, hook: AfterCommitHook): void {
  const hooks = afterCommitHooks.get(tx);
  if (!hooks) throw new Error("runAfterCommit needs a transaction opened by withTransaction");
  hooks.push(hook);
}
