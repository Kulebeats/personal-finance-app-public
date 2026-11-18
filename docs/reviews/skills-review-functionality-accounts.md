# Product Manager Functionality Review - Accounts Module

**Date:** 2026-01-21
**Reviewer:** Sarah Chen (Senior Product Manager)
**Benchmark:** Monarch Money
**App Context:** Manual input personal finance app
**Overall Score:** 65/100

---

## Executive Summary

The Accounts module **mostly works** for basic CRUD operations but has **critical data loss bugs** and **non-functional UI elements**. Credit card account fields (creditLimit, apr, statementDay) are collected in the form but **never sent to the API**. Multiple dead UI buttons exist: "Transfer data", "Edit balance history", "Edit multiple", and refresh icon. Rate limiting is completely missing on all 18 endpoints, creating abuse risk. Money class is misused in balance adjustment (hardcoded "ZMW" currency). Owner filtering is done client-side, creating a privacy leak.

---

## Module Structure

```
client/src/features/accounts/
├── components/
│   ├── AddAccountModal.tsx         ❌ P0: Wire missing fields
│   ├── AccountCard.tsx             ✅ OK (68 LOC)
│   ├── AccountList.tsx             ✅ OK (84 LOC)
│   ├── AccountGroup.tsx            ✅ OK
│   ├── AccountFilters.tsx          ✅ OK
│   ├── NetWorthChart.tsx           ✅ OK
│   ├── NetWorthSummary.tsx         ✅ OK (175 LOC)
│   ├── EditAccountModal.tsx        ✅ OK
│   └── detail/
│       ├── AccountTransactions.tsx ❌ P1: Dead buttons, as any cast
│       ├── AccountSidebar.tsx      ❌ P1: Dead refresh icon
│       ├── AccountDetailHeader.tsx ✅ OK
│       └── AccountBalanceChart.tsx ✅ OK
├── hooks/
│   ├── useAccountDetail.ts         ✅ OK
│   └── useAccountsData.ts          ✅ OK
├── constants.ts                    ✅ OK
├── types.ts                        ✅ OK
└── index.ts                        ✅ OK

server/modules/accounts/
├── accounts.routes.ts              ❌ P0: No rate limiters
├── accounts.controller.ts          ✅ OK
└── accounts.validation.ts          ✅ OK
```

---

## Critical Functional Bugs (Feature Broken)

### BUG-001: Credit Card Fields Not Persisted
- **What should happen:** When creating a credit card account with creditLimit, apr, statementDay, these values save to database
- **What actually happens:** Form collects values but `handleSave()` doesn't include them in mutation
- **User impact:** Users enter credit limit, APR, statement day and data is silently lost
- **Code location:** `client/src/features/accounts/components/AddAccountModal.tsx:114-136`
- **Evidence:**
  ```typescript
  // Lines 120-129 - creditLimit, apr, statementDay NOT included
  createMutation.mutate({
    name,
    type: mapTypeToStorageType(selectedType),
    initialBalance: balanceDecimal.toFixed(2),
    institution: institutionValue,
    currency: selectedType === "bank" ? currency : "ZMW",
    notes: notes || undefined,
    ownerUserId,
  });
  // Missing: creditLimit, apr, statementDay fields
  ```

### BUG-002: onAddTransaction Does Nothing
- **What should happen:** Clicking "Add transaction" from account detail opens transaction modal
- **What actually happens:** Handler is a TODO comment - `() => { /* TODO: Implement */ }`
- **User impact:** Primary action button does nothing
- **Code location:** `client/src/pages/AccountDetail.tsx:119-121`
- **Evidence:**
  ```typescript
  <AccountTransactions
    groupedTransactions={groupedTransactions}
    isLoading={transactionsLoading}
    currency={account.currency}
    onAddTransaction={() => {
      // TODO: Implement add transaction modal
    }}
  />
  ```

### BUG-003: "Transfer data" Button Has No Handler
- **What should happen:** Button opens account transfer/merge functionality
- **What actually happens:** DropdownMenuItem rendered but NO onClick handler
- **User impact:** Users click expecting to transfer/merge accounts, nothing happens
- **Code location:** `client/src/features/accounts/components/detail/AccountDetailHeader.tsx:110-113`
- **Evidence:**
  ```typescript
  <DropdownMenuItem>
    <ArrowRightLeft className="mr-2 h-4 w-4" />
    Transfer data
  </DropdownMenuItem>
  // ❌ No onClick handler!
  ```

### BUG-004: "Edit balance history" Button Has No Handler
- **What should happen:** Button opens historical balance editing interface
- **What actually happens:** DropdownMenuItem rendered but NO onClick handler
- **User impact:** Users cannot correct historical balance entries
- **Code location:** `client/src/features/accounts/components/detail/AccountDetailHeader.tsx:138-141`
- **Evidence:**
  ```typescript
  <DropdownMenuItem>
    <History className="mr-2 h-4 w-4" />
    Edit balance history
  </DropdownMenuItem>
  // ❌ No onClick handler!
  ```

### BUG-005: Money Class Misuse - Hardcoded Currency
- **What should happen:** Balance adjustment uses account's actual currency
- **What actually happens:** Hardcoded "ZMW" currency regardless of account currency
- **User impact:** Multi-currency accounts may have precision errors
- **Code location:** `server/modules/accounts/accounts.controller.ts:299`
- **Evidence:**
  ```typescript
  const adjustmentAmount = new Money(parseResult.data.amount, "ZMW").toNumber();
  // ❌ Should use account.currency, not hardcoded "ZMW"
  ```
- **Violates:** CLAUDE.md Rule 1 (Money/Arithmetic Rule)

### BUG-006: Owner Filter Done Client-Side (Privacy Leak)
- **What should happen:** Server filters accounts by ownerUserId, returns only visible accounts
- **What actually happens:** Client fetches ALL accounts, filters in useAccountsData.ts
- **User impact:** Private accounts may be leaked to client before filtering
- **Code location:** `client/src/features/accounts/hooks/useAccountsData.ts:61-64`
- **Evidence:**
  ```typescript
  // Client-side filtering - privacy violation!
  const isMatch =
    ownerUserId === "all" ||
    (ownerUserId === null && account.ownerUserId === null) ||
    (ownerUserId !== null && account.ownerUserId === ownerUserId);
  ```

---

## Missing Functionality (Feature Incomplete)

### MISSING-001: Property/Vehicle Fields Not Wired
- **Client expects:** Form has estimatedValue, purchaseDate, address fields
- **Server provides:** Schema may not have these columns
- **Gap:** State is managed (lines 36-38) but never sent to API
- **Location:** `AddAccountModal.tsx:36-38, 120-129`

### MISSING-002: Investment Type Not Sent
- **Client expects:** investmentType dropdown selection
- **Server provides:** Unknown if schema supports
- **Gap:** State managed at lines 32, 207-208 but not in mutation
- **Location:** `AddAccountModal.tsx:32`

### MISSING-003: "Edit Multiple" Button Has No Handler
- **Client expects:** Bulk edit functionality for transactions
- **Server provides:** Unknown
- **Gap:** Button rendered but onClick is missing
- **Location:** `AccountTransactions.tsx:29-31`

### MISSING-004: RefreshCw Icon Has No Action
- **Client expects:** Refresh account data
- **Server provides:** Refetch available via hooks
- **Gap:** Icon has cursor-pointer but no onClick handler
- **Location:** `AccountSidebar.tsx:64`

---

## Data Integrity Issues

### INTEGRITY-001: Currency Hardcoded for Non-Bank Accounts
- **Scenario:** Create a mobile money account with USD
- **Result:** Currency forced to "ZMW" regardless of user selection
- **Code:** `currency: selectedType === "bank" ? currency : "ZMW"` (line 126)
- **Fix:** Allow currency selection for all account types
- **Location:** `AddAccountModal.tsx:126`

---

## Business Logic Gaps

### LOGIC-001: No Rate Limiting on Any Endpoint
- **Rule:** Financial APIs should have rate limiting to prevent abuse
- **Current behavior:** All 18 endpoints have no rate limiter middleware
- **Example:** User could spam create/delete accounts unlimited times
- **Location:** `server/modules/accounts/accounts.routes.ts`
- **Fix:** Add `generalLimiter` from `server/middleware/rateLimit.ts`

---

## API-Client Contract Mismatches

| Endpoint | Client Expects | Server Returns | Status |
|----------|---------------|----------------|--------|
| POST /accounts | creditLimit, apr, statementDay | ❌ Not in payload | ❌ |
| POST /accounts | estimatedValue, purchaseDate, address | ❌ Not in payload | ❌ |
| GET /accounts | list with balances | ✅ Returns correctly | ✅ |
| GET /accounts/:id | account details | ✅ Returns correctly | ✅ |
| GET /accounts/summary | assets, liabilities, netWorth | ✅ Returns correctly | ✅ |
| GET /accounts/summary/history | net worth over time | ✅ Returns correctly | ✅ |
| POST /:id/adjust-balance | MoneyDto | ✅ Validated | ✅ |
| POST /:id/archive | archive flag | ✅ Works | ✅ |
| POST /:id/unarchive | unarchive flag | ✅ Works | ✅ |
| GET /:id/balance-history | history array | ✅ Works | ✅ |
| POST /:id/balance-history/import | CSV import | ✅ Works | ✅ |
| GET /:id/transactions/export | CSV download | ✅ Works | ✅ |
| POST /:id/transactions/import | CSV import | ✅ Works | ✅ |

---

## User Flows Verified

| Flow | Status | Notes |
|------|--------|-------|
| Add bank account | ⚠️ | Works but currency forced for non-bank |
| Add credit card | ❌ | Credit limit, APR, statement day lost |
| Add mobile money | ⚠️ | Works but currency forced to ZMW |
| Add investment | ⚠️ | investmentType not persisted |
| Add property | ❌ | estimatedValue, address not persisted |
| Add vehicle | ❌ | estimatedValue, purchaseDate not persisted |
| View account list | ✅ | Grouped by type correctly |
| View net worth chart | ✅ | Chart renders with history |
| Edit account | ✅ | Opens modal, saves changes |
| Delete account | 🔍 | Not tested - no UI button visible |
| Archive account | 🔍 | Endpoint exists, UI untested |
| Import transactions CSV | ✅ | Modal exists and functional |
| Import balance history | ✅ | Modal exists and functional |
| Export summary CSV | ✅ | Download works |
| Bulk edit transactions | ❌ | Button exists, no handler |
| Refresh account status | ❌ | Icon exists, no handler |
| Add transaction from detail | ❌ | Button exists, handler is TODO |

---

## Type Safety Issues

### TYPE-001: `as any` Cast in AccountTransactions
- **Location:** `AccountTransactions.tsx:84`
- **Code:** `(tx as any).categoryName || "Uncategorized"`
- **Issue:** Transaction type doesn't include categoryName
- **Fix:** Add categoryName to Transaction type or use proper join

### TYPE-002: `any[]` in NetWorthSummary Props
- **Location:** `NetWorthSummary.tsx:10,17`
- **Code:** `groupedAccounts: Record<string, any[]>`
- **Fix:** Use proper `Account[]` type

---

## Security Considerations

### SEC-001: No Rate Limiting
- **Risk:** Denial of service, resource exhaustion
- **Affected endpoints:** All 18 endpoints in accounts.routes.ts
- **Fix:** Apply rate limiters per CLAUDE.md rules

### SEC-002: Household Scoping
- **Status:** ✅ PASS - All queries use `householdId` from context
- **Evidence:** `accounts.controller.ts` uses `req.householdContext!`

### SEC-003: Role Enforcement
- **Status:** ✅ PASS - Write operations require `member` role
- **Evidence:** `requireRole("member")` on POST/PUT/DELETE routes

---

## Recommendations

### P0 (Blocking - Must Fix Before Release)
1. **Fix credit card data loss** - Add creditLimit, apr, statementDay to mutation payload
2. **Implement onAddTransaction** - Wire to AddTransactionModal
3. **Add rate limiting** - Apply generalLimiter to all routes
4. **Fix Money class hardcoded currency** - Use account.currency instead of "ZMW" in controller
5. **Move owner filtering server-side** - Filter by ownerUserId in API, not client

### P1 (Major - Should Fix This Sprint)
6. Remove or implement "Edit multiple" button
7. Remove or implement "Transfer data" button
8. Remove or implement "Edit balance history" button
9. Wire RefreshCw icon to refetch
10. Fix currency being forced to ZMW for non-bank accounts
11. Remove `as any` type casts
12. Wire property/vehicle fields to API

### P2 (Minor - Nice to Have)
13. Add delete account button to UI
14. Add account archiving UI
15. Add investmentType to API schema

---

## Files Requiring Changes

| File | Line(s) | Action | Priority |
|------|---------|--------|----------|
| `AddAccountModal.tsx` | 120-129 | Add creditLimit, apr, statementDay, estimatedValue, purchaseDate, address to mutation | P0 |
| `AccountDetail.tsx` | 119-121 | Implement add transaction handler | P0 |
| `accounts.routes.ts` | all | Add `generalLimiter` middleware | P0 |
| `accounts.controller.ts` | 299 | Use account.currency instead of hardcoded "ZMW" | P0 |
| `useAccountsData.ts` | 61-64 | Move ownerUserId filtering to server API | P0 |
| `AccountDetailHeader.tsx` | 110-113 | Wire or remove "Transfer data" button | P1 |
| `AccountDetailHeader.tsx` | 138-141 | Wire or remove "Edit balance history" button | P1 |
| `AccountTransactions.tsx` | 29-31 | Wire or remove "Edit multiple" button | P1 |
| `AccountSidebar.tsx` | 64 | Wire RefreshCw to refetch or remove cursor-pointer | P1 |
| `AddAccountModal.tsx` | 126 | Allow currency selection for all account types | P1 |
| `AccountTransactions.tsx` | 84 | Fix `as any` cast | P1 |
| `NetWorthSummary.tsx` | 10,17 | Fix `any[]` type | P1 |

---

## Data Flow Diagram

```
Add Account Flow:
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ AddAccountModal │───>│ useCreateAccount │───>│ POST /accounts  │
│                 │    │ (hook)           │    │                 │
│ Collects:       │    │                  │    │ Receives:       │
│ - name ✅       │    │ Sends only:      │    │ - name ✅       │
│ - type ✅       │    │ - name           │    │ - type ✅       │
│ - balance ✅    │    │ - type           │    │ - balance ✅    │
│ - currency ⚠️   │    │ - balance        │    │ - currency ✅   │
│ - creditLimit ❌│    │ - currency       │    │                 │
│ - apr ❌        │    │ - notes          │    │ ❌ creditLimit  │
│ - statementDay❌│    │ - ownerUserId    │    │ ❌ apr          │
│ - estimatedVal❌│    │                  │    │ ❌ statementDay │
│ - purchaseDate❌│    │ ❌ Missing fields│    │ ❌ estimatedVal │
│ - address ❌    │    │    not sent!     │    │ ❌ purchaseDate │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

---

## Compliance Scores

| Category | Score | Notes |
|----------|-------|-------|
| CRUD Operations | 80/100 | Core works, but data loss on credit cards |
| API-Client Contract | 70/100 | Multiple fields not wired |
| Rate Limiting | 0/100 | None applied |
| Authorization | 90/100 | Household scoping correct, but client-side owner filtering is a gap |
| Type Safety | 75/100 | 2 `as any` casts found |
| Error Handling | 90/100 | Proper error states |
| Audit Logging | 85/100 | Present in controller |
| Money Class Usage | 60/100 | Hardcoded "ZMW" currency in balance adjustment |
| Dead UI | 40/100 | 4 buttons with no handlers |

**Overall: 65/100** - NEEDS FIXES before release

---

## Test Cases Needed

### Missing Test Coverage
1. Create credit card account with all fields - verify persistence
2. Create property account with address - verify persistence
3. Create vehicle with purchase date - verify persistence
4. Rate limit enforcement test
5. "Edit multiple" button interaction test
6. "Add transaction" from account detail test
7. Currency selection for non-bank accounts test

---

## References

- [Monarch Money](https://www.monarch.com/)
- [Monarch Help Center - Accounts](https://help.monarch.com/hc/en-us)
- CLAUDE.md - Rate Limiting Rules (Section 12)
- CLAUDE.md - Controller Pattern Rules (Section 5)
