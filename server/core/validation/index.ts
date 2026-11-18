/**
 * Core Validation Module
 *
 * Provides centralized validation infrastructure:
 * - Validation middleware factory for Zod schemas
 * - Schema registry for organized access
 * - Standardized error formatting
 *
 * @example
 * import { validate, getSchema } from './core/validation';
 *
 * // Use middleware factory
 * router.post('/transactions',
 *   validate(createTransactionSchema, 'body'),
 *   controller.create
 * );
 *
 * // Get schema from registry
 * const schema = getSchema('transaction.create');
 *
 * @module core/validation
 */

// Middleware
export {
  validate,
  validateMultiple,
  type ValidationSource,
  type ValidateOptions,
  type ValidatedRequest,
} from "./middleware";

// Registry
export {
  schemaRegistry,
  getSchema,
  getSchemasByCategory,
  listSchemas,
  listSchemasByCategory,
  type SchemaCategory,
} from "./registry";

// Re-export common schemas for convenience
export {
  // Transaction schemas
  createTransactionSchema,
  updateTransactionSchema,
  createTransferSchema,
  transactionQuerySchema,
} from "../../modules/transactions/transactions.validation";

export {
  // Auth schemas
  loginSchema,
  registerSchema,
} from "../../modules/auth/auth.validation";
