# Migration Guide: Legacy Routes to Modular Architecture

This guide covers migrating from legacy route files to the new modular architecture.

> **Status Update (2026-01-13):** Module cutover is complete. All routes now use the modular architecture. Feature flags have been removed and legacy route files have been deleted.

## Overview

The modular architecture moves from route-centric files to domain-driven modules:

```
BEFORE (Legacy)                    AFTER (Modular)

server/routes/auth.ts            server/modules/auth/
server/routes/accounts.ts        server/modules/accounts/
server/routes/goals.ts           server/modules/goals/
server/routes/transactions.ts    server/modules/transactions/
```

## Current State (Cutover Complete)

All modules now use the modular architecture. The following legacy route files have been deleted:

- `server/routes/settings.ts` → `server/modules/settings/`
- `server/routes/household.ts` → `server/modules/household/`
- `server/routes/categories.ts` → `server/modules/categories/`
- `server/routes/merchants.ts` → `server/modules/merchants/`
- `server/routes/tags.ts` → `server/modules/tags/`
- `server/routes/rules.ts` → `server/modules/rules/`
- `server/routes/reports.ts` → `server/modules/reports/`
- `server/routes/budgets.ts` → `server/modules/budgets/`
- `server/routes/recurring.ts` → `server/modules/recurring/`
- `server/routes/receipts.ts` → `server/modules/receipts/`
- `server/routes/notifications.ts` → `server/modules/notifications/`
- `server/routes/investments.ts` → `server/modules/investments/`
- `server/routes/weekly-recap.ts` → `server/modules/weekly-recap/`

## Historical Migration Steps (For Reference)

### 1. Verify Module Readiness

Before switching, confirm the module passes all checks:

```bash
# Type check
npx tsc --noEmit

# Run module-specific tests (if available)
npm test -- --grep "auth.service"
```

### 2. Update routes.ts

```typescript
// server/routes.ts

// BEFORE: Direct route file import
import authRoutes from "./routes/auth";

// AFTER: Module import
import { authRoutes } from "./modules/auth";

// Wire the module
app.use("/auth", authRoutes);
```

### 3. Verify Endpoint Parity

| Endpoint            | Legacy | Module | Notes            |
| ------------------- | ------ | ------ | ---------------- |
| POST /auth/login    |      |      | Same behavior    |
| POST /auth/register |      |      | Same behavior    |
| GET /auth/me        |      |      | Add userId guard |
| POST /auth/logout   |      |      | Same behavior    |

### 4. Monitor After Switch

```typescript
// Add logging to track usage
logger.info("Request handled by modular auth", { path: req.path });
```

## Rollback Procedure

For rollback, use git to restore the previous state:

```bash
# Restore to pre-cutover state if needed
git checkout pre-phase3-cutover

# Or restore specific files
git checkout HEAD~N -- server/routes/
```

## Module-Specific Notes

### Auth Module

- Uses `authLimiter` middleware (10 req/min)
- Lockout: 5 failed attempts  15 min lock

### Transactions Module

- Uses `householdGuard` for all routes
- Write ops require `member` role

### Accounts Module

- Uses `householdGuard` for all routes
- Import/export are heavy operations

### Goals Module

- Consolidates 4 services into single controller
- Route ordering critical (global before `:id`)

