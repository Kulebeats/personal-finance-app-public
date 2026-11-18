/**
 * Transaction Helpers
 *
 * Utility functions for transaction operations.
 *
 * @module services/transaction/helpers
 */

/**
 * Compare two objects and return changed fields
 */
export function getAuditChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, { before: unknown; after: unknown }> {
  const safeBefore = before ?? {};
  const safeAfter = after ?? {};
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([
    ...Object.keys(safeBefore),
    ...Object.keys(safeAfter),
  ]);

  for (const key of keys) {
    const beforeValue = safeBefore[key];
    const afterValue = safeAfter[key];
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes[key] = { before: beforeValue, after: afterValue };
    }
  }
  return changes;
}
