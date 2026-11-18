# Goals + Recurring Modules - Combined Assessment and Remediation Plan

Date: 2026-01-20
Reviewers: Senior Developer, QA Engineer, Fintech Compliance Expert
Scope: Goals module + Recurring module (server + client)
Sources: Code audit + docs/reviews/recurring-module-assessment.md

---

## Executive Summary

The goals and recurring modules have strong server-side architecture, good audit logging, and mostly consistent validation patterns. The highest risk areas are money precision (Money -> number conversions and parseFloat/Math.round usage), severe test coverage gaps, and client type safety issues. This document consolidates all findings and provides a single, detailed remediation plan with technical specs and a prioritized TODO list.

Overall Scores:
- Goals: 68/100 (PASS with required fixes)
- Recurring: 72/100 (PASS with required fixes)

---

## Module Scorecards

| Module | Score | Key Risk Themes |
|--------|-------|-----------------|
| Goals | 68/100 | Money precision, test gap, client type safety, large UI files |
| Recurring | 72/100 | Money precision, test gap, API mismatches, type casts |

---

## Open Findings - Goals Module

### CRITICAL

#### ISSUE-GOAL-TEST-001: Critical Test Coverage Gap (93% Missing)
Status: OPEN
Category: Test Coverage

Evidence:
- No goals integration tests under `server/routes/__tests__`.
- Only 3 client tests under `client/src/features/goals/__tests__`.

Impact:
- High regression risk across 16 goal endpoints and core financial flows.

Fix Spec:
- Add a server integration suite covering all goals routes and side effects.
- Add client hook tests for all goal queries and mutations.
- Add component tests for goal list, cards, and activity items.

Recommended files:
- `server/routes/__tests__/goals.integration.test.ts` (new)
- `client/src/features/goals/__tests__/...` (new tests)

Goal endpoints to cover (from `server/modules/goals/goals.routes.ts`):
- GET /available-funds
- GET /assignments
- GET /transfers
- POST /transfers
- GET /
- POST /
- GET /:id
- PUT /:id
- DELETE /:id
- GET /:id/assignments
- POST /:id/assign-account
- PUT /:id/accounts/:accountId
- DELETE /:id/accounts/:accountId
- GET /:id/transfers
- POST /:id/transactions
- DELETE /:id/transactions/:txId
- GET /:id/activity

---

### HIGH

#### ISSUE-GOAL-MONEY-001: parseFloat in Goal Status Worker
Status: OPEN
Category: Money Handling

Evidence:
- `server/jobs/goalStatusWorker.ts:9` `parseFloat(String(goal.currentAmount))`
- `server/jobs/goalStatusWorker.ts:51` `parseFloat(String(goal.currentAmount))`
- `server/jobs/goalStatusWorker.ts:80-81` `parseFloat(String(goal.currentAmount))`

Impact:
- Float drift in scheduled recalculation logic; may incorrectly skip updates or log wrong balances.

Fix Spec:
- Replace parseFloat with Money/Decimal arithmetic.
- Use `Money.from(goal.currentAmount)` and `Money.from(update.currentAmount)` for comparisons.
- For delta checks, compare `Money` with an epsilon using Decimal instead of float math.

---

#### ISSUE-GOAL-MONEY-002: Money -> Number -> Arithmetic Pattern (48 occurrences)
Status: OPEN
Category: Money Handling

Evidence:
- 48 `.toNumber()` calls in `server/services/goal/*` used for arithmetic.
- Examples:
  - `server/services/goal/assignment.calculations.ts:102`
  - `server/services/goal/assignment.service.ts:236`
  - `server/services/goal/GoalQueryService.ts:145`

Impact:
- Precision loss in cumulative calculations (balances, projections, totals).

Fix Spec:
- Keep Money/Decimal through calculations and only convert at the API boundary.
- Update helpers (e.g., `buildGoalBalanceUpdate`) to accept Money/Decimal or MoneyDto.
- For totals and projections, use Decimal math and return MoneyDto strings.

---

#### ISSUE-GOAL-CLIENT-001: parseFloat in Goals UI (37 occurrences)
Status: OPEN
Category: Money Handling (Client)

Evidence (examples):
- `client/src/features/goals/components/GoalCard.tsx:50-58`
- `client/src/features/goals/components/GoalListItem.tsx:51-60`
- `client/src/features/goals/components/GoalActivityItem.tsx:196-267`

Impact:
- Precision drift and currency context loss in UI calculations (progress, balances, formatting).

Fix Spec:
- Standardize on MoneyDto in API responses for amounts.
- Use `client/src/lib/money.ts` helpers (or new MoneyDto helpers) for display only.
- Move progress calculations server-side where possible and send computed values.

---

#### ISSUE-GOAL-TYPE-001: Client `as any` Payloads for Assignments
Status: OPEN
Category: Type Safety

Evidence:
- `client/src/features/goals/components/GoalAccountsModal.tsx:237,246,255,271`
- `client/src/features/goals/components/GoalCreationWizard.tsx:275`

Impact:
- Hides runtime schema mismatches and weakens type safety in financial payloads.

Fix Spec:
- Define a shared `AssignmentPayload` type from hooks or shared schemas.
- Replace `as any` with typed payloads.
- Ensure `useAssignAccountForGoal` and `useUpdateAssignmentForGoal` accept the typed payload.

---

#### ISSUE-GOAL-TYPE-002: `any[]` in GoalAccountsModalData
Status: OPEN
Category: Type Safety

Evidence:
- `client/src/features/goals/components/GoalAccountsModalData.ts:43`

Impact:
- Loss of account typing, easier to introduce UI bugs in grouping logic.

Fix Spec:
- Use a concrete `Account` type from hooks or shared API types.
- Type `TYPE_ICONS` as a narrow union instead of `Record<string, any>`.

---

### MEDIUM

#### ISSUE-GOAL-QUALITY-001: Client Files Exceed LOC Guidelines
Status: OPEN
Category: Maintainability

Evidence:
- `client/src/features/goals/components/GoalCreationWizard.tsx` (453 LOC)
- `client/src/features/goals/components/GoalAccountsModal.tsx` (323 LOC)
- `client/src/features/goals/components/GoalActivityItem.tsx` (308 LOC)

Impact:
- Harder to test and reason about UI behavior; higher change risk.

Fix Spec:
- Split into subcomponents and extract hook logic.
- Suggested extractions:
  - GoalCreationWizard: payload construction + assignment flow
  - GoalAccountsModal: save handler + validation + state setup
  - GoalActivityItem: metadata and balance subview

---

#### ISSUE-GOAL-VALIDATION-001: Missing Upper Bound for Money DTOs
Status: OPEN
Category: Validation

Evidence:
- `server/core/validation/money.ts:18-28` only checks positive/non-negative.
- Goals targetAmount uses MoneyDto without max bound.

Impact:
- Values beyond DECIMAL(15,2) can pass validation and fail at DB.

Fix Spec:
- Add max bound (e.g., 9,999,999,999,999.99) in money validation.
- Use Decimal to compare instead of parseFloat.

---

## Open Findings - Recurring Module

### CRITICAL

#### ISSUE-REC-001: parseFloat and Math.round in Repository
Status: OPEN
Category: Money Handling

Evidence:
- `server/repositories/RecurringRepository.ts:421`
- `server/repositories/RecurringRepository.ts:441-442`

Impact:
- Float rounding drift in recurring summaries.

Fix Spec:
- Replace parseFloat/Math.round with Money/Decimal.
- Keep monthly totals in Decimal and return MoneyDto or string.

---

#### ISSUE-REC-003: Critical Test Coverage Gap (28% Coverage)
Status: OPEN
Category: Test Coverage

Impact:
- 13 of 18 operations are untested (see recurring-module-assessment.md).

Fix Spec:
- Add 30+ tests covering lifecycle, pattern detection, linking, history, and validation.
- Prioritize link/unlink, pause/resume/end, detect/confirm patterns, and history endpoints.

---

### HIGH

#### ISSUE-REC-008: Missing Privacy Check on Transaction Linking
Status: OPEN
Category: Access Control

Evidence:
- `server/services/recurring/RecurringLinkingService.ts:102-118` uses `transactionRepository.findById` without user visibility.

Impact:
- Possible linking of transactions not visible to the requesting user.

Fix Spec:
- Require `userId` for link/unlink operations.
- Use `findByIdWithVisibility()` or equivalent and enforce ownership.

---

#### ISSUE-REC-API-001: Missing `/recurring/process` Endpoint
Status: OPEN
Category: API Mismatch

Evidence:
- Client calls `/recurring/process` in `client/src/hooks/useRecurring.ts:796`.
- No matching route in `server/modules/recurring/recurring.routes.ts`.

Impact:
- Client action fails at runtime; inability to trigger processing.

Fix Spec:
- Add route + controller handler for `/recurring/process`, or remove client call if deprecated.
- If added, protect with requireRole and rate limiter.

---

#### ISSUE-REC-API-002: History Limit Parameter Ignored
Status: OPEN
Category: API Correctness

Evidence:
- `server/modules/recurring/recurring.controller.ts:140-145` always passes `50`.

Impact:
- Client cannot control pagination.

Fix Spec:
- Parse query with `historyQuerySchema` and pass `limit` to service.

---

#### ISSUE-REC-TYPE-001: Server `as any` Casts
Status: OPEN
Category: Type Safety

Evidence:
- `server/modules/recurring/recurring.controller.ts:180`
- `server/services/recurring/RecurringLinkingService.ts:60`
- `server/services/recurring/RecurringProcessingService.ts:35`
- `server/repositories/RecurringRepository.ts:205`

Impact:
- Reduces type safety in critical paths.

Fix Spec:
- Replace casts with explicit types and Zod inference.
- Update calculateNextDate signature to accept typed frequency/options.

---

#### ISSUE-REC-MONEY-002: Money -> Number -> Money Antipattern
Status: OPEN
Category: Money Handling

Evidence:
- `server/services/recurring/RecurringProcessingService.ts:32` `toMoney(new Money(rule.amount).toNumber())`

Impact:
- Unnecessary precision loss and extra conversions.

Fix Spec:
- Avoid converting to number; keep MoneyDto and Decimal through calculations.

---

#### ISSUE-REC-CLIENT-001: MoneyDto Type Mismatches
Status: OPEN
Category: Client Type Safety

Evidence:
- `client/src/features/recurring/types.ts:16` CalendarItem.amount is `number`.
- `client/src/hooks/useRecurring.ts:238-239` RecurringTransactionLink amounts typed as `string`.
- Server maps link amounts to MoneyDto (`server/modules/recurring/recurring.controller.ts:64-76`).

Impact:
- Currency loss and incorrect formatting in UI.

Fix Spec:
- Change CalendarItem.amount to MoneyDto.
- Update RecurringTransactionLink expectedAmount/actualAmount to MoneyDto.
- Update `parseMoney` usage to accept MoneyDto and avoid currency loss.

---

#### ISSUE-REC-CLIENT-002: Client Totals Use parseMoney (Precision Loss)
Status: OPEN
Category: Money Handling (Client)

Evidence:
- `client/src/features/recurring/hooks/useRecurringPageData.ts:69-95`

Impact:
- Totals lose currency and precision when summing.

Fix Spec:
- Use MoneyDto or Decimal summation with currency context.
- Prefer server-calculated totals where possible.

---

#### ISSUE-REC-VALIDATION-001: Recurring Validation Gaps
Status: OPEN
Category: Validation

Evidence:
- Date format only (no real date check): `server/modules/recurring/recurring.validation.ts:46-55`.
- Query params parseInt without bounds: `server/modules/recurring/recurring.validation.ts:242-247`, `291-296`.
- amountVariance has no max: `server/modules/recurring/recurring.validation.ts:260-268`.
- dayOfMonth does not validate month length: `server/modules/recurring/recurring.validation.ts:56`.

Impact:
- Invalid dates and values can pass validation.

Fix Spec:
- Introduce `validDateSchema` similar to goals.
- Constrain query params with min/max and NaN checks.
- Add amountVariance max (e.g., 50).
- Add dayOfMonth validation based on month or enforce 1-28 when frequency is monthly.

---

#### ISSUE-REC-UI-001: Missing Form Fields in Recurring Settings UI
Status: OPEN
Category: UX/Feature Coverage

Evidence:
- `client/src/components/transactions/form/RecurringSettingsSection.tsx` lacks fields for custom frequency, tolerance, reminders, and subscription metadata.

Impact:
- API supports fields that users cannot set from UI.

Fix Spec:
- Add fields for intervalValue/intervalUnit, amountTolerance, reminders, subscription flags, trial end.

---

### MEDIUM

#### ISSUE-REC-QUALITY-001: RecurringRepository Exceeds LOC Limit
Status: OPEN
Category: Maintainability

Evidence:
- `server/repositories/RecurringRepository.ts` is 520 LOC (limit 500).

Fix Spec:
- Split into RecurringRepository + RecurringSummaryRepository or query helper.

---

#### ISSUE-REC-RATE-001: Route-Specific Rate Limits Missing
Status: OPEN (PARTIAL)
Category: Security/Compliance

Evidence:
- No per-route rate limiter in `server/modules/recurring/recurring.routes.ts`.
- Global `generalLimiter` applies to `/api/*` (see `server/routes.ts:90`).

Fix Spec:
- Keep global limiter.
- Add `analyticsLimiter` to `/summary` and `/detect` if heavy.

---

## Cross-Module Patterns

1. Money precision risk from parseFloat/Math.round and Money -> number conversions.
2. Large test coverage gaps for server integration and client hooks.
3. Client type safety issues (`as any`, `any[]`, MoneyDto mismatches).
4. UI maintainability issues from oversized components.
5. Minor API mismatches (missing endpoints, ignored query parameters).

---

## Technical Specifications for Improvements

### Money Handling Standard (Server)
- Do not use parseFloat/Math.round/Number for currency arithmetic.
- Use Money (Decimal) end-to-end for calculations.
- Only convert to string (Money.toString) when storing to DB or returning MoneyDto.
- If a calculation requires number output (percentages), use Decimal and round explicitly.

Implementation guidance:
- `RecurringRepository.getSummary`: use Decimal accumulation; return MoneyDto.
- `GoalStatusWorker`: use Money for comparisons and update checks.
- `Goal services`: replace `.toNumber()` arithmetic with Money/Decimal operations.

### Money Handling Standard (Client)
- Accept MoneyDto in API responses for all monetary fields.
- Use `toMoneyNumber` only for display formatting.
- Avoid client-side arithmetic on currency; compute on server when possible.
- If client arithmetic is required, use a lightweight Decimal helper or a MoneyDto sum helper.

### Validation
- Introduce a shared `validDateSchema` for recurring module (format + actual date).
- Add upper bounds for MoneyDto (DECIMAL(15,2)).
- Validate numeric query params to prevent NaN and negative values.

### API Alignment
- Ensure all client endpoints exist on server.
- Align request/response types for MoneyDto fields.
- Honor pagination/query parameters (e.g., history limit).

### Type Safety
- Remove `as any` casts and replace with typed payloads.
- Derive types from Zod schemas or shared types.
- Use strict unions for `frequency`, `intervalUnit`, and assignment types.

### UI Refactor
- Split oversized components into smaller subcomponents.
- Extract payload building and validation into helper functions.
- Add tests per subcomponent where logic is non-trivial.

### Rate Limiting
- Keep global limiter (already applied).
- Add per-route `analyticsLimiter` to compute-heavy endpoints if required.

### Testing Strategy

Goals server integration tests:
- CRUD flows for all goal types.
- Assignments: assign/update/remove.
- Transfers: create and list.
- Linking: link/unlink transactions.
- Activity: pagination, filters, and ordering.
- Authorization: household isolation.

Recurring server integration tests:
- Lifecycle: pause/resume/skip/end.
- Pattern detect/confirm.
- Link/unlink transaction.
- History query with limits.

Client hook tests:
- All query hooks (cache, errors, invalidation).
- Mutation hooks (optimistic updates, error rollback).

---

## Detailed TODO List (One Stop)

| Priority | ID | Module | Task | Key Files |
|----------|----|--------|------|-----------|
| P0 | GOAL-TEST-001 | Goals | Add full server integration test suite | `server/routes/__tests__/goals.integration.test.ts` |
| P0 | GOAL-MONEY-001 | Goals | Replace parseFloat in goalStatusWorker | `server/jobs/goalStatusWorker.ts` |
| P0 | GOAL-MONEY-002 | Goals | Remove Money -> number arithmetic in goal services | `server/services/goal/*` |
| P0 | REC-001 | Recurring | Replace parseFloat/Math.round in getSummary | `server/repositories/RecurringRepository.ts` |
| P0 | REC-003 | Recurring | Add missing integration tests | `server/routes/__tests__/recurring.integration.test.ts` |
| P0 | REC-API-001 | Recurring | Add `/recurring/process` or remove client call | `server/modules/recurring/recurring.routes.ts`, `client/src/hooks/useRecurring.ts` |
| P0 | REC-008 | Recurring | Enforce transaction visibility in link/unlink | `server/services/recurring/RecurringLinkingService.ts` |
| P1 | GOAL-CLIENT-001 | Goals | Replace parseFloat usage in goals UI | `client/src/features/goals/components/*` |
| P1 | GOAL-TYPE-001 | Goals | Remove `as any` from assignment payloads | `client/src/features/goals/components/GoalAccountsModal.tsx`, `client/src/features/goals/components/GoalCreationWizard.tsx` |
| P1 | GOAL-QUALITY-001 | Goals | Split oversized goal components | `client/src/features/goals/components/GoalCreationWizard.tsx`, `client/src/features/goals/components/GoalAccountsModal.tsx`, `client/src/features/goals/components/GoalActivityItem.tsx` |
| P1 | REC-TYPE-001 | Recurring | Remove `as any` casts | `server/modules/recurring/recurring.controller.ts`, `server/services/recurring/RecurringLinkingService.ts`, `server/services/recurring/RecurringProcessingService.ts`, `server/repositories/RecurringRepository.ts` |
| P1 | REC-CLIENT-001 | Recurring | Fix MoneyDto mismatches in types | `client/src/features/recurring/types.ts`, `client/src/hooks/useRecurring.ts` |
| P1 | REC-CLIENT-002 | Recurring | Replace parseMoney totals with MoneyDto-safe sums | `client/src/features/recurring/hooks/useRecurringPageData.ts` |
| P1 | REC-VALIDATION-001 | Recurring | Add valid date checks and bounds | `server/modules/recurring/recurring.validation.ts` |
| P1 | REC-API-002 | Recurring | Honor history limit query | `server/modules/recurring/recurring.controller.ts` |
| P1 | REC-UI-001 | Recurring | Add missing recurring settings fields | `client/src/components/transactions/form/RecurringSettingsSection.tsx` |
| P2 | GOAL-VALIDATION-001 | Goals | Add money max bound (DECIMAL(15,2)) | `server/core/validation/money.ts` |
| P2 | REC-QUALITY-001 | Recurring | Split RecurringRepository | `server/repositories/RecurringRepository.ts` |
| P2 | REC-RATE-001 | Recurring | Add analyticsLimiter to heavy routes | `server/modules/recurring/recurring.routes.ts` |

---

## Verification Checklist

- Code scan for money parsing:
  - `rg "parseFloat|Math\\.round|Number\\(" server\\services\\goal server\\repositories\\RecurringRepository.ts`
- Code scan for type casts:
  - `rg "as any" client\\src\\features\\goals client\\src\\features\\recurring server\\modules\\recurring`
- Server integration tests:
  - `npm test -- server/routes/__tests__/goals.integration.test.ts`
  - `npm test -- server/routes/__tests__/recurring.integration.test.ts`
- Client tests:
  - `npm test -- client/src/features/goals`
  - `npm test -- client/src/features/recurring`

---

## Appendix: Previously Reported Issues Now Resolved or Not Reproducible

Goals:
- parseFloat in GoalRepository addContribution is already removed; Money is used.
  - Reference: `server/repositories/GoalRepository.ts:129-132`
- TransactionGoalLinkService uses FOR UPDATE and checks inside transaction.
  - Reference: `server/services/TransactionGoalLinkService.ts:50-74`
- Assignment validation uses FOR UPDATE locks when transaction is supplied.
  - Reference: `server/services/goal/assignment.validation.ts:110-131`
- Goals date validation already checks actual date validity.
  - Reference: `server/modules/goals/goals.validation.ts:11-27`
- Global rate limiting is applied to all `/api` routes.
  - Reference: `server/routes.ts:90-91`
