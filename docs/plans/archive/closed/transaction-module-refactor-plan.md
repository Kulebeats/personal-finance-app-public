# Transaction Module Refactor - Implementation Plan

**Date:** 2026-01-23
**Status:** Closed (Re-audited 2026-02-07)
**Priority:** LOW (Module is stable and well-tested)
**Estimated Effort:** 4-6 hours
**Risk Level:** MEDIUM (Refactoring stable code)

---

## Re-Audit 2026-02-07

Completion confirmed:

- Controller split work is implemented (`transactions.bulk.controller.ts` exists).
- Main transactions controller is now below 500 LOC.
- Transaction repository delegated methods were split to `TransactionRepository.delegates.ts`.
- `server/repositories/TransactionRepository.ts` is now 477 LOC (below 500 target) with backward-compatible exports preserved.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Issue 1: Controller LOC Violation](#issue-1-controller-loc-violation)
3. [Issue 2: Repository LOC Violation](#issue-2-repository-loc-violation)
4. [Issue 3: Routes LOC Violation](#issue-3-routes-loc-violation)
5. [Issue 4: Money Usage Patterns](#issue-4-money-usage-patterns)
6. [Implementation Phases](#implementation-phases)
7. [Detailed TODO List](#detailed-todo-list)
8. [Testing Strategy](#testing-strategy)
9. [Rollback Plan](#rollback-plan)

---

## Executive Summary

The Transaction module exceeds LOC limits in 3 files:
- `transactions.controller.ts`: 789 LOC (limit: 500)
- `TransactionRepository.ts`: 1,070 LOC (limit: 500)
- `transactions.routes.ts`: 309 LOC (limit: 100)

Additionally, there are minor Money class usage patterns that could be improved in:
- `queries.ts:204` - `.toNumber()` after FX multiplication
- `create.ts:170` - `.toNumber()` for notification amount

---

## Issue 1: Controller LOC Violation

### Current State
- **File:** `server/modules/transactions/transactions.controller.ts`
- **LOC:** 789 (exceeds 500 limit by 289 lines)
- **Handlers:** 15 HTTP handlers

### Analysis

The controller contains two distinct groups of handlers:

**Group 1: Core CRUD (Lines 48-463)** - ~415 LOC
- `list()` - List transactions with filtering
- `getSummary()` - Get period summary
- `getById()` - Get single transaction
- `getGoalLinks()` - Get linked goals
- `create()` - Create transaction
- `createTransfer()` - Create transfer
- `updateTransfer()` - Update transfer
- `update()` - Update transaction
- `remove()` - Delete transaction
- `updateOwner()` - Change owner
- `markReviewed()` - Mark reviewed

**Group 2: Bulk Operations (Lines 469-757)** - ~290 LOC
- `bulkUpdateOwner()` - Bulk ownership change
- `bulkUpdateCategory()` - Bulk categorization
- `bulkAddTags()` - Bulk tagging
- `bulkReview()` - Bulk review
- `bulkDelete()` - Bulk delete

### Technical Specification

#### New File Structure

```
server/modules/transactions/
├── transactions.controller.ts        # Core CRUD handlers (~415 LOC)
├── transactions.bulk.controller.ts   # Bulk operation handlers (~300 LOC)
├── transactions.routes.ts            # Core routes
├── transactions.bulk.routes.ts       # Bulk routes (optional)
└── ... (other existing files)
```

#### File: `transactions.bulk.controller.ts`

```typescript
/**
 * Bulk Operations Controller
 *
 * Handles bulk transaction operations (>100 items not supported).
 * Follows CLAUDE.md bulk operation patterns.
 *
 * @module modules/transactions/transactions.bulk.controller
 */

import { Request, Response } from "express";
import { transactionService as legacyTransactionService } from "../../services/TransactionService";
import { ValidationError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { mapTransactionMoney } from "./transactions.helpers";

export const transactionService = legacyTransactionService;

// Move these functions from transactions.controller.ts:
// - bulkUpdateOwner (lines 469-507)
// - bulkUpdateCategory (lines 550-602)
// - bulkAddTags (lines 608-660)
// - bulkReview (lines 666-711)
// - bulkDelete (lines 717-757)

export const transactionsBulkController = {
  bulkUpdateOwner,
  bulkUpdateCategory,
  bulkAddTags,
  bulkReview,
  bulkDelete,
};
```

#### Updates to `transactions.controller.ts`

```typescript
// Remove lines 469-757 (bulk operations)
// Update exports at bottom:

export const transactionsController = {
  list,
  getSummary,
  getById,
  getGoalLinks,
  create,
  createTransfer,
  updateTransfer,
  update,
  remove,
  updateOwner,
  markReviewed,
  // Attachment methods (re-exported)
  uploadAttachment,
  listAttachments,
  downloadAttachment,
  deleteAttachment,
};
```

#### Updates to `index.ts`

```typescript
export { transactionsController } from "./transactions.controller";
export { transactionsBulkController } from "./transactions.bulk.controller";
// ... rest unchanged
```

---

## Issue 2: Repository LOC Violation

### Current State
- **File:** `server/repositories/TransactionRepository.ts`
- **LOC:** 1,070 (exceeds 500 limit by 570 lines)
- **Methods:** 15 methods

### Analysis

The repository has natural groupings:

**Group 1: Query Methods** (~600 LOC)
- `findByHousehold()` - Complex filter builder (lines 82-290)
- `findByHouseholdWithVisibility()` - Visibility-aware queries (lines 298-365)
- `findForPatternDetection()` - Recurring pattern detection (lines 370-418)
- `findById()` - Single item lookup (lines 423-439)
- `findByIdWithVisibility()` - Visibility-checked lookup (lines 445-477)
- `findByIdempotencyKey()` - Idempotency lookup (lines 482-497)
- `findTransferPair()` - Transfer pair lookup (lines 888-903)
- `countByHousehold()` - Simple count (lines 908-927)
- `countByHouseholdWithVisibility()` - Filtered count (lines 933-1066)

**Group 2: Mutation Methods** (~400 LOC)
- `calculateBalanceDelta()` - Balance calc helper (lines 59-77)
- `createWithTx()` - Internal create (lines 499-552)
- `create()` - Public create (lines 557-582)
- `createWithinTransaction()` - Tx-aware create (lines 584-596)
- `update()` - Update with balance recalc (lines 601-693)
- `softDelete()` - Delete with balance reversal (lines 698-754)
- `createTransfer()` - Transfer creation (lines 760-883)

### Technical Specification

#### New File Structure

```
server/repositories/
├── TransactionRepository.ts              # Re-export facade (~50 LOC)
├── transaction/
│   ├── index.ts                          # Barrel exports
│   ├── TransactionQueryRepository.ts     # Query methods (~500 LOC)
│   ├── TransactionMutationRepository.ts  # CRUD mutations (~400 LOC)
│   └── types.ts                          # Shared types
└── __tests__/
    └── transactionRepository.test.ts     # Tests (unchanged path)
```

#### File: `transaction/types.ts`

```typescript
import { type Transaction, type Account } from "@shared/schema";

export interface TransactionWithNames extends Transaction {
  merchantName?: string | null;
  merchantLogoUrl?: string | null;
  categoryName?: string | null;
  accountName?: string | null;
}

export interface TransactionQueryOptions {
  limit?: number;
  offset?: number;
  accountId?: string;
  categoryId?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  includeDeleted?: boolean;
  includePending?: boolean;
  ownerUserId?: string | null;
  sortBy?: "date" | "amount" | "description";
  sortOrder?: "asc" | "desc";
  search?: string;
  merchantId?: string;
  amountMin?: string;
  amountMax?: string;
  reviewed?: "reviewed" | "unreviewed";
  tagIds?: string[];
}

export interface CreateResult {
  transaction: Transaction;
  account: Account;
}

export interface UpdateResult {
  transaction?: Transaction;
  conflict: boolean;
}
```

#### File: `transaction/TransactionQueryRepository.ts`

```typescript
/**
 * Transaction Query Repository
 *
 * Read-only query methods for transactions.
 * Handles filtering, pagination, visibility, and counting.
 */

import { eq, and, isNull, sql, desc, asc, or, gte, lte, inArray } from "drizzle-orm";
import { db } from "../../db";
import { transactions, accounts, merchants, categories, transactionTags, type Transaction } from "@shared/schema";
import { TransactionWithNames, TransactionQueryOptions } from "./types";

export class TransactionQueryRepository {
  // Move these methods from TransactionRepository:
  // - findByHousehold()
  // - findByHouseholdWithVisibility()
  // - findForPatternDetection()
  // - findById()
  // - findByIdWithVisibility()
  // - findByIdempotencyKey()
  // - findTransferPair()
  // - countByHousehold()
  // - countByHouseholdWithVisibility()
}

export const transactionQueryRepository = new TransactionQueryRepository();
```

#### File: `transaction/TransactionMutationRepository.ts`

```typescript
/**
 * Transaction Mutation Repository
 *
 * Write operations for transactions with balance management.
 * Handles creates, updates, deletes, and transfers.
 */

import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { transactions, accounts, type Transaction, type InsertTransaction, type Account } from "@shared/schema";
import { withTransaction } from "../../utils/withTransaction";
import { Money } from "../../core/money";
import { goalAccountAssignmentService } from "../../services/GoalAccountAssignmentService";
import { logger } from "../../utils/logger";
import { transactionQueryRepository } from "./TransactionQueryRepository";
import { CreateResult, UpdateResult } from "./types";

export class TransactionMutationRepository {
  // Move these methods from TransactionRepository:
  // - calculateBalanceDelta()
  // - createWithTx() (private)
  // - create()
  // - createWithinTransaction()
  // - update()
  // - softDelete()
  // - createTransfer()
}

export const transactionMutationRepository = new TransactionMutationRepository();
```

#### File: `TransactionRepository.ts` (Facade)

```typescript
/**
 * Transaction Repository
 *
 * Facade that re-exports query and mutation repositories.
 * Maintains backward compatibility with existing imports.
 */

import { transactionQueryRepository, TransactionQueryRepository } from "./transaction/TransactionQueryRepository";
import { transactionMutationRepository, TransactionMutationRepository } from "./transaction/TransactionMutationRepository";
export { TransactionWithNames, TransactionQueryOptions } from "./transaction/types";

// Combined repository for backward compatibility
class TransactionRepository {
  // Query methods (delegate to query repository)
  findByHousehold = transactionQueryRepository.findByHousehold.bind(transactionQueryRepository);
  findByHouseholdWithVisibility = transactionQueryRepository.findByHouseholdWithVisibility.bind(transactionQueryRepository);
  findForPatternDetection = transactionQueryRepository.findForPatternDetection.bind(transactionQueryRepository);
  findById = transactionQueryRepository.findById.bind(transactionQueryRepository);
  findByIdWithVisibility = transactionQueryRepository.findByIdWithVisibility.bind(transactionQueryRepository);
  findByIdempotencyKey = transactionQueryRepository.findByIdempotencyKey.bind(transactionQueryRepository);
  findTransferPair = transactionQueryRepository.findTransferPair.bind(transactionQueryRepository);
  countByHousehold = transactionQueryRepository.countByHousehold.bind(transactionQueryRepository);
  countByHouseholdWithVisibility = transactionQueryRepository.countByHouseholdWithVisibility.bind(transactionQueryRepository);

  // Mutation methods (delegate to mutation repository)
  calculateBalanceDelta = transactionMutationRepository.calculateBalanceDelta.bind(transactionMutationRepository);
  create = transactionMutationRepository.create.bind(transactionMutationRepository);
  createWithinTransaction = transactionMutationRepository.createWithinTransaction.bind(transactionMutationRepository);
  update = transactionMutationRepository.update.bind(transactionMutationRepository);
  softDelete = transactionMutationRepository.softDelete.bind(transactionMutationRepository);
  createTransfer = transactionMutationRepository.createTransfer.bind(transactionMutationRepository);
}

export const transactionRepository = new TransactionRepository();
export { TransactionRepository };
```

---

## Issue 3: Routes LOC Violation

### Current State
- **File:** `server/modules/transactions/transactions.routes.ts`
- **LOC:** 309 (exceeds 100 limit by 209 lines)

### Analysis

The routes file is large primarily due to:
1. Multer configuration for file uploads (lines 206-229) - ~24 LOC
2. Multer error handler (lines 274-307) - ~34 LOC
3. Route definitions with JSDoc comments (lines 33-200) - ~170 LOC

### Technical Specification

The routes file exceeds the limit but splitting would reduce clarity. **Recommendation: Accept as-is** with documented exception, OR:

#### Option A: Split Attachments (Preferred)

```
server/modules/transactions/
├── transactions.routes.ts              # Core routes (~150 LOC)
├── transactions.attachments.routes.ts  # Attachment routes (~100 LOC)
```

#### File: `transactions.attachments.routes.ts`

```typescript
/**
 * Transaction Attachments Routes
 *
 * Handles file upload/download for transaction attachments.
 */

import { Router, Request, Response, NextFunction } from "express";
import multer, { MulterError } from "multer";
import * as path from "path";
import * as fs from "fs";
import { requireRole } from "../../middleware/validateEntity";
import { asyncHandler } from "../../utils/errorHandler";
import { transactionsController } from "./transactions.controller";

const router = Router();

// Multer configuration (lines 207-229 from original)
const upload = multer({ /* ... */ });

// Attachment routes (lines 235-268 from original)
router.post("/:id/attachments", ...);
router.get("/:id/attachments", ...);
router.get("/:id/attachments/:attachmentId/download", ...);
router.delete("/:id/attachments/:attachmentId", ...);

// Error handler (lines 274-307 from original)
router.use((err: Error, req: Request, res: Response, next: NextFunction) => { /* ... */ });

export default router;
```

#### Updated `transactions.routes.ts`

```typescript
import attachmentRoutes from "./transactions.attachments.routes";

// Mount attachment routes
router.use(attachmentRoutes);

// Remove lines 206-307 (attachment config and routes)
```

#### Option B: Accept Exception

Document in CLAUDE.md that routes files handling file uploads may exceed 100 LOC due to multer configuration requirements.

---

## Issue 4: Money Usage Patterns

### Current State

Two locations use `.toNumber()` mid-calculation:

1. **`queries.ts:204`** - FX conversion
2. **`create.ts:170`** - Notification amount

### Analysis

#### Location 1: `queries.ts:204`

```typescript
// Current (line 204)
amount = new Money(amount.multiply(rate).toNumber(), baseCurrency);
```

**Issue:** Creates Money, multiplies, converts to number, creates new Money.
**Impact:** LOW - Already using Money for precision, just awkward pattern.
**Fix:** Use Money.fromNumber() or keep as string.

```typescript
// Fixed
const converted = amount.multiply(rate);
amount = new Money(converted.toString(), baseCurrency);
```

#### Location 2: `create.ts:170`

```typescript
// Current (line 170)
const amount = new Money(processedTransaction.amount).toNumber();
```

**Issue:** Converts to number for notification service.
**Impact:** LOW - Notification is non-financial display only.
**Fix:** Keep as-is (acceptable) OR pass Money object to notification service.

```typescript
// Option 1: Keep as-is (acceptable for notification display)
const amount = new Money(processedTransaction.amount).toNumber();

// Option 2: Pass Money object
notificationService.triggerLargeTransaction(
  userId,
  householdId,
  processedTransaction.id,
  new Money(processedTransaction.amount),  // Pass Money object
  merchantName
);
```

### Technical Specification

#### Updated `queries.ts` (Line 204)

```typescript
// Before
if (txnCurrency !== baseCurrency) {
  const rate = fxRates.get(txnCurrency) ?? 1;
  amount = new Money(amount.multiply(rate).toNumber(), baseCurrency);
}

// After
if (txnCurrency !== baseCurrency) {
  const rate = fxRates.get(txnCurrency) ?? 1;
  // Keep as string to avoid intermediate number conversion
  const convertedAmount = amount.multiply(rate);
  amount = new Money(convertedAmount.toString(), baseCurrency);
}
```

#### `create.ts:170` - No Change Required

The current usage is acceptable as it's for notification display only, not financial calculation. Document in code comment.

---

## Implementation Phases

### Phase 1: Controller Split (Priority: MEDIUM)
**Estimated Time:** 1-2 hours

1. Create `transactions.bulk.controller.ts`
2. Move 5 bulk methods from `transactions.controller.ts`
3. Update `index.ts` exports
4. Update `transactions.routes.ts` to import from new file
5. Run tests to verify

### Phase 2: Repository Split (Priority: LOW)
**Estimated Time:** 2-3 hours

1. Create `server/repositories/transaction/` directory
2. Create `types.ts` with shared interfaces
3. Create `TransactionQueryRepository.ts` with query methods
4. Create `TransactionMutationRepository.ts` with mutation methods
5. Update `TransactionRepository.ts` as facade
6. Run all tests to verify backward compatibility

### Phase 3: Routes Refactor (Priority: LOW)
**Estimated Time:** 30 minutes

Option A: Split attachments into separate file
Option B: Accept exception and document

### Phase 4: Money Pattern Fix (Priority: LOW)
**Estimated Time:** 15 minutes

1. Update `queries.ts:204` to avoid intermediate `.toNumber()`
2. Add documentation comment to `create.ts:170`
3. Run tests

---

## Detailed TODO List

### Pre-Implementation
- [ ] Create feature branch: `refactor/transaction-module-loc-compliance`
- [ ] Ensure all tests pass: `npm run test:server:run -- --grep "transaction"`
- [ ] Take snapshot of current LOC counts

### Phase 1: Controller Split
- [ ] Create file `server/modules/transactions/transactions.bulk.controller.ts`
- [ ] Add file header comment with module documentation
- [ ] Move `bulkUpdateOwner` function (lines 469-507)
- [ ] Move `bulkUpdateCategory` function (lines 550-602)
- [ ] Move `bulkAddTags` function (lines 608-660)
- [ ] Move `bulkReview` function (lines 666-711)
- [ ] Move `bulkDelete` function (lines 717-757)
- [ ] Add necessary imports to new file
- [ ] Export `transactionsBulkController` object
- [ ] Remove moved functions from `transactions.controller.ts`
- [ ] Update `transactionsController` export object
- [ ] Update `index.ts` to export new controller
- [ ] Update `transactions.routes.ts` imports
- [ ] Run TypeScript check: `npm run check`
- [ ] Run tests: `npm run test:server:run`
- [ ] Verify new controller LOC < 300
- [ ] Verify updated controller LOC < 500

### Phase 2: Repository Split
- [ ] Create directory `server/repositories/transaction/`
- [ ] Create file `transaction/types.ts`
  - [ ] Move `TransactionWithNames` interface
  - [ ] Add `TransactionQueryOptions` interface
  - [ ] Add `CreateResult` and `UpdateResult` interfaces
- [ ] Create file `transaction/TransactionQueryRepository.ts`
  - [ ] Add class with query methods
  - [ ] Move `findByHousehold` method
  - [ ] Move `findByHouseholdWithVisibility` method
  - [ ] Move `findForPatternDetection` method
  - [ ] Move `findById` method
  - [ ] Move `findByIdWithVisibility` method
  - [ ] Move `findByIdempotencyKey` method
  - [ ] Move `findTransferPair` method
  - [ ] Move `countByHousehold` method
  - [ ] Move `countByHouseholdWithVisibility` method
  - [ ] Export singleton instance
- [ ] Create file `transaction/TransactionMutationRepository.ts`
  - [ ] Add class with mutation methods
  - [ ] Move `calculateBalanceDelta` method
  - [ ] Move `createWithTx` private method
  - [ ] Move `create` method
  - [ ] Move `createWithinTransaction` method
  - [ ] Move `update` method
  - [ ] Move `softDelete` method
  - [ ] Move `createTransfer` method
  - [ ] Add import for `transactionQueryRepository` (for `findById` calls)
  - [ ] Export singleton instance
- [ ] Create file `transaction/index.ts`
  - [ ] Export from query repository
  - [ ] Export from mutation repository
  - [ ] Export types
- [ ] Update `TransactionRepository.ts`
  - [ ] Convert to facade pattern
  - [ ] Import from sub-repositories
  - [ ] Bind all methods to maintain `this` context
  - [ ] Maintain backward-compatible exports
- [ ] Run TypeScript check: `npm run check`
- [ ] Run tests: `npm run test:server:run`
- [ ] Verify each new file LOC < 500

### Phase 3: Routes Refactor (Optional)
- [ ] Create file `transactions.attachments.routes.ts`
- [ ] Move multer configuration (lines 207-229)
- [ ] Move attachment routes (lines 235-268)
- [ ] Move error handler (lines 274-307)
- [ ] Update `transactions.routes.ts` to mount attachment router
- [ ] Run TypeScript check
- [ ] Run tests

### Phase 4: Money Pattern Fixes
- [ ] Update `queries.ts:204`
  - [ ] Change: `new Money(amount.multiply(rate).toNumber(), baseCurrency)`
  - [ ] To: `new Money(amount.multiply(rate).toString(), baseCurrency)`
- [ ] Add comment to `create.ts:170`
  - [ ] Document: "// toNumber() acceptable for notification display (non-financial)"
- [ ] Run tests

### Post-Implementation
- [ ] Run full test suite: `npm run test:server:run`
- [ ] Run TypeScript check: `npm run check`
- [ ] Verify LOC compliance:
  ```bash
  (Get-Content server/modules/transactions/transactions.controller.ts | Measure-Object -Line).Lines
  (Get-Content server/modules/transactions/transactions.bulk.controller.ts | Measure-Object -Line).Lines
  (Get-Content server/repositories/transaction/TransactionQueryRepository.ts | Measure-Object -Line).Lines
  (Get-Content server/repositories/transaction/TransactionMutationRepository.ts | Measure-Object -Line).Lines
  ```
- [ ] Update `transaction-module-status-2026-01-23.md` with new file counts
- [ ] Commit with message: `refactor(transactions): split controller and repository for LOC compliance`

---

## Testing Strategy

### Unit Tests (Existing - No Changes)
All existing tests should continue to pass without modification:
- `server/repositories/__tests__/transactionRepository.test.ts`
- `server/repositories/__tests__/transactionAtomicity.property.test.ts`
- `server/services/__tests__/transactionService.test.ts`

### Integration Tests (Existing - No Changes)
- `server/routes/__tests__/transactions.integration.test.ts`

### Manual Verification
After refactor, manually verify:
1. Create transaction via API
2. Create transfer via API
3. Bulk update category on 5 transactions
4. Bulk delete 3 transactions
5. Upload attachment to transaction
6. View transaction summary

---

## Rollback Plan

If issues arise during implementation:

1. **Immediate Rollback:** `git checkout main -- server/modules/transactions/ server/repositories/`
2. **Test Suite:** Run full test suite to verify rollback success
3. **Gradual Approach:** Implement one phase at a time with commits between

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking imports | LOW | HIGH | Facade pattern maintains backward compat |
| Test failures | LOW | MEDIUM | All existing tests should pass unchanged |
| Runtime errors | LOW | HIGH | TypeScript catches most issues at compile time |
| Performance regression | VERY LOW | LOW | No algorithmic changes, just file reorganization |

---

## Acceptance Criteria

- [ ] All files under 500 LOC (controllers, repositories)
- [ ] All existing tests pass without modification
- [ ] TypeScript compilation succeeds
- [ ] No `any` types introduced
- [ ] Backward compatibility maintained (no import changes in consuming code)
- [ ] Documentation updated

---

## Sign-off

| Role | Name | Date | Approved |
|------|------|------|----------|
| Developer | | | [ ] |
| Reviewer | | | [ ] |
