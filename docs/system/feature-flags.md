# Feature Flags Reference

This document describes the feature flags used in the application for module switchover and feature toggles.

---

## Module Switchover Flags

These flags control which implementation is used for each module (legacy routes vs modular architecture).

| Flag                      | Default | Description                        |
| ------------------------- | ------- | ---------------------------------- |
| `FF_MODULE_AUTH`          | `false` | Use modular auth routes            |
| `FF_MODULE_TRANSACTIONS`  | `false` | Use modular transactions routes    |
| `FF_MODULE_BUDGETS`       | `false` | Use modular budgets routes         |
| `FF_MODULE_RECURRING`     | `false` | Use modular recurring rules routes |
| `FF_MODULE_GOALS`         | `false` | Use modular goals routes           |
| `FF_MODULE_ACCOUNTS`      | `false` | Use modular accounts routes        |
| `FF_MODULE_INVESTMENTS`   | `false` | Use modular investments routes     |
| `FF_MODULE_REPORTS`       | `false` | Use modular reports routes         |
| `FF_MODULE_SETTINGS`      | `false` | Use modular settings routes        |
| `FF_MODULE_NOTIFICATIONS` | `false` | Use modular notifications routes   |
| `FF_MODULE_RECEIPTS`      | `false` | Use modular receipts routes        |

---

## Feature Flags

| Flag                | Default | Description                      |
| ------------------- | ------- | -------------------------------- |
| `FF_ENABLE_CACHING` | `false` | Enable Redis caching for reports |
| `FF_ENABLE_JOBS`    | `false` | Enable background job processing |

---

## Usage

### Setting Flags

Add to `.env` file or environment variables:

```bash
# Enable modular transactions
FF_MODULE_TRANSACTIONS=true

# Enable caching
FF_ENABLE_CACHING=true
```

### Checking Flags in Code

```typescript
import { featureFlags } from "../config/featureFlags";

if (featureFlags.FF_MODULE_TRANSACTIONS) {
  // Use modular routes
  app.use("/api/transactions", transactionModule.routes);
} else {
  // Use legacy routes
  app.use("/api/transactions", legacyTransactionRoutes);
}
```

---

## Migration Path

1. **Phase 1:** Set all module flags to `false` (using legacy routes)
2. **Phase 2:** Enable flags one at a time, testing each module
3. **Phase 3:** Once verified, remove legacy routes and flags

### Recommended Order

1. `FF_MODULE_AUTH` - Low risk, well-tested
2. `FF_MODULE_SETTINGS` - Non-critical, isolated
3. `FF_MODULE_NOTIFICATIONS` - Independent module
4. `FF_MODULE_BUDGETS` - Medium complexity
5. `FF_MODULE_RECURRING` - Medium complexity
6. `FF_MODULE_GOALS` - Medium complexity
7. `FF_MODULE_TRANSACTIONS` - High complexity, core feature
8. `FF_MODULE_ACCOUNTS` - Depends on transactions
9. `FF_MODULE_INVESTMENTS` - Independent
10. `FF_MODULE_REPORTS` - Depends on multiple modules
11. `FF_MODULE_RECEIPTS` - Independent
