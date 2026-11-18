/**
 * Transaction Module Index
 *
 * Re-exports all transaction module components.
 *
 * @module modules/transactions
 */

// Routes
export { default as transactionsRoutes } from "./transactions.routes";

// Controller
export { transactionsController } from "./transactions.controller";
export { transactionsBulkController } from "./transactions.bulk.controller";

// Service (re-exports existing TransactionService)
export { transactionService, TransactionService } from "./transactions.service";

// Validation
export {
  createTransactionSchema,
  updateTransactionSchema,
  createTransferSchema,
  updateTransferSchema,
  transactionQuerySchema,
  summaryQuerySchema,
  bulkUpdateSchema,
  bulkDeleteSchema,
  type CreateTransactionInput,
  type UpdateTransactionInput,
  type CreateTransferInput,
  type UpdateTransferInput,
  type TransactionQuery,
  type SummaryQuery,
} from "./transactions.validation";

// Types
export {
  type TransactionType,
  type TransactionCreatedEvent,
  type TransactionUpdatedEvent,
  type TransactionDeletedEvent,
  type TransactionEvent,
} from "./transactions.types";

// Events
export {
  TransactionEvents,
  type TransactionEventType,
} from "./transactions.events";
