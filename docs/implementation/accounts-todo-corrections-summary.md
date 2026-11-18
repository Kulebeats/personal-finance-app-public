# Accounts Module TODO - Corrections Summary

**Date:** 2026-01-20
**Issue:** Original TODO document had critical technical inaccuracies
**Resolution:** Created accurate v2 with codebase verification

---

## Critical Errors Found and Fixed

### 1. **Error: Invented Service Dependencies** ❌

**Location:** TODO-001 (ACC-016)

**Original (Wrong):**
```typescript
this.accountRepository.findByIdWithVisibility(...)
this.businessAuditService.logUpdate(...)
this.requestContext?.ip
throw new ForbiddenError(...)
```

**Actual Codebase:**
```typescript
// Uses module-level imports, not dependency injection
accountRepository.findByIdWithVisibility(...)
businessAuditService.logUpdate(...)
// No requestContext exists
throw new AuthorizationError(...)  // No ForbiddenError class
```

**Root Cause:** Assumed dependency injection pattern without verifying actual service architecture.

**Impact:** Code would not compile. 100% of TODO-001 implementation was wrong.

---

### 2. **Error: Wrong Enum Values** ❌

**Location:** TODO-003 (ACC-014)

**Original (Wrong):**
```typescript
const validTypes = [..., "credit_card", ...]
```

**Actual Schema:**
```typescript
// shared/schema.ts:36
export const accountTypeEnum = pgEnum("account_type", [
  ...,
  "credit",  // NOT "credit_card"
  ...
]);
```

**Root Cause:** Didn't verify schema enum values.

**Impact:** Type mismatch would cause runtime errors. Database constraint violations.

---

### 3. **Error: Invented Money Class Methods** ❌

**Location:** TODO-010 (ACC-025)

**Original (Wrong):**
```typescript
Money.convert(amount, currency, rate)  // Static method
amount.toDto()  // Instance method
fxService.getRate(...)  // Doesn't exist
```

**Actual API:**
```typescript
// No static Money.convert() exists
// No instance .toDto() method
toMoneyDto(amount, currency)  // Standalone helper function

// FX service does not exist in codebase - must be created
```

**Root Cause:** Invented APIs without reading `server/core/money.ts`.

**Impact:** Complete TODO-010 implementation was unusable. Would require creating FX service from scratch.

---

### 4. **Error: Wrong Database Schema** ❌

**Location:** TODO-011 (ACC-028)

**Original (Wrong):**
```typescript
await db.insert(accountBalanceSnapshots).values({
  snapshotDate: new Date(),
  totalAssets: "...",       // Wrong - this table doesn't have these fields
  totalLiabilities: "...",
  netWorth: "...",
});
```

**Actual Schema:**
```typescript
// accountBalanceSnapshots stores PER-ACCOUNT history
export const accountBalanceSnapshots = pgTable("account_balance_snapshots", {
  id: uuid("id"),
  accountId: uuid("account_id"),  // Per account!
  date: date("date"),
  balance: decimal("balance"),
  availableBalance: decimal("available_balance"),
});

// Use netWorthSnapshots for aggregates instead
export const netWorthSnapshots = pgTable("net_worth_snapshots", {
  id: uuid("id"),
  householdId: uuid("household_id"),
  date: date("date"),
  totalAssets: decimal("total_assets"),      // ✅ Correct table
  totalLiabilities: decimal("total_liabilities"),
  netWorth: decimal("net_worth"),
});
```

**Root Cause:** Guessed table structure without reading schema.

**Impact:** Runtime database error. Insert would fail with "column does not exist".

---

### 5. **Error: Breaking API Change Without Migration** ❌

**Location:** TODO-012 (ACC-029)

**Original (Wrong):**
```typescript
// Changed API to expect object
initialBalance: z.object({
  amount: moneyAmountSchema,
  currency: z.string(),
})
```

**Current API:**
```typescript
// API expects string
initialBalance: z.string().optional()

// Database stores as decimal
balance: decimal("balance", { precision: 15, scale: 2 })
```

**Root Cause:** Proposed incompatible API change without migration plan.

**Impact:** Would break all existing clients. No backward compatibility.

---

### 6. **Error: Invented Audit Actions** ❌

**Location:** TODO-018 (ACC-027)

**Original (Wrong):**
```typescript
action: "BULK_UPDATE"  // Doesn't exist
```

**Actual Actions:**
```typescript
// server/services/BusinessAuditService.ts:12-18
export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "TRANSFER"
  | "LINK"
  | "UNLINK";
// No "BULK_UPDATE" or "IMPORT"
```

**Root Cause:** Invented enum value without checking type definition.

**Impact:** TypeScript compilation error.

---

### 7. **Error: Wrong Repository Method Signature** ❌

**Location:** TODO-018 (ACC-027)

**Original (Wrong):**
```typescript
await this.accountRepository.update(
  id,
  householdId,
  { ownerUserId: newOwnerId },
  tx  // Added tx parameter
);
```

**Actual Signature:**
```typescript
// AccountRepository already has different signature
async update(
  id: string,
  householdId: string,
  data: Partial<Account>,
  expectedUpdatedAt?: Date  // Optimistic concurrency, not transaction
): Promise<{ account: Account | null; conflict: boolean }> {
  // ...
}
```

**Root Cause:** Assumed transaction parameter without reading repository code.

**Impact:** Type error. Signature mismatch.

---

### 8. **Error: Missing ACC-001 through ACC-012 Definitions** ⚠️

**Original:** Assumed these were defined elsewhere and proceeded with ACC-013+

**Actual:** Issues ACC-001 through ACC-012 are referenced but not documented in codebase.

**Impact:** Incomplete implementation plan. Phase 1 and Phase 2 tasks reference undefined issues.

---

## Architecture Discoveries

### ✅ What Actually Exists

| Component | Location | API |
|-----------|----------|-----|
| **Error Classes** | `server/utils/errorHandler.ts` | `ValidationError`, `AuthorizationError`, `NotFoundError`, `ConflictError`, `RateLimitError` |
| **Money Class** | `server/core/money.ts` | Instance: `.add()`, `.subtract()`, `.multiply()`, `.divide()`, `.toString()`<br>Helper: `toMoneyDto(amount, currency)` |
| **Audit Service** | `server/services/BusinessAuditService.ts` | Module singleton: `businessAuditService.log()`, `.logCreate()`, `.logUpdate()`, `.logDelete()` |
| **Account Enums** | `shared/schema.ts` | `"credit"` not `"credit_card"`<br>Already has `"mortgage"`, `"other_liability"` |
| **Snapshots** | `shared/schema.ts` | `netWorthSnapshots` - household aggregates<br>`accountBalanceSnapshots` - per-account history |
| **Credit Limit** | `shared/schema.ts:863` | Already in schema: `creditLimit: decimal(...)` |

### ❌ What Does NOT Exist

| Component | Status | Required For |
|-----------|--------|--------------|
| **FX Service** | Missing | TODO-006 (ACC-025), TODO-007 (ACC-028) |
| **CSV Export** | Location unknown | TODO-008 (ACC-021) |
| **Dependency Injection** | Not used | N/A - use module imports |
| **ForbiddenError** | Doesn't exist | Use `AuthorizationError` |
| **Money.convert()** | Doesn't exist | Must use FX service |
| **requestContext** | Doesn't exist | Get IP from Request object |

---

## Corrections Applied in v2

### ✅ Fixed in v2 Document

1. **Used actual error classes** from `server/utils/errorHandler.ts`
2. **Used module-level imports** (`accountRepository`, `businessAuditService`)
3. **Used correct enum values** (`"credit"` not `"credit_card"`)
4. **Used actual Money API** (`toMoneyDto()` helper, instance methods)
5. **Used correct database tables** (`netWorthSnapshots` for aggregates)
6. **Marked ACC-001-012** as undefined/external
7. **Blocked TODOs** that require missing FX service
8. **Added discovery phase** for CSV export location

### 📋 New Status Indicators

| Status | Meaning | Count |
|--------|---------|-------|
| **Ready** | Can implement now | 4 (TODO-001, 002, 004, 005) |
| **BLOCKED** | Missing dependency | 2 (TODO-006, 007 - need FX service) |
| **DEFERRED** | Need discovery | 1 (TODO-008 - find CSV code) |
| **SKIP** | Not applicable | 1 (TODO-003 - already in schema) |

---

## Lessons Learned

### ❌ Don't Do This

1. **Assume service patterns** without reading actual code
2. **Invent APIs** without checking imports
3. **Guess enum values** without verifying schema
4. **Propose breaking changes** without migration plans
5. **Reference external issues** without definitions

### ✅ Do This Instead

1. **Read actual service files** before writing specs
2. **Verify imports and types** exist
3. **Check schema definitions** for enums and tables
4. **Maintain API compatibility** or provide migration
5. **Document unknowns** explicitly (ACC-001-012)

---

## Verification Checklist

Before finalizing any TODO:

- [ ] Read the actual file being modified
- [ ] Verify all imported classes/functions exist
- [ ] Check enum values in schema
- [ ] Confirm database table structure
- [ ] Test API signature compatibility
- [ ] Document external dependencies
- [ ] Mark blockers explicitly

---

## Next Steps

1. **Get approval** for v2 document
2. **Find ACC-001-012** definitions or create them
3. **Locate CSV export** code
4. **Create FX service** design document
5. **Implement ready TODOs** (001, 002, 004, 005)

---

## File Status

| File | Status | Use |
|------|--------|-----|
| `accounts-module-fixes-todo.md` | ❌ Deprecated | Do not use - has critical errors |
| `ACCOUNTS_MODULE_FIXES_TODO_v2.md` | ✅ Accurate | Use this version |
| `accounts-todo-corrections-summary.md` | 📋 Reference | This document - error analysis |
