# Transactions Controller LOC Split Plan

**Current:** 565 LOC (exceeds 500 LOC limit)
**Target:** 4 files, each <300 LOC
**Status:** Ready for implementation
**Date:** 2026-02-01

---

## Current Structure Analysis

Already split out:
- ✅ `transactions.attachments.controller.ts` (3.4KB)
- ✅ `transactions.bulk.controller.ts` (8.8KB)
- ✅ `transactions.transfer.controller.ts` (3.9KB)

Remaining in main controller (565 LOC):
- list (lines 60-121) - ~62 LOC
- getSummary (lines 127-168) - ~42 LOC
- getById (lines 174-185) - ~12 LOC
- getGoalLinks (lines 191-204) - ~14 LOC
- create (lines 210-251) - ~42 LOC
- update (lines 257-318) - ~62 LOC
- remove (lines 378-432) - ~55 LOC
- updateOwner (lines 470-504) - ~35 LOC
- markReviewed (lines 505-552) - ~48 LOC

---

## Proposed Split

### File 1: `transactions.query.controller.ts` (~150 LOC)

**Purpose:** Read operations (GET endpoints)

**Contents:**
```typescript
/**
 * Transactions Query Controller
 *
 * Handles read-only operations for transactions.
 */

import { Request, Response } from "express";
import { transactionService } from "../../services/TransactionService";
import { transactionGoalLinkService } from "../../services/TransactionGoalLinkService";
import { success } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { toMoneyDto } from "../../core/money";
import {
  transactionQuerySchema as listTransactionsQuerySchema,
  summaryQuerySchema,
} from "./transactions.validation";
import { householdRepository } from "../../repositories/HouseholdRepository";
import {
  mapTransactionMoney,
  mapTransactionLinkMoney,
} from "./transactions.helpers";

export async function list(req: Request, res: Response): Promise<void> {
  // Copy lines 60-121 from original
}

export async function getSummary(req: Request, res: Response): Promise<void> {
  // Copy lines 127-168 from original
}

export async function getById(req: Request, res: Response): Promise<void> {
  // Copy lines 174-185 from original
}

export async function getGoalLinks(req: Request, res: Response): Promise<void> {
  // Copy lines 191-204 from original
}
```

**Exports:**
- `list`
- `getSummary`
- `getById`
- `getGoalLinks`

---

### File 2: `transactions.crud.controller.ts` (~180 LOC)

**Purpose:** Create, Update, Delete operations

**Contents:**
```typescript
/**
 * Transactions CRUD Controller
 *
 * Handles create, update, and delete operations for transactions.
 */

import { Request, Response } from "express";
import { transactionService } from "../../services/TransactionService";
import { logger } from "../../utils/logger";
import { success, created } from "../../core/http";
import { ValidationError } from "../../core/errors";
import {
  createTransactionSchema,
  updateTransactionSchema,
} from "./transactions.validation";
import { businessAuditService } from "../../services/BusinessAuditService";
import { mapTransactionMoney } from "./transactions.helpers";

export async function create(req: Request, res: Response): Promise<void> {
  // Copy lines 210-251 from original
}

export async function update(req: Request, res: Response): Promise<void> {
  // Copy lines 257-318 from original (includes audit logging)
}

export async function remove(req: Request, res: Response): Promise<void> {
  // Copy lines 378-432 from original (includes audit logging)
}
```

**Exports:**
- `create`
- `update`
- `remove`

---

### File 3: `transactions.actions.controller.ts` (~100 LOC)

**Purpose:** Action operations (owner, review status)

**Contents:**
```typescript
/**
 * Transactions Actions Controller
 *
 * Handles transaction action operations (owner updates, review status).
 */

import { Request, Response } from "express";
import { z } from "zod";
import { transactionService } from "../../services/TransactionService";
import { success } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { mapTransactionMoney } from "./transactions.helpers";

// Validation schemas
const updateOwnerSchema = z.object({
  ownerUserId: z.string().uuid("Invalid user ID format").nullable(),
});

const markReviewedSchema = z.object({
  reviewed: z.boolean(),
});

export async function updateOwner(req: Request, res: Response): Promise<void> {
  // Copy lines 470-504 from original
}

export async function markReviewed(req: Request, res: Response): Promise<void> {
  // Copy lines 505-552 from original
}
```

**Exports:**
- `updateOwner`
- `markReviewed`

---

### File 4: `transactions.controller.ts` (update to barrel export)

**Purpose:** Unified interface for backward compatibility

**Contents:**
```typescript
/**
 * Transactions Controller - Unified Interface
 *
 * Barrel export for all transaction controllers.
 * Split from monolithic controller (565 LOC) into focused modules (2026-02-01).
 *
 * @module modules/transactions/transactions.controller
 */

// Query operations
export {
  list,
  getSummary,
  getById,
  getGoalLinks,
} from "./transactions.query.controller";

// CRUD operations
export {
  create,
  update,
  remove,
} from "./transactions.crud.controller";

// Action operations
export {
  updateOwner,
  markReviewed,
} from "./transactions.actions.controller";

// Transfer operations (already split)
export {
  createTransfer,
  updateTransfer,
} from "./transactions.transfer.controller";

// Attachment operations (already split)
export {
  uploadAttachment,
  listAttachments,
  downloadAttachment,
  deleteAttachment,
} from "./transactions.attachments.controller";

// Re-export service for use in tests
export { transactionService } from "../../services/TransactionService";

// Combined controller object for route registration
export const transactionsController = {
  // Query
  list,
  getSummary,
  getById,
  getGoalLinks,
  // CRUD
  create,
  update,
  remove,
  // Actions
  updateOwner,
  markReviewed,
  // Transfers
  createTransfer,
  updateTransfer,
  // Attachments
  uploadAttachment,
  listAttachments,
  downloadAttachment,
  deleteAttachment,
};
```

---

## Implementation Steps

1. **Create query controller:**
   ```bash
   # Extract lines 60-204 (query functions) to new file
   cp server/modules/transactions/transactions.controller.ts server/modules/transactions/transactions.query.controller.ts
   # Edit to keep only query functions + imports
   ```

2. **Create CRUD controller:**
   ```bash
   # Extract lines 210-432 (CRUD functions) to new file
   cp server/modules/transactions/transactions.controller.ts server/modules/transactions/transactions.crud.controller.ts
   # Edit to keep only CRUD functions + imports
   ```

3. **Create actions controller:**
   ```bash
   # Extract lines 470-552 (action functions) to new file
   cp server/modules/transactions/transactions.controller.ts server/modules/transactions/transactions.actions.controller.ts
   # Edit to keep only action functions + imports
   ```

4. **Update main controller:**
   - Replace with barrel exports (see File 4 above)
   - Archive old file as `transactions.controller.ts.legacy`

5. **Verify:**
   ```bash
   npm run check  # TypeScript compilation
   npm run test:server:run  # Integration tests
   ```

---

## Expected Results

| File | Current LOC | New LOC | Status |
|------|-------------|---------|--------|
| transactions.query.controller.ts | - | ~150 | ✅ Under limit |
| transactions.crud.controller.ts | - | ~180 | ✅ Under limit |
| transactions.actions.controller.ts | - | ~100 | ✅ Under limit |
| transactions.controller.ts (index) | 565 | ~80 | ✅ Under limit |

**Total:** 510 LOC across 4 files (vs 565 in monolithic file)

---

## Testing Checklist

After implementation:
- [ ] TypeScript compiles without errors
- [ ] All transaction routes still work
- [ ] Audit logging still functions
- [ ] No import errors in dependent files
- [ ] Integration tests pass
