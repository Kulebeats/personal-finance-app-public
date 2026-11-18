/**
 * Transaction Module Types
 *
 * Type definitions for the transaction domain.
 *
 * @module modules/transactions/transactions.types
 */

import { z } from "zod";

// ============================================================================
// Transaction Types
// ============================================================================

export type TransactionType = "income" | "expense" | "transfer";

export interface CreateTransactionInput {
  accountId: string;
  amount: string;
  type: TransactionType;
  date: string;
  name: string;
  categoryId?: string;
  merchantId?: string;
  notes?: string;
  tags?: string[];
  isRecurring?: boolean;
  recurringTransactionId?: string;
  idempotencyKey?: string;
}

export interface UpdateTransactionInput {
  amount?: string;
  type?: TransactionType;
  date?: string;
  name?: string;
  categoryId?: string;
  merchantId?: string;
  notes?: string;
  tags?: string[];
  updatedAt?: string;
}

export interface CreateTransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: string | number;
  date?: string;
  name?: string;
  idempotencyKey?: string;
}

// ============================================================================
// Transaction Invariants
// ============================================================================

/**
 * Sign convention:
 * - Expenses: negative amounts
 * - Income: positive amounts
 * - Transfers: outflow negative, inflow positive
 */
export interface TransactionInvariants {
  /** Expenses must have negative amounts */
  expensesAreNegative: boolean;
  /** Income must have positive amounts */
  incomeIsPositive: boolean;
  /** Account must belong to household */
  accountOwnership: boolean;
  /** Category must belong to household (if provided) */
  categoryOwnership: boolean;
  /** Currency must match account currency */
  currencyConsistency: boolean;
  /** Idempotency key must be unique */
  idempotencyUnique: boolean;
}

// ============================================================================
// Transaction Events
// ============================================================================

export interface TransactionCreatedEvent {
  type: "transaction.created";
  timestamp: Date;
  data: {
    transactionId: string;
    accountId: string;
    householdId: string;
    userId: string;
    amount: number;
    transactionType: TransactionType;
  };
}

export interface TransactionUpdatedEvent {
  type: "transaction.updated";
  timestamp: Date;
  data: {
    transactionId: string;
    accountId: string;
    householdId: string;
    userId: string;
    changes: Partial<UpdateTransactionInput>;
  };
}

export interface TransactionDeletedEvent {
  type: "transaction.deleted";
  timestamp: Date;
  data: {
    transactionId: string;
    accountId: string;
    householdId: string;
    userId: string;
  };
}

export type TransactionEvent =
  | TransactionCreatedEvent
  | TransactionUpdatedEvent
  | TransactionDeletedEvent;
