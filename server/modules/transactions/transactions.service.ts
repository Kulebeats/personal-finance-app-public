/**
 * Transaction Module Service
 *
 * Re-exports the existing TransactionService.
 * The existing service already implements:
 * - Sign convention enforcement
 * - Account ownership validation
 * - Idempotency key support
 * - Currency consistency via account currency
 *
 * @module modules/transactions/transactions.service
 */

// Re-export the existing TransactionService
export {
  transactionService,
  TransactionService,
} from "../../services/TransactionService";
