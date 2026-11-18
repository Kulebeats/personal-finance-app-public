# Production-Readiness Remediation — June 2026

## Summary

June 2026 was a focused production-readiness remediation following the 2026-06-04
independent multi-agent audit (which found the app **not** production-ready: ~65/100
average, 0/22 modules ready, with P0 blockers across deployment, security, financial
integrity, external-AI PII, and an ungated/partly-fictional test safety net).

Across the month **~40 pull requests (#3–#43, plus open #45)** landed on `main`,
organized as an SCP-xxx remediation backlog. Themes: stand up CI + a versioned
deploy path, close DPA audit-logging and consent gaps, route all external-AI data
through a real PII sanitizer, move money math onto the `Money` class with fail-closed
FX, make every multi-table write atomic and race-safe, and replace mock-theater
"integration" tests with real-Postgres coverage.

> Status note: CI's `verify` (real-Postgres) job is being driven toward green;
> see "Testing & CI" below and issue #36 for the remaining tail.

---

## Deployment & Infrastructure

- **CI keystone + remediation scaffold (#3):** stood up the `verify` GitHub Actions
  job (real ephemeral Postgres on every PR/push), PreToolUse guards (no float money,
  no `as any`), the Definition-of-Done Stop gate, and the adversarial verifier.
- **Deploy reconcile + production runbook (#6, SCP-306):** chose Render + Render
  Postgres, single instance, **versioned migrations**; reconciled `shared/schema.ts`
  with legacy ad-hoc constraints/indexes and named long FKs under 63 chars.
- **Process-level error handlers (#8, SCP-325):** `uncaughtException` /
  `unhandledRejection` handlers so the API fails loudly, not silently.
- **Redis infrastructure (#10, SCP-307):** centralized Redis for rate limiting,
  distributed scheduler lock, and the AI cost cap/cache (was per-process, bypassable
  across instances).
- **Env fail-closed validation (#11, SCP-324):** required/optional feature vars are
  validated at startup instead of failing open at runtime.
- **`/uploads` authentication (#9, SCP-327):** the previously-public uploads path now
  requires auth and an ownership check.

## Security, DPA & Compliance

- **DPA audit logging — GRZ + reports CSV (#7, SCP-312):** `BusinessAuditService` is
  now transaction-aware (writes the audit row inside the same tx so a regulated write
  never commits unlogged); added `data_export` + GRZ entity types and audited GRZ
  bond/T-bill/coupon writes and reports CSV egress.
- **Reports CSV export *creation* audit (#43, DPA Rule 9):** `createExport` now writes
  a `CREATE data_export` audit row atomically with the completion write (the egress
  path was already audited in #7; this closed the create-path gap from the audit).
- **Weekly-recap consent gate (#17, SCP-319):** per-user DPA consent check + audit row
  before any financial-PII email egress.

## AI Assistant Hardening

- **PII sanitizer on all tools (#24, SCP-313):** all Gemini tools now route through the
  PII sanitizer (was 3 of 12), and `data_sanitized` is set from the real sanitiser
  result instead of a hardcoded `true`.
- **Zod tool-arg validation (#30, SCP-314):** Gemini tool arguments are validated with
  the (previously dead) Zod schemas before being used in SQL filters.
- **Conversation persistence (#37, SCP-338):** real schema + migration + repository +
  service + controller for AI conversations, with real-DB tests, cross-tenant
  isolation, and scoped delete (the endpoints were previously stubs).

## Money Correctness & FX

- **GRZ money via `Money` (#21, SCP-311):** bond coupon, withholding-tax, discount, and
  yield math now compute and persist through the `Money` class (was raw `number` +
  `.toFixed()`).
- **FX fail-closed (#12, SCP-321 + #23 follow-up):** a missing exchange rate is now a
  logged, surfaced error instead of a silent `rate = 1`, across snapshot, reporting,
  and valuation services.
- **Client money floats (#26, SCP-326):** split modal, budget totals, and merchant
  filters use `Money`/`sumMoneyDto` instead of float arithmetic.

## Concurrency, Atomicity & Race-Safety

- **Transfers (#14, SCP-320):** lock both accounts `FOR UPDATE`, add an overdraft
  guard, and run the idempotency check inside the transaction.
- **Budgets (#13, SCP-322):** `recalculateBudgets` is atomic via `withTransaction`.
- **Recurring (#16, SCP-330):** per-rule `processRecurring` batch is atomic.
- **Household lifecycle (#19 SCP-318, #33):** atomic ownership transfer + accept-invite;
  account erasure serializes against invite-accept on `SELECT households FOR UPDATE`
  and scopes the membership delete.
- **Rules (#15, #34, SCP-334):** `applyRules` runs in one transaction, transaction
  creation stays resilient to atomic rule-apply failures, and the `dryRunRule`
  visibility leak (member could read another member's private transaction) is closed.
- **Bulk owner (#29, SCP-331):** the bulk-owner endpoint validates input and caps batch
  size (was unbounded-parallel, DOS risk).
- **Goals & receipts (#18, SCP-337):** corrected goal-status logic + atomic, race-safe
  receipt→transaction linking.

## Household & Settings

- **Multi-member erasure (#22/#28, SCP-332):** real account erasure with
  audit-before-destroy; co-members' shared data is retained and a successor is
  auto-promoted instead of wiping the household.
- **Household roles (#20, SCP-333):** role checks on `updateGeneral`, member↔users join,
  and race-safe role change / member removal.

## Taxonomy (Merchants, Tags, Categories)

- **Integrity + atomicity (#31, SCP-335):** correct merchant-merge and tag counts,
  atomic `setTags`, and atomic + household-scoped category operations.

## Frontend

- **Charts migration (#5):** migrated bar/composed/treemap/pie/line and the CashFlow
  bar chart from nivo to **recharts** (Sankey retained).
- **Polish & a11y (#32, SCP-340):** dark-mode tokens, form labels + keyboard
  navigation, and code-splitting for charts and the Tesseract OCR bundle.

## Testing & CI Quality

- **Real-DB integration tests (#27, SCP-316):** genuine real-Postgres HTTP tests for
  Goals / Transactions / Investments, replacing mock-theater suites.
- **Type-checked tests (#38, SCP-341):** tightened `tsconfig` so test files are
  type-checked.
- **Test reality (#39/#40/#41, SCP-339):** completed the logger mock so the
  `ruleService` suite runs, log the actual error on unhandled 500s (observability),
  and repaired mock-contract integration suites.
- **Calc cleanup (#35, SCP-342):** budget edge-case correctness and retirement of the
  vestigial shadow-mode calculation engine.
- **CI hardening:** `SESSION_SECRET` ≥ 32 chars so app-importing tests load; raised the
  race-test timeout.
- **Mock-theater CI remediation (#45, open):** greened the reports + transactions
  "mock-theater" suites against real Postgres (~106 tests) and fixed three product
  bugs the tests caught — regex-only date validation accepting impossible dates
  (Rule 8), `z.coerce.boolean("false")` returning `true`, and malformed JSON returning
  500 instead of 400. (Remaining #36 files tracked separately.)

---

## Notable Files Touched (by area)

- **Audit / DPA:** `server/services/BusinessAuditService.ts`,
  `server/modules/reports/reports.export.service.ts`,
  `server/modules/reports/reports.exports.controller.ts`,
  `server/services/grz-service.ts`, weekly-recap services.
- **Money / FX:** `server/core/money.ts`, `server/core/calculations/currency/fxRates.ts`,
  `server/repositories/reports/BaseReportRepository.ts`, GRZ services, client split/budget/merchant components.
- **Concurrency:** `server/utils/withTransaction.ts`, transfer/budget/recurring/household/rules services and repositories.
- **AI:** `server/modules/ai/*` (sanitizer, validation, conversation persistence).
- **Validation:** `server/modules/reports/reports.validation.ts`, `server/core/errors/errorHandler.ts`.
- **Infra/CI:** `.github/workflows/ci.yml`, Redis integration, env validation, `shared/schema.ts`.
- **Tests:** real-DB integration suites under `server/**/__tests__/`.

## References

- Authoritative status: Linear (not `docs/`).
- Independent audit baseline: `production-readiness-audit-2026-06-04`.
- Open follow-ups: issue #36 (CI `verify` tail), PR #45 (mock-theater remediation),
  loose date-coercion in transactions validation.
