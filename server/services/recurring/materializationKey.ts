import { uuidv5 } from "../../core/uuidv5";

/**
 * Fixed namespace for recurring-materialization idempotency keys. Never change
 * this value: it is the seed for every already-persisted key, and changing it
 * would let a previously materialized occurrence be created a second time.
 */
const RECURRING_MATERIALIZATION_NAMESPACE =
  "b40a311a-4d94-47e3-a066-47f68ea05253";

/**
 * Deterministic idempotency key for the transaction materialized from a recurring
 * rule on a given occurrence date.
 *
 * Scheme: uuidv5("recurring:<ruleId>:<occurrenceDate>", NAMESPACE). Because
 * `transactions.idempotency_key` is a UNIQUE uuid column, two overlapping/retried
 * cron runs (even on different instances) that try to materialize the SAME
 * occurrence collide on this key — the second insert fails with a unique
 * violation and is treated as an idempotent skip, never a double-create.
 *
 * @param ruleId - The recurring rule id.
 * @param occurrenceDate - The occurrence date being materialized (YYYY-MM-DD).
 */
export function recurringOccurrenceKey(
  ruleId: string,
  occurrenceDate: string,
): string {
  return uuidv5(
    `recurring:${ruleId}:${occurrenceDate}`,
    RECURRING_MATERIALIZATION_NAMESPACE,
  );
}
