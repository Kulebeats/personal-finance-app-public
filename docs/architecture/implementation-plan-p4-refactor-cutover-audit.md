Implementation Plan: P4 Modal Refactor, Module Cutover, and Audit Logging

Status: ✅ COMPLETE (Merged to main 2026-01-13)
Owner: TBD
Last updated: 2026-01-13
QA Score: 100% (all required items complete)

## Summary

This plan consolidates the remaining work for the P4 refactor and audit logging rollout while avoiding breaking changes. It reflects the current repo state (verified 2026-01-13) and focuses on safe cutover, cleanup, and reducing complexity in `GoalDetailModal`.

## Current State Snapshot (Code-Verified 2026-01-13)

| Component                | Status     | Details                                                        |
| ------------------------ | ---------- | -------------------------------------------------------------- |
| **AddTransactionModal**  | DONE       | 273 LOC - meets <300 target                                    |
| **GoalDetailModal**      | DONE       | Refactored with hooks and tabs                                 |
| **BusinessAuditService** | DONE       | Active in transactions, budgets, recurring, goals              |
| **Feature Flags**        | DONE       | Removed - all modules using modular routes                     |
| **Legacy Routes**        | DONE       | Deleted (26 files removed)                                     |
| **Controller Splits**    | DONE       | goals (383 LOC + assignments 231 LOC), transactions (491 LOC)  |

### Audit Logging Coverage (Verified)

- Audit logging already exists in goals, transactions, budgets, and recurring controllers.
- Coverage includes CRUD, transfers, goal assignments, and transaction links.

### Investment Route Files (DELETED)

These legacy subroute files have been deleted after cutover:

```
server/routes/investments.ts (and 11 subroute files) - DELETED
```

### QA Blockers (From QA Report v2)

| Issue                                               | Severity | Status                                    |
| --------------------------------------------------- | -------- | ----------------------------------------- |
| TypeScript build error (settings.report-widgets.ts) | CRITICAL | ✅ FIXED                                  |
| Floating point arithmetic in services               | HIGH     | ✅ FIXED (Phase 2.6)                      |
| transactions.controller.ts 528 LOC (target <500)    | MEDIUM   | ✅ FIXED (491 LOC)                        |
| goals.controller.ts ~569 LOC (target <500)          | MEDIUM   | ✅ FIXED (383 LOC + assignments 231 LOC)  |
| Direct DB queries in rules/merchants controllers    | MEDIUM   | ✅ FIXED (Phase 2.7)                      |
| `any` usage in production code                      | LOW      | 🔄 PARTIAL (64→61)                        |

### Server Files Over 500 LOC (Split Required)

| File                            | LOC  | Split Strategy                                           |
| ------------------------------- | ---- | -------------------------------------------------------- |
| settings.ts                     | 1459 | → profile, notifications, preferences, display, security |
| merchants.ts                    | 1279 | → crud, rules, analytics, imports                        |
| categories.ts                   | 1070 | → crud, groups, rules                                    |
| RecurringService.ts             | 1035 | → rule CRUD, linking, processing, projections            |
| storage.ts                      | 1032 | → households, users, preferences, settings               |
| GoalService.ts                  | 1013 | → crud, progress, contributions, projections             |
| security.ts                     | 916  | → audit, roles, sessions, mfa                            |
| GoalAccountAssignmentService.ts | 846  | → assignments, linking, calculations                     |
| reports.ts                      | 833  | → annual, cashflow, networth, spending                   |
| AccountService.ts               | 774  | → crud, balances, history                                |
| TransactionRepository.ts        | 733  | → queries, mutations, filters                            |
| BudgetService.ts                | 698  | → crud, forecast, recalc                                 |

### Client Files Over 300 LOC (Split Required)

| File                      | LOC | Split Strategy                              |
| ------------------------- | --- | ------------------------------------------- |
| GoalDetailModal.tsx       | 824 | → header, progress, activity, actions, hook |
| FiltersModal.tsx          | 712 | → header, sections, hook                    |
| AddAccountModal.tsx       | 677 | → basics form, advanced form, hook          |
| Layout.tsx                | 506 | → sidebar, topnav, shell                    |
| ReceiptDetailModal.tsx    | 483 | → header, line items, actions, hook         |
| TransactionFormFields.tsx | 463 | → basics, meta, split fields                |
| MerchantsSection.tsx      | 430 | → toolbar, table, hook                      |
| MembersSection/index.tsx  | 428 | → header, table, invite modal, hook         |

## Goals

- Reduce `GoalDetailModal` complexity without changing behavior.
- Staged module cutover with safe rollback steps.
- Remove dead legacy route files only after route cutover.
- Audit logging coverage validated and expanded to all financial write operations.

## Non-Goals (for this pass)

- Rewriting service layer into module-local services.
- Large UI redesign or new UX features.
- Removing investment sub-routes that are not covered by the modular investments module.

## Decisions

- Audit logging must cover all financial writes (see Audit Logging Matrix).
- Module cutover is staged per-module (see Cutover Order).
- `server/services/*` is a stable internal API for now; migration is a separate phase.

## Risks and Mitigations

- Risk: Deleting `server/services/*` breaks module imports.
  - Mitigation: Do not delete service files until all module controllers use module-local services.
- Risk: Cutover reveals API parity gaps.
  - Mitigation: Compare legacy vs modular responses and run targeted API tests before deleting legacy routes.
- Risk: Audit logging adds latency or failures.
  - Mitigation: Keep audit logs non-blocking and ensure failures only log warnings.
- Risk: Money class requires currency context not available in all service methods.
  - Mitigation: Before replacing `parseFloat`, verify currency is available in scope. If missing, fetch from related entity (e.g., Goal, Account, Transaction).
- Risk: Service splits break inter-service dependencies.
  - Mitigation: Map dependencies before splitting. Split order: independent services first, then dependents (e.g., split `GoalAccountAssignmentService` before `GoalService` if GoalService depends on it).
- Risk: File splits introduce inconsistent naming.
  - Mitigation: Follow established patterns (see File Naming Convention below).

## Detailed Implementation Plan

### Phase 0: Pre-flight and Inventory (0.5-1h)

1. ✅ Fix TypeScript build error in `settings.report-widgets.ts` (duplicate default export)
2. Confirm current route wiring and feature flags.
3. Verify AddTransactionModal refactor stays intact (no edits needed unless regressions).
4. Inventory legacy routes and confirm which are still referenced by `server/routes.ts`.
5. Confirm staged cutover order (see Cutover Order section).

Deliverables:

- Updated inventory checklist (see Detailed File Inventory section).
- Confirmed list of legacy routes safe to delete after cutover.

### Phase 1: GoalDetailModal Refactor (3-5h)

Goal: shrink the modal to a thin shell that delegates data, derived state, and tab rendering.

Steps:

1. Extract data and derived values into a hook.

   - `useGoalDetailData` (or `useGoalDetailState`) returns:
     - Fetches: `goal`, `assignments`, `transfers`, `activity`, `contributions`, `goalTransactions`, `paymentTransactions`.
     - Derived: `targetAmount`, `currentAmount`, `progressAmount`, `remainingAmount`, `percentComplete`, flags like `contributionEnabled`, `usesHoldings`, `usesContributionSource`.
   - Keep existing `open` gating to avoid unnecessary queries.

2. Split tab content into components:

   - `GoalOverviewTab` (payoff scenarios, strategy panels, contribution CTA).
   - `GoalAssignmentsTab` (assignments list + add assignment form).
   - `GoalTransfersTab` (list + create transfer CTA).
   - `GoalActivityTab` (activity list).
   - `GoalTransactionsTab` (linked transactions or payment history).

3. Extract modal action state to a small hook or local component:

   - Modal opens: edit, transfer, link, contribution.
   - Assignment form state: `assignmentType`, `assignmentAccountId`, `partialAmount`.
   - Custom payoff: `customPayment`, `customOneTime`, `scenarioKey`.

4. Fix known small issues while refactoring:
   - Replace hardcoded `"USD"` in assignment partial amount with `goal.currency`.
   - Ensure computed values are memoized where needed to avoid rerenders.

Acceptance criteria:

- `GoalDetailModal` is < 300 LOC.
- Extracted components are single-responsibility and reuse existing UI components.
- No UI or behavior regressions in the five tabs.

### Phase 2: Audit Logging Coverage (1-2h)

Goal: confirm audit logging meets "financial write operations" requirement and add missing events.

Steps:

1. Verify existing coverage in transactions, budgets, recurring rules, goals.
2. Add audit events for additional financial writes (see Audit Logging Matrix).
3. Standardize audit details payloads:
   - Include `oldValue`/`newValue` where relevant.
   - Minimal, consistent fields to avoid sensitive data leakage.

Acceptance criteria:

- All relevant write routes log to `audit_logs`.
- Failures do not block the primary operation.

### Phase 2.5: File Size Refactoring (3-5h)

Goal: Reduce all server files to <500 LOC and client pages/components to <300 LOC.

**Pre-requisites:**

- [ ] Verify existing test coverage for files being split (run `npm run test:coverage:all`)
- [ ] Document current API response shapes for routes being split (for regression comparison)

**File Naming Convention (Decision):**

| Type                | Pattern                                                          | Example                                            |
| ------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| Legacy route splits | `server/routes/{domain}.{subdomain}.ts`                          | `settings.profile.ts`, `settings.notifications.ts` |
| Service splits      | `server/services/{Domain}/{subdomain}.ts` + `index.ts` re-export | `services/Goal/crud.ts`, `services/Goal/index.ts`  |
| Storage splits      | `server/storage/{domain}.ts` + `index.ts` re-export              | `storage/households.ts`, `storage/index.ts`        |
| Client splits       | `{component}/components/{Sub}.tsx` + hook in `hooks/`            | `GoalDetailModal/components/OverviewTab.tsx`       |

**Service Split Order (dependency-aware):**

1. `BudgetService` (no internal deps)
2. `AccountService` (no internal deps)
3. `GoalAccountAssignmentService` (no internal deps)
4. `GoalService` (depends on GoalAccountAssignmentService)
5. `RecurringService` (may depend on other services)

Execution sequence (low risk → high risk):

1. **Route splits** (settings → merchants → categories → reports) with no logic changes
2. **Service splits** with public API preserved (Budget → Account → GoalAccountAssignment → Goal → Recurring)
3. **Storage split** and re-export via index.ts
4. **Client component splits** (start with Layout, then modals)

Run `npm run check` after each cluster.

**Post-split verification:**

- [ ] Compare API response shapes before/after for affected routes
- [ ] Run full test suite (`npm run test:run && npm run test:server:run`)

Acceptance criteria:

- No server file in `server/routes/` or `server/services/` exceeds 500 LOC
- No client file in `client/src/pages/` or `client/src/components/` exceeds 300 LOC
- All existing tests pass
- API responses unchanged (verified via snapshot or manual comparison)

### Phase 2.6: Floating Point Arithmetic Fix (2-3h)

Goal: Replace parseFloat/Math arithmetic with Decimal-safe Money utilities.

**Pre-requisites:**

- [ ] Run inventory command to find all arithmetic sites:

  ```bash
  rg -n "parseFloat\(|Math\.round|/\s*100|Number\(value\.amount\)" server --glob '!**/*.test.ts'
  ```

- [ ] Verify currency is available in each service context before starting
- [ ] For methods missing currency, identify source entity (Goal, Account, Transaction)
- [ ] Categorize each site:
  - "Core balance math" → Must use Money/Decimal
  - "Presentation rounding" → Use Money helpers
  - "Report aggregation" → Use Money or Decimal

**Currency Context Map:**

| Service                      | Currency Source                       |
| ---------------------------- | ------------------------------------- |
| GoalService                  | `goal.currency`                       |
| GoalAccountAssignmentService | `goal.currency` or `account.currency` |
| AccountService               | `account.currency`                    |
| TransactionGoalLinkService   | `transaction.currency` via account    |
| RuleService                  | `transaction.currency` (runtime)      |
| goalCalculations             | Pass currency as parameter            |

Files requiring fixes:

| File                            | Instances | Risk   |
| ------------------------------- | --------- | ------ |
| GoalService.ts                  | 25+       | HIGH   |
| GoalAccountAssignmentService.ts | 10+       | HIGH   |
| RuleService.ts                  | 4         | MEDIUM |
| AccountService.ts               | 3         | MEDIUM |
| TransactionGoalLinkService.ts   | 5         | MEDIUM |
| goalCalculations.ts             | 4         | MEDIUM |

Steps:

1. Import Money class from `server/core/money.ts`
2. Verify currency availability in each method (see Currency Context Map)
3. Replace `parseFloat(String(x))` with `new Money(x, currency)`
4. Replace `Math.round(x * 100) / 100` with `money.round()`
5. Update return types to use MoneyDto where applicable
6. For methods without currency context, add currency parameter or fetch from related entity

Acceptance criteria:

- `rg "parseFloat|Math\.round" server/services` returns 0 matches in financial code
- Existing tests pass
- No new `any` types introduced for currency handling

### Phase 2.7: Controller Cleanup (1-2h)

Goal: Remove direct DB access from controllers and fix LOC violations.

**Controller Split Strategy:**

For controllers over 500 LOC, split into capability-based sub-controllers:

```text
goals.controller.ts (565 LOC) →
  ├── goals.mappers.ts          (pure mapping/transformation helpers)
  ├── goals.read.controller.ts  (list, get, read endpoints)
  └── goals.actions.controller.ts (create, update, delete)

transactions.controller.ts (528 LOC) →
  ├── transactions.mappers.ts
  ├── transactions.read.controller.ts
  └── transactions.actions.controller.ts
```

**Steps:**

1. Identify logical sections in each controller (list, create, update, delete, mappers)
2. Extract pure mapping/helper functions to `*.mappers.ts`
3. Split handlers into `*.read.controller.ts` and `*.actions.controller.ts`
4. Update `*.routes.ts` to import from new sub-controllers
5. Ensure exported function signatures remain identical (no route breakage)
6. Verify with `npm run check`

Controller LOC fixes:

| File                       | Current | Target | Action                          |
| -------------------------- | ------- | ------ | ------------------------------- |
| transactions.controller.ts | 528     | <500   | Split to read/actions + mappers |
| goals.controller.ts        | ~569    | <500   | Split to read/actions + mappers |

Direct DB query removal:

- [ ] `rules.controller.ts:111` - Move `db.query.rules.findFirst` to RuleService
- [ ] `merchants.controller.ts` - Move DB queries to MerchantService

Acceptance criteria:

- `rg "db\.|db\.query" server/modules/*controller.ts` returns only health.controller.ts
- All controllers under 500 LOC
- Routes still map to same handlers (no API changes)

### Phase 2.8: Type Hygiene - `any` Reduction (1-2h)

Goal: Reduce `any` usage in production code to improve type safety.

**Inventory command:**

```bash
rg -n ": any|as any|<any>|\bany\b" server --glob '!**/*.test.ts' --glob '!**/*.spec.ts' -c
```

**Known locations (from QA Report D1):**

| File                     | Issue                 | Difficulty |
| ------------------------ | --------------------- | ---------- |
| errorHandler.ts          | `any` in error types  | Easy       |
| storage.ts               | `Record<string, any>` | Medium     |
| TransactionRepository.ts | Dynamic query results | Medium     |
| Transactions.tsx         | Event handlers        | Easy       |
| settings.ts              | Config objects        | Medium     |

**Triage categories:**

1. **Easy wins** - Replace with known interfaces:

   - `any` → concrete DTO types
   - `Promise<any>` → `Promise<ConcreteType>`
   - `Record<string, any>` → typed dictionaries

2. **Medium** - Narrow union types or add generics:

   - Middleware request data → typed request extensions
   - Zod-inferred types where schemas exist

3. **Hard** - Dynamic objects requiring refactor:
   - Defer to future phase or document exception

**Steps:**

1. Run inventory command and count baseline
2. Start with "easy wins" in non-critical paths
3. For middleware/request data, use Zod-inferred types
4. Ensure each change compiles without widening errors
5. Document any intentional `any` usage with `// eslint-disable-next-line` + reason

Acceptance criteria:

- `any` count reduced by 50% in production code
- No new `any` introduced in recent changes
- `npm run check` passes

### Phase 3: Module Cutover (2-3h)

Goal: staged per-module cutover to modular routes.

**Pre-requisites (REQUIRED):**

```bash
# Create rollback checkpoint BEFORE starting cutover
git tag pre-phase3-cutover -m "Checkpoint before module cutover"
git push origin pre-phase3-cutover
```

Cutover Order (Decision):

- Tags/Categories/Merchants
- Notifications/Rules/Receipts
- Settings/Household
- Reports/Weekly Recap
- Budgets/Recurring
- Investments (last due to subroutes)

Steps:

1. For each module in the cutover order:
   - Replace its `FEATURE_FLAGS` branch with the modular route.
   - Remove the legacy import for that module.
   - Run targeted API checks for that module.
2. After the final module:
   - Remove `server/config/featureFlags.ts` and all remaining flag usage.
   - Update `/api/health/routes` to remove flag reporting.
3. Delete legacy route files only after the staged cutover compiles and tests pass.
4. Keep `server/services/*` until the service layer is fully migrated into modules.

Acceptance criteria:

- Server builds cleanly without `featureFlags.ts`.
- All modular routes mount correctly.
- Legacy route files are no longer imported anywhere.

### Phase 4: Cleanup and Docs (1-2h)

1. Remove unused imports and dead code references.
2. Update docs referencing feature flags or legacy routes.
3. Final pass to ensure no module imports from `server/routes/*`.

### Phase 5: Integration Test Gaps (1-2h)

Goal: Fill missing integration test coverage identified in QA report.

Missing tests:

- [ ] `server/routes/__tests__/recurring.integration.test.ts` - Add preview occurrences test
- [ ] `server/routes/__tests__/transactions.integration.test.ts` - Add BusinessAuditService assertions (currently only tests outbox events)

Acceptance criteria:

- All 6 required integration test flows pass (auth, transactions+audit, budgets+alerts, recurring+preview, reports, settings+audit)
- Integration test coverage reaches 100% per QA spec

## Technical Specification

### GoalDetailModal Decomposition

Proposed structure:

- `GoalDetailModal` (shell)
  - `GoalDetailsSection` (already extracted)
  - `GoalOverviewTab`
  - `GoalAssignmentsTab`
  - `GoalTransfersTab`
  - `GoalActivityTab`
  - `GoalTransactionsTab`
  - `GoalEditModal`, `GoalTransferModal`, `GoalContributionModal`, `GoalTransactionLinkModal`

Hook responsibilities:

- `useGoalDetailData({ goalId, open })`
  - Fetches all data with `open` gating.
  - Returns derived values (progress, remaining, percent, flags).
  - Encapsulates memoized calculations like scenario selection and paymentTransactions.

State responsibilities:

- `useGoalDetailState()` or internal component state:
  - UI state: tab selection, modals open.
  - Form state: assignments, custom payoff inputs.
  - Strategy results: snowball/avalanche.

Data flow:

1. Modal receives `goalId` + `open`.
2. Hook loads data and returns computed values.
3. Tab components render using the derived data and UI state callbacks.

### Audit Logging

Existing service:

- `BusinessAuditService` writes to `audit_logs` and is non-blocking.
- Use `logCreate`, `logUpdate`, `logDelete`, and `log` for custom actions (e.g., `TRANSFER`, `LINK`, `UNLINK`).

Audit payload guidance:

- `entityType`: `transaction`, `budget`, `recurring_rule`, `goal`, `goal_transfer`.
- `details`: include minimal relevant context, avoid PII.
- `ipAddress`: `businessAuditService.getIpAddress(req)`.

Audit Logging Matrix (Decision):

| Domain          | Operation                        | Audit Action         | Entity Type    | Notes                                                              |
| --------------- | -------------------------------- | -------------------- | -------------- | ------------------------------------------------------------------ |
| Transactions    | Create transaction               | CREATE               | transaction    | Include amount, accountId, categoryId.                             |
| Transactions    | Update transaction               | UPDATE               | transaction    | Include old/new core fields.                                       |
| Transactions    | Delete transaction               | DELETE               | transaction    | Include snapshot of core fields.                                   |
| Transactions    | Create transfer                  | CREATE               | transaction    | Include from/to account ids and inflow id.                         |
| Transactions    | Update transfer                  | UPDATE               | transaction    | Include transfer fields.                                           |
| Transactions    | Delete transfer                  | DELETE               | transaction    | Include transfer snapshot.                                         |
| Transactions    | Update owner                     | UPDATE               | transaction    | Include old/new owner.                                             |
| Transactions    | Bulk update owner                | UPDATE               | transaction    | Include count and new owner.                                       |
| Goals           | Create/update/delete             | CREATE/UPDATE/DELETE | goal           | Core fields only.                                                  |
| Goals           | Goal transfer                    | CREATE               | goal_transfer  | Include amount, from/to goal ids.                                  |
| Goals           | Assign account add/update/remove | UPDATE               | goal           | Include assignment ids and amounts.                                |
| Goals           | Link/unlink transaction          | LINK/UNLINK          | goal           | Include transaction id and link id.                                |
| Goals           | Contribution add                 | CREATE               | transaction    | If contribution creates a transaction, include goal id in details. |
| Budgets         | Create/update/delete             | CREATE/UPDATE/DELETE | budget         | Include amount, period, category.                                  |
| Budgets         | Move budget amount               | TRANSFER             | budget         | Include from/to budget ids and amount.                             |
| Budgets         | Forecast update                  | UPDATE               | budget         | Only if it persists changes.                                       |
| Recurring rules | Create/update/delete             | CREATE/UPDATE/DELETE | recurring_rule | Include amount, schedule, account.                                 |
| Accounts        | Create/update/delete             | CREATE/UPDATE/DELETE | account        | Only if balance or currency can change.                            |

### Module Cutover

Routing change:

- Replace `FEATURE_FLAGS` switches per-module, following the staged cutover order.
- Keep non-modular routes (`auth`, `security`, `cron`, `admin`, investment subroutes, GRZ routes) as-is.

Health endpoint:

- Replace flags output with a static list of modules or remove flag fields.

### Deletion Policy

- Delete legacy routes only after no imports remain.
- Do not delete `server/services/*` until module services are fully migrated.
- Only remove `ReportService` after legacy weekly recap routes are removed.

## Detailed File Inventory (Planned Changes)

### Client

| Path                                                                   | Action | Notes                              |
| ---------------------------------------------------------------------- | ------ | ---------------------------------- |
| `client/src/components/transactions/AddTransactionModal.tsx`           | Verify | Already refactored.                |
| `client/src/components/transactions/form/TransactionFormFields.tsx`    | Verify | Existing split.                    |
| `client/src/components/transactions/form/RecurringSettingsSection.tsx` | Verify | Existing split.                    |
| `client/src/components/transactions/form/GoalLinkingSection.tsx`       | Verify | Existing split.                    |
| `client/src/components/transactions/form/TagsSection.tsx`              | Verify | Existing split.                    |
| `client/src/components/transactions/hooks/useTransactionForm.ts`       | Verify | Existing hook.                     |
| `client/src/features/goals/components/GoalDetailModal.tsx`             | Modify | Reduce to shell.                   |
| `client/src/features/goals/components/detail/useGoalDetailData.ts`     | Add    | New hook for data + derived state. |
| `client/src/features/goals/components/detail/GoalOverviewTab.tsx`      | Add    | Overview content.                  |
| `client/src/features/goals/components/detail/GoalAssignmentsTab.tsx`   | Add    | Assignments content.               |
| `client/src/features/goals/components/detail/GoalTransfersTab.tsx`     | Add    | Transfers content.                 |
| `client/src/features/goals/components/detail/GoalActivityTab.tsx`      | Add    | Activity content.                  |
| `client/src/features/goals/components/detail/GoalTransactionsTab.tsx`  | Add    | Transactions content.              |

Note: If you prefer not to add a `detail/` folder, place the tab components alongside existing goal components.

### Server

| Path                               | Action            | Notes                                                                            |
| ---------------------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `server/routes.ts`                 | Modify            | Remove feature flag routing and update health route payload.                     |
| `server/config/featureFlags.ts`    | Delete            | Remove after `routes.ts` no longer imports it.                                   |
| `server/routes/reports.ts`         | Delete            | Legacy reports routes after cutover.                                             |
| `server/routes/budgets.ts`         | Delete            | Legacy budgets routes after cutover.                                             |
| `server/routes/recurring.ts`       | Delete            | Legacy recurring routes after cutover.                                           |
| `server/routes/categories.ts`      | Delete            | Legacy categories routes after cutover.                                          |
| `server/routes/tags.ts`            | Delete            | Legacy tags routes after cutover.                                                |
| `server/routes/merchants.ts`       | Delete            | Legacy merchants routes after cutover.                                           |
| `server/routes/notifications.ts`   | Delete            | Legacy notifications routes after cutover.                                       |
| `server/routes/weekly-recap.ts`    | Delete            | Legacy weekly recap after cutover.                                               |
| `server/routes/household.ts`       | Delete            | Legacy household after cutover.                                                  |
| `server/routes/settings.ts`        | Delete            | Legacy settings after cutover.                                                   |
| `server/routes/rules.ts`           | Delete            | Legacy rules after cutover.                                                      |
| `server/routes/receipts.ts`        | Delete            | Legacy receipts after cutover.                                                   |
| `server/routes/investments.ts`     | Delete            | Legacy investments route after cutover. Keep investment subroutes if still used. |
| `server/routes/accounts.ts`        | Delete            | Already unused by `routes.ts`. Verify no imports first.                          |
| `server/routes/transactions.ts`    | Delete            | Already unused by `routes.ts`. Verify no imports first.                          |
| `server/routes/goals.ts`           | Delete            | If present and unused.                                                           |
| `server/services/ReportService.ts` | Delete (optional) | Only after legacy weekly recap routes removed.                                   |
| `server/modules/*/*.controller.ts` | Modify (optional) | Add audit logging for any missing write endpoints.                               |

### Shared/Docs

| Path                                               | Action   | Notes                                         |
| -------------------------------------------------- | -------- | --------------------------------------------- |
| `docs\architecture\current-implementation-plan.md` | Update   | If it references feature flags/legacy routes. |
| `docs\setup\migration-guide.md`                    | Update   | If it references legacy routes.               |
| `docs/reviews/*`                                   | Optional | Update if required for compliance.            |

## Verification Plan

Automated:

- `npm run check`
- `npm run test:run`
- Line count checks (Windows):
  - `Get-Content client\\src\\components\\transactions\\AddTransactionModal.tsx | Measure-Object -Line`
  - `Get-Content client\\src\\features\\goals\\components\\GoalDetailModal.tsx | Measure-Object -Line`

Manual:

- GoalDetailModal: open all tabs, confirm data loads and actions work.
- Assignments: create full and partial assignments; verify currency.
- Transfers: create and list transfers; confirm audit log entries if required.
- Transactions: link/unlink and add contributions for save-up/investment goals.
- Budgets/Recurring/Transactions CRUD: verify audit logs are written.

## Rollback Plan

**Pre-cutover checkpoint (REQUIRED before Phase 3):**

```bash
git tag pre-phase3-cutover -m "Checkpoint before module cutover"
git push origin pre-phase3-cutover
```

**Rollback procedures:**

1. **Module cutover rollback:** If modular routes show parity issues:

   - Revert to `pre-phase3-cutover` tag: `git checkout pre-phase3-cutover`
   - Or selectively restore feature flags from git history

2. **File split rollback:** If splits introduce regressions:

   - Revert specific files from git history: `git checkout HEAD~n -- path/to/file.ts`
   - Re-run tests to verify restoration

3. **Money/arithmetic rollback:** If financial calculations show errors:

   - Revert affected service files immediately
   - Compare output with production baseline

4. **Audit logging rollback:** If performance regressions occur:
   - Stub audit calls in `BusinessAuditService` (return early)
   - Or disable via environment flag if implemented

## Execution Sequence Summary

```text
✅ Phase 0   - Pre-flight (TypeScript fix done)
✅ Phase 1   - GoalDetailModal refactor (hooks + tabs extracted)
✅ Phase 2   - Audit logging coverage (assignments, links, owner updates)
✅ Phase 2.5 - File size refactoring (route/service splits complete)
✅ Phase 2.6 - Floating point arithmetic fix (Money class adopted)
✅ Phase 2.7 - Controller cleanup (goals 383 LOC, transactions 491 LOC)
🔄 Phase 2.8 - Type hygiene (any reduction - ongoing)
✅ Phase 3   - Module cutover + legacy deletion (26 files deleted)
✅ Phase 4   - Cleanup and docs (migration guide, TODO updated)
✅ Phase 5   - Integration test gaps (audit assertions added)

🎉 MERGED TO MAIN: 2026-01-13 (76 commits, 1312 files)
```

## Remaining Questions

- None.

