# Accounts Module Deep Review Addendum
Date: 2026-01-20
Reviewers: Senior Software Engineer, Senior QA Engineer, Fintech Compliance Expert

## Scope
- `server/modules/accounts/accounts.controller.ts`
- `server/modules/accounts/accounts.import.controller.ts`
- `server/modules/accounts/accounts.routes.ts`
- `server/modules/accounts/accounts.validation.ts`
- `server/services/account/AccountCoreService.ts`
- `server/services/account/AccountReportingService.ts`
- `server/services/account/AccountImportService.ts`
- `server/repositories/AccountRepository.ts`
- `server/jobs/snapshotWorker.ts`
- `server/services/transaction/create.ts`
- `server/repositories/reports/TransactionReportRepository.ts`
- `server/services/InvestmentPerformanceService.ts`
- `server/core/money.ts`
- `client/src/lib/api.ts`
- `client/src/features/accounts/constants.ts`
- `client/src/features/accounts/hooks/useAccountsData.ts`
- `client/src/features/accounts/components/AddAccountModal.tsx`
- `client/src/features/accounts/components/AccountDetailsForm.tsx`
- `client/src/features/accounts/components/AccountCard.tsx`
- `client/src/features/accounts/components/detail/AccountDetailHeader.tsx`
- `shared/schema.ts`

## Cross-Module Interaction Assessment
- Transactions: account visibility and currency checks gate transaction creation; transaction reports filter on `accounts.hideTransactions` and `accounts.isPrivate`. Missing import validation and audit bypass impact transaction rules, notifications, and reporting.
- Transfers: account currency and FX validation enforce cross-currency rules, but account metadata consistency drives transfer correctness.
- Goals: `goalAccountAssignmentService` syncs after balance adjustments and CSV imports; account balance accuracy directly affects goal progress.
- Recurring: imported transactions attempt `recurringService.autoLinkNewTransaction`; bypassing transaction rules can skew recurring detection.
- Reports and analytics: net worth snapshots and transaction reports rely on account flags (hidden/private); mismatched filtering or precision errors propagate into dashboards and analytics.
- Investments: `InvestmentPerformanceService` consumes `accountBalanceSnapshots`; snapshot precision and scope control long-term performance charts.
- Audit and compliance: `BusinessAuditService` covers account CRUD and balance changes, but settings and privacy updates are not fully logged.
- Client caching and filters: owner filters and view parameters depend on API forwarding; endpoint mismatches cause silent fallback behavior in the UI.

## Additional Issue Log (Add to ISSUE-ACC-001 through ISSUE-ACC-012)
### CRITICAL
### ISSUE-ACC-016: Unarchive bypasses visibility and ownership checks
- Severity: CRITICAL
- Category: Authorization and Privacy
- Evidence: `server/services/account/AccountCoreService.ts:334`
- Impact: Any household member can unarchive a private account and access it.
- Fix: Reuse `findByIdWithVisibility` and enforce owner checks before unarchive; return NotFound or Forbidden for non-visible accounts.
- Tests: Add service and route tests for non-owner unarchive.

### HIGH
### ISSUE-ACC-013: Net worth history endpoint mismatch
- Severity: HIGH
- Category: API Contract
- Evidence: `client/src/lib/api.ts:451`
- Evidence: `server/modules/accounts/accounts.routes.ts:28`
- Evidence: `server/modules/accounts/README.md:29`
- Impact: Net worth history calls 404; UI silently falls back to summary-only chart.
- Fix: Align routes; add alias for backward compatibility; update README.

### ISSUE-ACC-014: createAccount rejects valid types and misclassifies liabilities
- Severity: HIGH
- Category: Data Integrity
- Evidence: `server/services/account/AccountCoreService.ts:84`
- Evidence: `server/modules/accounts/accounts.validation.ts:15`
- Evidence: `client/src/features/accounts/constants.ts:3`
- Impact: mortgage and other_liability cannot be created; isAsset is wrong for those types.
- Fix: Sync validTypes and liabilityTypes with schema and shared enum.

### ISSUE-ACC-015: createAccount ignores ownerUserId input
- Severity: HIGH
- Category: Authorization and UX
- Evidence: `server/services/account/AccountCoreService.ts:109`
- Evidence: `client/src/features/accounts/components/AddAccountModal.tsx:103`
- Impact: shared or reassigned ownership is impossible; owner filter is inaccurate.
- Fix: honor ownerUserId when provided, with permission checks; default to creator only when ownerUserId is undefined.

### ISSUE-ACC-017: excludeFromNetWorth and isArchived not honored
- Severity: HIGH
- Category: Financial Accuracy
- Evidence: `server/repositories/AccountRepository.ts:307`
- Evidence: `server/jobs/snapshotWorker.ts:72`
- Impact: net worth includes excluded and archived accounts; toggles are misleading.
- Fix: filter out excludeFromNetWorth and isArchived in summary and snapshots.

### ISSUE-ACC-018: Net worth history scope inconsistent and can leak private balances
- Severity: HIGH
- Category: Privacy and Reporting
- Evidence: `server/services/account/AccountReportingService.ts:107`
- Evidence: `server/repositories/AccountRepository.ts:352`
- Impact: history uses household snapshots, latest uses user-scoped summary; private accounts can be inferred.
- Fix: apply user visibility and exclusion to history or return explicit scope metadata and align summary and history scopes.

### ISSUE-ACC-020: Audit log omits privacy and ownership changes on account update
- Severity: HIGH
- Category: Compliance
- Evidence: `server/modules/accounts/accounts.controller.ts:197`
- Impact: changes to isPrivate, ownerUserId, institution, notes are not audited.
- Fix: include privacy and ownership fields in logUpdate; add audit for updateSettings (existing ISSUE-ACC-002).

### ISSUE-ACC-021: CSV export lacks escaping and formula injection protection
- Severity: HIGH
- Category: Security
- Evidence: `server/services/account/AccountImportService.ts:45`
- Evidence: `server/services/account/AccountReportingService.ts:200`
- Impact: CSV injection risk and broken exports when fields contain quotes or newlines.
- Fix: centralize CSV escaping and formula sanitization for all exports.

### ISSUE-ACC-022: Transaction import bypasses transaction service
- Severity: HIGH
- Category: Data Integrity and Compliance
- Evidence: `server/services/account/AccountImportService.ts:114`
- Evidence: `server/services/transaction/create.ts:36`
- Impact: imported transactions skip currency enforcement, rules, audit, idempotency, and notifications.
- Fix: route import through transaction service or create a bulk import pipeline that reuses validation, rules, and audit; set currency to account currency.

### ISSUE-ACC-025: Net worth totals ignore multi-currency conversion
- Severity: HIGH
- Category: Financial Accuracy
- Evidence: `server/services/account/AccountReportingService.ts:29`
- Evidence: `server/repositories/AccountRepository.ts:297`
- Impact: totals are invalid when accounts are in non-base currencies.
- Fix: convert balances to household currency using FX service before summation and snapshot storage.

### ISSUE-ACC-028: parseFloat used in snapshot worker net worth calculations
- Severity: HIGH
- Category: Money Handling
- Evidence: `server/jobs/snapshotWorker.ts:103`
- Impact: floating point errors in historical net worth and analytics.
- Fix: use Money class or Decimal for snapshot aggregation; only convert at output boundaries.

### MEDIUM
### ISSUE-ACC-019: dateRange 1w accepted but treated as all
- Severity: MEDIUM
- Category: Reporting
- Evidence: `server/modules/accounts/accounts.validation.ts:130`
- Evidence: `server/services/account/AccountReportingService.ts:303`
- Impact: 1 week views return full history; performance and UX regressions.
- Fix: handle 1w in getStartDateFromRange.

### ISSUE-ACC-023: Tags and categories from CSV import and export are not wired
- Severity: MEDIUM
- Category: Data Loss
- Evidence: `server/services/account/AccountImportService.ts:105`
- Evidence: `server/repositories/AccountRepository.ts:494`
- Impact: tags and categories are dropped on import and never exported; round-trip loss.
- Fix: map category names to ids, create or match tags, and join tags on export.

### ISSUE-ACC-024: Net worth history view and assetType parameters ignored
- Severity: MEDIUM
- Category: Feature Gap
- Evidence: `server/services/account/AccountReportingService.ts:89`
- Impact: UI filters do nothing, caches fragment, and user trust drops.
- Fix: implement view and assetType handling or remove the controls until supported.

### ISSUE-ACC-026: Account details form collects unsupported fields
- Severity: MEDIUM
- Category: UX and Data Model
- Evidence: `client/src/features/accounts/components/AccountDetailsForm.tsx:111`
- Evidence: `shared/schema.ts:860`
- Impact: investment type, credit limit, APR, statement day, and property details are not persisted.
- Fix: either add data model support (schema plus API) or remove the inputs until supported.

### ISSUE-ACC-029: Amount precision mismatch between validation and storage
- Severity: MEDIUM
- Category: Money Handling
- Evidence: `server/modules/accounts/accounts.validation.ts:49`
- Evidence: `shared/schema.ts:849`
- Evidence: `server/core/money.ts:8`
- Impact: 3-4 decimal amounts are accepted but stored at 2 decimals; rounding is implicit and inconsistent.
- Fix: align validation to 2 decimals or increase storage precision and money formatting.

### ISSUE-ACC-030: Private accounts can be set without an owner
- Severity: MEDIUM
- Category: Data Integrity and Privacy
- Evidence: `server/services/account/AccountCoreService.ts:126`
- Impact: private account with null owner becomes invisible to all users.
- Fix: enforce ownerUserId when isPrivate is true; add validation on update.

### LOW
### ISSUE-ACC-027: bulkUpdateOwner transaction wrapper is not applied
- Severity: LOW
- Category: Consistency
- Evidence: `server/services/account/AccountReportingService.ts:71`
- Impact: partial updates possible despite transaction wrapper.
- Fix: pass tx into repository operations or remove withTransaction call.

## Implementation Plan (Assumes ISSUE-ACC-001 through ISSUE-ACC-012 remain in scope)
### Phase 0 - Compliance and Blocking
1. Fix authorization gaps: ISSUE-ACC-016, ISSUE-ACC-030, ISSUE-ACC-020, ISSUE-ACC-002.
2. Align net worth API routes and docs: ISSUE-ACC-013.
3. Correct account type validation and ownership creation: ISSUE-ACC-014, ISSUE-ACC-015.
4. Fix net worth scope, exclusions, and precision: ISSUE-ACC-017, ISSUE-ACC-018, ISSUE-ACC-025, ISSUE-ACC-028, ISSUE-ACC-029.
5. Harden CSV export: ISSUE-ACC-021.
6. Fix import pipeline to use transaction service and audit: ISSUE-ACC-022, ISSUE-ACC-023.

### Phase 1 - Correctness and UX
1. Handle 1w date ranges: ISSUE-ACC-019.
2. Implement or remove view and assetType filters: ISSUE-ACC-024.
3. Resolve account details form persistence strategy: ISSUE-ACC-026.
4. Address client parseFloat and unconnected fields from prior assessment: ISSUE-ACC-001, ISSUE-ACC-004, ISSUE-ACC-009.

### Phase 2 - Quality and Refactors
1. Split repositories and large components: ISSUE-ACC-005, ISSUE-ACC-011.
2. Close type safety gaps and filters: ISSUE-ACC-006, ISSUE-ACC-007.
3. Evaluate TOCTOU fix and net worth scope metadata: ISSUE-ACC-008, ISSUE-ACC-012.
4. Resolve bulkUpdateOwner transactional semantics: ISSUE-ACC-027.

## Technical Specifications
### API Contract and Routing
- Add `/accounts/summary/history` as canonical and a temporary alias `/accounts/net-worth/history`.
- Update `accountsApi.getNetWorthHistory` to hit the canonical endpoint.
- Update `server/modules/accounts/README.md` to match routes.

### Authorization and Ownership
- In `unarchiveAccount`, call `findByIdWithVisibility` and enforce private ownership before updating.
- In `createAccount`, respect ownerUserId and isPrivate from request; validate ownership changes against role policy.
- Enforce ownerUserId when isPrivate is true in update payloads.
- Expand audit logging to include privacy flags and owner changes.

### Net Worth Calculations and Scope
- Update `accountRepository.getBalancesForNetWorth` to filter `isArchived` and `excludeFromNetWorth`.
- Convert balances to household base currency via FX service before summation.
- Align net worth history scope with summary; include `scope` and `currency` metadata in response.

### Snapshots
- Replace `parseFloat` usage with Money or Decimal aggregation.
- Apply `excludeFromNetWorth`, `isArchived`, and `isHidden` in snapshot logic.
- Store base currency and derived totals consistently to match report expectations.

### Import and Export
- Create a bulk import path that validates currency and uses transaction service logic for each row.
- Add audit log entries for import operations with counts and totals.
- Implement CSV escaping and formula sanitization for all export fields.

### CSV Tags and Categories
- Resolve category names to ids; create tags if needed and link transactionTags.
- Update `getTransactionsForAccount` to join tags and include them in export.

### Client and UX
- Wire ownerUserId filter to API.
- Ensure view and assetType UI only appear when server supports them.
- Decide whether to persist investment type, credit limit, APR, statement day, and property metadata; update schema or remove inputs until supported.

## QA and Test Additions
1. Net worth history endpoint returns 200 and matches summary scope.
2. Non-owner cannot unarchive private account.
3. Create account supports mortgage and other_liability and classifies liabilities correctly.
4. createAccount respects ownerUserId including shared accounts.
5. excludeFromNetWorth and isArchived excluded from summary and snapshots.
6. Net worth summary and history use FX conversion for mixed currency accounts.
7. dateRange 1w returns a 7 day window.
8. Snapshot aggregation uses Money/Decimal and does not drift.
9. CSV export escapes quotes, newlines, and formula prefixes.
10. Import transactions enforce currency and log audit events.
11. Tags and categories round-trip via import and export.
12. view and assetType filters affect history output or are rejected.
13. Private accounts cannot be set without ownerUserId.

## Suggested Improvements
- Centralize money math and currency conversion in a shared service used by reports and account summaries.
- Add response metadata for net worth scope and currency to improve transparency.
- Introduce a dedicated account metadata table for credit terms and property details instead of ad hoc fields.

## TODO List
- P0: Fix ISSUE-ACC-016, ISSUE-ACC-013, ISSUE-ACC-014, ISSUE-ACC-015.
- P0: Implement ISSUE-ACC-017, ISSUE-ACC-018, ISSUE-ACC-025, ISSUE-ACC-028, ISSUE-ACC-029.
- P0: Implement ISSUE-ACC-020, ISSUE-ACC-021, ISSUE-ACC-022, ISSUE-ACC-023.
- P1: Implement ISSUE-ACC-019, ISSUE-ACC-024, ISSUE-ACC-026.
- P1: Complete existing P0 and P1 items from the original assessment.
- P2: Address ISSUE-ACC-027 and remaining refactors.

## Open Questions
- Should net worth be user-scoped or household-scoped by default, and should the UI let users choose?
- What is the correct policy for assigning ownerUserId on account creation for admins vs members?
- Do we want to persist credit terms and property metadata now, or hide those inputs until schema support exists?
