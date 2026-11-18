/**
 * Schema Registry
 *
 * Centralized registry of validation schemas by domain.
 * Provides type-safe access to schemas and documentation.
 *
 * @module core/validation/registry
 */

import { ZodSchema } from "zod";

// Transaction schemas
import {
  createTransactionSchema,
  updateTransactionSchema,
  createTransferSchema,
  updateTransferSchema,
  transactionQuerySchema,
  summaryQuerySchema,
  bulkUpdateSchema,
  bulkDeleteSchema,
} from "../../modules/transactions/transactions.validation";

// Auth schemas
import {
  loginSchema,
  registerSchema,
  mfaVerifySchema,
  mfaLoginVerifySchema,
  backupCodeSchema,
  changePasswordSchema,
} from "../../modules/auth/auth.validation";

/**
 * Schema categories
 */
export type SchemaCategory =
  | "transaction"
  | "auth"
  | "account"
  | "goal"
  | "budget"
  | "settings";

/**
 * Schema registry entry
 */
interface SchemaEntry {
  schema: ZodSchema;
  description: string;
  category: SchemaCategory;
}

/**
 * Central schema registry
 */
export const schemaRegistry = new Map<string, SchemaEntry>();

// ============================================================================
// Transaction Schemas
// ============================================================================

schemaRegistry.set("transaction.create", {
  schema: createTransactionSchema,
  description: "Create a new transaction",
  category: "transaction",
});

schemaRegistry.set("transaction.update", {
  schema: updateTransactionSchema,
  description: "Update an existing transaction",
  category: "transaction",
});

schemaRegistry.set("transfer.create", {
  schema: createTransferSchema,
  description: "Create a transfer between accounts",
  category: "transaction",
});

schemaRegistry.set("transfer.update", {
  schema: updateTransferSchema,
  description: "Update an existing transfer",
  category: "transaction",
});

schemaRegistry.set("transaction.query", {
  schema: transactionQuerySchema,
  description: "Query parameters for listing transactions",
  category: "transaction",
});

schemaRegistry.set("transaction.summary", {
  schema: summaryQuerySchema,
  description: "Query parameters for transaction summary",
  category: "transaction",
});

schemaRegistry.set("transaction.bulkUpdate", {
  schema: bulkUpdateSchema,
  description: "Bulk update multiple transactions",
  category: "transaction",
});

schemaRegistry.set("transaction.bulkDelete", {
  schema: bulkDeleteSchema,
  description: "Bulk delete multiple transactions",
  category: "transaction",
});

// ============================================================================
// Auth Schemas
// ============================================================================

schemaRegistry.set("auth.login", {
  schema: loginSchema,
  description: "User login credentials",
  category: "auth",
});

schemaRegistry.set("auth.register", {
  schema: registerSchema,
  description: "New user registration",
  category: "auth",
});

schemaRegistry.set("auth.mfaVerify", {
  schema: mfaVerifySchema,
  description: "MFA code verification",
  category: "auth",
});

schemaRegistry.set("auth.mfaLoginVerify", {
  schema: mfaLoginVerifySchema,
  description: "MFA verification during login (pending session)",
  category: "auth",
});

schemaRegistry.set("auth.backupCode", {
  schema: backupCodeSchema,
  description: "MFA backup code verification",
  category: "auth",
});

schemaRegistry.set("auth.changePassword", {
  schema: changePasswordSchema,
  description: "Password change request",
  category: "auth",
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a schema by name
 */
export function getSchema(name: string): ZodSchema | undefined {
  return schemaRegistry.get(name)?.schema;
}

/**
 * Get all schemas for a category
 */
export function getSchemasByCategory(
  category: SchemaCategory
): Map<string, SchemaEntry> {
  const result = new Map<string, SchemaEntry>();
  for (const [name, entry] of schemaRegistry) {
    if (entry.category === category) {
      result.set(name, entry);
    }
  }
  return result;
}

/**
 * List all registered schema names
 */
export function listSchemas(): string[] {
  return Array.from(schemaRegistry.keys());
}

/**
 * List schemas by category
 */
export function listSchemasByCategory(): Record<SchemaCategory, string[]> {
  const result: Record<SchemaCategory, string[]> = {
    transaction: [],
    auth: [],
    account: [],
    goal: [],
    budget: [],
    settings: [],
  };

  for (const [name, entry] of schemaRegistry) {
    result[entry.category].push(name);
  }

  return result;
}
