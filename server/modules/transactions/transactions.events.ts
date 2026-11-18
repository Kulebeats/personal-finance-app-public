/**
 * Transaction Module Events
 *
 * Event type constants for transaction domain events.
 * Event handlers will be registered in the main app or a dedicated event setup file.
 *
 * @module modules/transactions/transactions.events
 */

/**
 * Event type constants
 */
export const TransactionEvents = {
  CREATED: "transaction.created",
  UPDATED: "transaction.updated",
  DELETED: "transaction.deleted",
} as const;

export type TransactionEventType =
  (typeof TransactionEvents)[keyof typeof TransactionEvents];
