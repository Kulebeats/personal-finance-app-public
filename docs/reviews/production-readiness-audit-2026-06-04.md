# Production-Readiness Audit — Personal Finance App

**Date:** 2026-06-04
**Method:** Independent multi-agent code audit (14 module audits + adversarial verification + 7 cross-cutting deep-dives, ~35 agents, 3.4M tokens) + full ground-truth build/test/typecheck runs.
**Audit principle:** Per the repo's own *Previous Session Audit Rule* — completion claims in `docs/` were treated as **unverified hypotheses** and checked against actual code. They did not hold up.

---

## 1. Verdict

> **NOT production-ready.** The application is **structurally strong and feature-rich**, but ships with **multiple P0 launch blockers** spanning deployment, security, financial-data integrity (Money class + DPA audit logging), external-AI PII handling, and an **ungated, partly-fictional test safety net**.

The repo's own status docs claim **"213/213 issues fixed (100%), all modules production-ready"** (`docs/issues/known-issues.md`, `docs/reviews/open-issues-summary.md`). **This claim is false when verified against code and when the test suite is run as a whole.** Two modules independently re-scored well below their documented scores, and every cross-cutting area surfaced code-confirmed blockers the docs assert are resolved.

| Dimension | Doc claim | Independently verified | 
|---|---|---|
| Overall | "100% production ready" | **Not ready** — P0 blockers in 4 of 5 cross-cut areas |
| Transactions module | 88/100 | **58/100** (verified 59) |
| Budgets module | 96/100 | **79/100** (verified 80) |
| **All 22 modules** | **avg ~88/100** | **avg ~65/100 — every single module below its claim; 0 production-ready** |
| Server test suite | "all passing" | **238 failed / 1835 passed / 18 skipped** (26 of 111 files) |
| Client test suite | "all passing" | **238 failed / 1609 passed** (116 files, misconfigured runner) |
| `trust proxy` security fix | "FIXED (Jan 2026)" | **Not present in prod code** (only in a test) |
| GRZ securities Money/audit | (never reviewed) | **Raw-float math + persisted + zero audit logging** |

---

## 2. Ground-Truth Signals (build / typecheck / tests)

Run directly on a clean checkout, independent of the agents:

| Check | Result | Detail |
|---|---|---|
| `npm run build` | ✅ **Pass** (46s) | Client + server bundle produced. **But:** `charts` chunk = **739 KB (214 KB gzip)**, main vendor chunk 339 KB (101 KB gzip) — over the app-page budget (300 KB gzip). |
| `npm run check` (tsc) | ✅ **Pass** | Clean. ⚠️ A stray type error exists in `client/src/hooks/__tests__/useAccounts.test.tsx:362` that the current `tsconfig` excludes (`.test.ts` excluded, `.test.tsx` ambiguous) — a stricter config would fail. |
| `npm run test:server:run` | ❌ **238 failed / 1835 passed / 18 skipped** (2091 tests, 26/111 files) | Mostly DB-integration tests dying on `pg-pool` (no test DB here) **+** real pure-logic failures (below) **+** 2 unhandled rejections in notifications. |
| `npm run test:run` (client) | ❌ **238 failed / 1609 passed** (116 files) | Runner is **misconfigured**: it sweeps in **server tests** (`Failed to resolve "@shared/schema"`) and **Playwright e2e specs** (`test.describe() not expected here`); plus **stale mocks** (`No "useSkipRecurring"/"useCurrentYearRange"/"parseMoneyString" export`) and **missing provider wrappers** (`TooltipProvider`, `SettingsProvider`). |

**Pure-logic test failures (no DB needed — these are real, not environmental):**
- `core/calculations/budget/budget.test.ts` — zero-total-days returns full budget (3000) instead of 0; negative-budget edge cases. Normal-path tiers (75/90/100%) all pass.
- `core/calculations/goals/goals.test.ts` — multiple edge cases (fractional months, boundaries, negative/zero targets).
- `core/calculations/shadow_mode.test.ts` — **test drift** (logger format changed); confirms a **dual calculation engine** (legacy + new) still runs in parallel from the P4 refactor. The "produces consistent results" assertions pass (engines agree).

---

## 3. P0 — Launch Blockers (code-confirmed)

These must be fixed before any production launch of a DPA-regulated financial app.

### Deployment / Infrastructure
1. **Production deploy target ships no backend.** `.replit:9-13` sets `deploymentTarget="static"`, `publicDir="dist/public"` — that serves only the React bundle and **never runs the Express server** (`dist/index.js`). No API, auth, DB, sessions, or cron in the documented deploy path. *(Either prod is deployed by an undocumented mechanism, or it's fundamentally broken. ~2d to reconcile + runbook.)*
2. **Distributed rate-limit store is dead code.** `server/middleware/rateLimit.ts:32-75` builds a Redis store that **no limiter passes** (`store` omitted on all 7 limiters). Auth brute-force / DOS limits are per-process and bypassable across instances. *(~1.5d)*
3. **Cron jobs have no distributed lock.** `server/scheduler.ts:12-80` registers 3 `node-cron` jobs on **every** instance boot — daily security email, weekly recap email, notification purge all **double-fire under >1 instance**. *(~2d)*
4. **Database connection has no SSL/TLS.** `server/db.ts:13-18` `new Pool({connectionString})` with no `ssl` option — financial+PII data can transit in cleartext. *(~0.5d)*

### Security
5. **`trust proxy` not set in production** (only in `auth.ratelimit.test.ts:27`). Behind a TLS-terminating proxy this (a) makes every audit log / login-history / geo-anomaly row record the **proxy IP, not the client** (DPA audit-trail + brute-force-detection failure), and (b) makes `req.secure===false` so the production `secure` session cookie **may not be set → users can't stay logged in**. Docs (`security-review-report.md:34`, `risk-register.md:68`) falsely claim this was FIXED. *(~0.5d)*

### Financial Integrity (Money class + DPA audit)
6. **GRZ securities module computes & persists money in raw JS floats.** `server/services/grz-service.ts` does all bond coupon / withholding-tax / discount / yield math in `number` + `.toFixed()`, **persists** the results, and **creates real ledger transactions** (`server/routes/grz-securities.ts:271-389`). This Zambian sovereign-debt path was **never covered** by the "213 fixed" reviews. *(~3d)*
7. **GRZ bond/T-bill/coupon writes have zero audit logging.** `grz-securities.ts` has no `BusinessAuditService` calls; the underlying `transaction/create.ts` doesn't self-audit (auditing lives only in the transactions *controller*, which GRZ bypasses). DPA compliance gap on regulated financial writes. *(~1.5d)*

### External-AI PII (DPA)
8. **Raw financial PII leaves to Google Gemini.** `server/modules/ai/ai.service.ts:384-477` — only 3 of 12 tools route through the sanitizer; the other **9 send raw DB rows** (internal UUIDs, raw account/merchant/goal names) which are `JSON.stringify`'d verbatim into the Gemini prompt (`ai.gemini.ts:549-552`). Meanwhile `ai.service.ts:261` hardcodes `data_sanitized: true` for **all** queries — a **false compliance attestation** in the audit log. *(~3d)*
9. **Gemini-supplied tool args injected into SQL with no validation.** Args are `as`-cast into ILIKE/gte/lte filters (`ai.service.ts:386-457`); the Zod tool-arg schemas (`ai.validation.ts:47-58`) are **never imported** (dead code). *(~2d)*

### Testing (safety net)
10. **No CI runs the test suite.** Only `ai-eval-gate.yml` (static prompt-string checks, AI-path only) and `amplify.yml` (3rd-party scan) exist. `npm run check`, `test:run`, `test:server:run`, `test:e2e` **never run on PRs** → every "FIXED" claim is unguarded against regression. *(~2d)*
11. **Core financial modules' "integration" tests are mocked.** Of 31 `*.integration.test.ts`, only 12 touch real Postgres. **Goals and Transactions have ZERO real-DB HTTP tests**; Investments' overdraft-SELL race (claimed fixed) is untested. The FOR UPDATE locks, household scoping, and audit-row writes claimed "verified" are **unproven where it matters**. *(~8d to build real suites)*

### Additional P0s surfaced by the full 22-module sweep
12. **Dashboard crashes on household change.** `client/src/pages/Dashboard.tsx:131` has a conditional early `return` *before* `useDashboardWidgets`/`useState`/`useSensors` — a Rules-of-Hooks violation that makes React throw and unmount the dashboard when household state changes. *(~0.5d)*
13. **Household ownership transfer is non-atomic → split-brain ownership.** `transferOwnership` runs two sequential `updateMemberRole` calls with no `withTransaction`; a partial failure leaves the household with **two owners or no owner**. `acceptInvite` (addMember + markInvitationAccepted) is similarly non-atomic. *(~1d)*
14. **Weekly-recap emails financial summaries with no consent check and zero audit logging.** `processWeeklyRecapEmails` selects *all* users with `emailEnabled` globally and sends financial-PII digests — no DPA consent gate, no `audit_logs` entry — and the cron double-fires per instance (see §3.3). *(~1.5d + the cron lock)*

---

## 4. P1 — High Priority (fix before or immediately after launch)

**Transactions (verified 58/100 — the docs' 88 is wrong):**
- **No `FOR UPDATE` locks** anywhere in the transactions/transfer balance path (sibling modules all use them). `TransferService.ts`, `TransactionRepository.update`.
- **No overdraft / negative-balance guard** on transfers or expenses — concurrent transfers can double-spend.
- **Transfer idempotency check runs outside the DB transaction** (`TransferService.ts:43-60`) + inflow row stores no idempotency key → duplicate-transfer race.
- **Summary silently converts missing FX at rate=1** (`transaction/queries.ts:242`) → materially wrong multi-currency totals.
- **Concurrency test suite is mock theater** — asserts on mocks/local vars, never imports the real services; the broken areas are "green."
- **Bulk-owner endpoint unvalidated/uncapped** (`bulk.controller.ts:25`) → 500 + unbounded-parallel DOS; a defined `bulkSetTransactionOwnerSchema` is never wired.
- List filters privacy in JS *after* SQL pagination while count filters in SQL → page-size drift / skipped rows.
- **Client money antipattern:** `SplitTransactionModal.tsx:148` builds persisted split amounts via `parseFloat().toFixed(2)`.

**Budgets (verified 79/100 — the docs' 96 is wrong):**
- `recalculateBudgets` does delete-then-insert across tables **without `withTransaction`** (`BudgetRecalculationService.ts:286-353`) → partial-state corruption on mid-sequence failure.
- Client totals summed with JS float `reduce` instead of the available `sumMoneyDto` (`budgetGroupUtils.ts:135-222`).
- `budget_periods UNIQUE` constraint exists **only in raw SQL migrations, not `schema.ts`** → `drizzle-kit push` from schema would silently drop the race protection.
- `BudgetRepository.ts` = 548 LOC (>500 limit; doc claims 471).
- `period` hard-locked to `monthly` (yearly/custom advertised + service-validated but unreachable from API).

**Fintech (cross-module):**
- Consolidated FX/currency engine does float `amount * rate` + float accumulation (`currency/conversion.ts:74,135`).
- Missing FX rate **silently falls back to 1.0** across reports + currency engine with **no warning logged** (`BaseReportRepository.ts:70`, `queries.ts:242`).

**Infra:**
- No `unhandledRejection` / `uncaughtException` handlers (fire-and-forget async can crash silently).
- Schema deployed via `drizzle-kit push` (live diff) — versioned `migrations/` exist but nothing applies them on deploy.
- App cache is in-memory only (incoherent across instances).
- Startup env validation covers 4 of ~12 vars; `GEMINI_API_KEY`/`VAPID`/`REDIS_URL`/`CRON_SECRET` fail silently/fail-open.

**Security / AI:**
- Unauthenticated `express.static("/uploads")` serves financial-PII files (receipts, attachments), bypassing ownership-checked controllers (`app.ts:199`).
- AI per-household rate limit + cache are in-process `Map`s → cost cap not enforced cluster-wide.

**Testing:**
- Skipped tests cluster on the risky areas (budget concurrency, recurring audit-log/household-isolation, rate-limit 429s).
- No coverage thresholds enforced; client coverage config **excludes every financial feature folder** → reported coverage is meaningless vs Rule 17.
- E2E specs unreliable: credential mismatch (`investments.spec.ts:22` vs seeded creds), silent unauthenticated fallthrough, reliance on non-existent seeded rows.

**Newly surfaced by the follow-up per-module audit:**
- **Goals — calculation logic bug:** 9/58 goal calc unit tests fail; no-progress goals are misclassified `at_risk` instead of `on_track` (status/projection logic wrong) — a real correctness defect, not test drift.
- **Recurring — batch double-create:** `processRecurring` runs create-txn + create-link + advance-nextDueDate + log-history as 4 separate writes with no `withTransaction`; a partial failure orphans the auto transaction and leaves `nextDueDate` un-advanced, so the **next run double-creates** the transaction (Rule 10 violation).
- **Reports — zero audit logging:** the entire reports module, including **CSV export** of financial+PII data, writes no `audit_logs` rows (Rule 9 / DPA data-export traceability gap).
- **AI — conversation endpoints are stubs:** list returns `[]`, get returns a hardcoded 404, delete is a no-op, and `conversationId` is regenerated per request — **chat history never persists** (advertised feature is non-functional).
- **Receipts — link race:** `linkReceiptToTransaction` does read-then-write with no transaction/lock, so a manual match racing the auto-match cron can double-link/double-tag a receipt.
- **Accounts — CI-breaking type error:** `client/src/hooks/__tests__/useAccounts.test.tsx:362` sends `{adjustment, type}` but `BalanceAdjustmentInput` is `{amount, isIncrease, notes}` — the one real `tsc` error in the repo.

**Newly surfaced by the final sweep (admin / taxonomy / engagement):**
- **Settings — fake account deletion (DPA right-to-erasure):** `deleteAccount` only prepends `deleted_` to the email and leaves **all household financial data intact**; it also reads `req.session.userId` for audit/logging *after* `req.session.destroy()` (empty callback, no error handling).
- **Household — broken authorization & contract:** `updateGeneral` has **no role check** — any member, including `view_only`, can rename the household and change its base currency; no `FOR UPDATE` on role-change / last-member / accept races; `MemberList` reads `member.user.fullName/email` but the server never joins `users`, so members render with blank names/emails.
- **Rules — private-data visibility leak:** `dryRunRule` uses `transactionRepository.findById` instead of `findByIdWithVisibility`, so a member can dry-run a rule against another member's **private** transaction and read its name/amount/category in the proposed updates (Rule 11). `applyRules` also writes txn + tags + splits + goal-links with no `withTransaction`.
- **Merchants — merge corrupts counts:** merge doesn't update `transactionCount` on source/target, and the merchant list is sorted by that field → merged merchants rank incorrectly.
- **Tags — usage-count drift:** `incrementUsageCount` is called unconditionally after an idempotent `onConflictDoNothing` insert, so re-adding an existing tag inflates the count that merge/analytics depend on; `setTransactionTags` is a non-atomic delete-then-insert.
- **Health — dead 503 drain signal:** the graceful-shutdown `/health/ready` override is registered *after* the module router, so it never executes — the load balancer never sees the 503 during shutdown.
- **Filter-presets — no tests at all**; non-atomic default-toggle can yield multiple or zero `isDefault=true` presets.
- **Client test rot:** 19/86 settings, 21/59 cashflow, and 22/60 merchants client tests fail (stale mocks / missing provider wrappers / contract drift), and the RulesSection suite loads **0 tests** (`@shared/ruleConditions` resolution failure) — confirming the test-runner misconfiguration from §2.

---

## 5. Per-Module Status

**Legend:** all 22 modules independently deep-audited & scored against code. Sorted worst → best. Effort = engineer-days to that module's own production bar.

| Module | Doc | Verified | Status | Effort | Key concerns |
|---|---|---|---|---|---|
| AI Assistant | — | **34** | 🔴 not-ready | 22d | PII→Gemini + false `data_sanitized:true` (P0), unvalidated tool args→SQL (P0), **conversation endpoints are stubs — no history persists**, ~0 real tests |
| Investments (+GRZ) | 90 | **48** | 🔴 not-ready | 8d | GRZ raw-float money + **zero audit logging** (3× P0), SELL/overdraft race untested, GRZ disconnected from holdings/tax-lot |
| Transactions | 88 | **58** | 🟠 needs-work | 11d | No FOR UPDATE/overdraft, idempotency race, FX=1 fallback, mock-theater concurrency tests |
| Receipts | 80 | **58** | 🟠 needs-work | 6d | `/uploads` PII exposure, link race (no txn/lock), service fully mocked in tests |
| Household | 89 | **61** | 🟠 needs-work | 4.5d | **Ownership transfer non-atomic → two/zero owners (P0)**; `updateGeneral` has no role check (any member renames household/currency); blank member names (no user join) |
| Dashboard | 82 | **61** | 🟠 needs-work | 3d | **Rules-of-Hooks violation → React crash on household change (P0)** (`Dashboard.tsx:131`); inherits FX/Money issues; widget tests failing |
| Settings | — | **62** | 🟠 needs-work | 8d | **`deleteAccount` is a fake soft-delete → DPA right-to-erasure violation**; audits on destroyed session; 19/86 client tests failing |
| Cashflow | 88 | **62** | 🟠 needs-work | 5d | **FX rate=1 silently corrupts sankey/bar money (P0)**; 21/59 client tests failing |
| Filter-presets | — | **66** | 🟠 needs-work | 3.5d | Zero tests for the module; non-atomic default toggle → multiple/zero defaults |
| Notifications | 88 | **66** | 🟠 needs-work | 3d | 2 unhandled rejections on the 404 path (CI red); push silently off without VAPID |
| Weekly-recap | 87 | **66** | 🟠 needs-work | 7d | Cron duplicate emails (P0 infra); **no consent + zero audit on financial-PII email egress (DPA)**; ignores user settings |
| Health | — | **68** | 🟠 needs-work | 1.5d | Graceful-shutdown 503 override is dead code (registered after router) → LB never sees drain |
| Merchants | 82 | **68** | 🟠 needs-work | 3d | Merge leaves stale `transactionCount` (wrong ranking); 22/60 client tests failing; weak rate limiting |
| Rules | 86 | **68** | 🟠 needs-work | 3.5d | `applyRules` multi-table writes non-atomic; **dryRun reads other members' private txns (visibility leak)**; rate-limit tests skipped |
| Reports | 85 | **70** | 🟠 needs-work | 6d | FX silent rate=1, **zero audit logging on CSV export** (DPA), mocked integration tests |
| Goals | 85 | **71** | 🟠 needs-work | 6d | **Calc logic bug** (no-progress goals classified `at_risk`), zero real-DB tests |
| Categories | 84 | **72** | 🟠 needs-work | 3d | reorderGroups non-atomic; budget-config fields unreachable via API; repo not household-scoped |
| Auth | 91 | **74** | 🟠 needs-work | 3d | `trust proxy` P0; intermittent login 500; unwired strategies; strong fundamentals |
| Recurring | 88 | **74** | 🟠 needs-work | 4d | Batch not atomic → **double-create on partial failure**; float summaries; isolation tests skipped |
| Tags | 86 | **74** | 🟠 needs-work | 4d | Usage-count drift; `setTransactionTags` non-atomic; no tests for merge/archive/analytics |
| Budgets | 96 | **79** | 🟠 needs-work | 5d | Non-atomic recalc, client float totals, schema drift, LOC |
| Accounts | 88 | **79** | 🟠 needs-work | 8d | **tsc error breaks CI** (`useAccounts.test.tsx:362`), service fully mocked in tests, LOC/a11y |

> ✅ **All 22 modules are now independently scored — every single one scored below its documented claim** (avg **~65 vs the ~88 claimed**; range 34–79; **2 not-ready, 20 needs-work, 0 production-ready**). The per-module effort column sums to **~128 engineer-days** bottom-up (this overlaps partly with the shared cross-cutting items in §3–4, which the §7 phase table counts once).

---

## 6. Cross-Cutting Readiness

| Area | Readiness | Headline |
|---|---|---|
| **Security** | 🟡 Partial | Strong core (PG session store, CSRF, Helmet, comprehensive rate limiting, no SQLi, no hardcoded secrets) — but `trust proxy` P0 + `/uploads` P1 + doc-claims-not-true. |
| **Fintech / Money** | 🔴 Not ready | Legacy 7 modules good; **GRZ securities path is unaudited, float-based, and unlogged**; FX engine float + silent rate=1. |
| **Infra / Deploy** | 🔴 Not ready | Solid ops core (persistent sessions, health probe, structured logging, graceful shutdown) — but **static deploy target**, single-instance-only (Redis/cron/cache), no DB SSL. |
| **Testing / QA** | 🔴 Not ready | Healthy counts, thin reality — no CI gate, mocked "integration" tests, no thresholds, financial UI excluded from coverage. |
| **AI external-API** | 🔴 Not ready | Better-built than the 15/100 prior audit, but **PII leaves to Gemini** + unvalidated tool args + no real tests. |
| **UX — Accessibility** | 🟡 Partial (68) | Strong Radix + shadcn-Form floor (auto-aria, focus trap) — but **no skip link (WCAG 2.4.1 A fail)**, investments rows mouse-only, reduced-motion barely handled. |
| **UX — Visual / theming** | 🟠 Partial (58) | Full HSL token system + 3 themes — undercut by **primary CTA hardcoded `bg-orange-500` (off-system)**, Button/Badge referencing **undefined CSS classes → broken borders/hover**, non-theme-aware chart hex. |
| **UX — Interaction / resilience** | 🟡 Partial (68) | Good reference patterns (optimistic tags, clean TransactionList, AlertDialog confirms) — but **errors render as empty states** (a 500 shows "add your first holding"), single app-wide error boundary, two toast systems. |
| **UX — Performance / bundle** | 🟠 Partial (58) | Exemplary code-splitting + query tuning + virtualization — but **both recharts AND nivo shipped** (739 KB / 214 KB-gzip chunk) blows the <300 KB budget; framer-motion shipped despite "removed" note; eager OCR download; 4 render-blocking fonts. |

### 6.1 UI/UX & Accessibility — dedicated pass (avg ~63/100; every dimension "partial", none production-ready)

A 4-agent code-level pass (this is the dimension dropped in the first run). Overall: **a competent, strong-foundationed UI that is inconsistent and not launch-polished.** No P0s, but every dimension is "partial" and several P1s are directly user-visible.

**Most user-visible / quality-blocking (P1):**
- **Primary CTA is off-brand:** the default `Button` hardcodes `bg-orange-500` while the whole token system is blue `--primary` — the main action color is wrong app-wide (`client/src/components/ui/button.tsx:15`).
- **Broken component variants:** `Button`/`Badge` reference classes/vars absent from `index.css` (`hover-elevate`, `active-elevate-2`, `var(--button-outline)`, `border-secondary-border`) — outline/secondary/destructive/ghost variants ship with **broken borders and no hover/active state** (`button.tsx:8,22`).
- **Errors disguised as empty states:** pages like Investments gate only on `isLoading`; on a 500 the query returns `[]` and the UI shows the **"No Holdings Yet" CTA** — telling a user they have no data when the fetch actually failed (`pages/Investments.tsx:26,39`). A trust-eroding pattern in a finance app.
- **No skip-to-content link** anywhere → WCAG 2.4.1 (Level A) failure; keyboard/SR users tab the full sidebar on every route (`Layout.tsx:116`).
- **Charts blow the bundle budget:** both **recharts AND nivo** shipped (739 KB / 214 KB gzip); with radix+motion, Dashboard first-load exceeds the CLAUDE.md <300 KB gzip app-page budget.
- **Two toast systems** (legacy Toaster + sonner) mounted and used inconsistently; **single** app-wide error boundary (any lazy-page crash blanks the whole app, full reload to recover).

**Genuinely strong (don't rebuild these):**
- Radix primitives + shadcn `Form` give a strong free a11y floor (focus trap/restore, auto `aria-describedby`/`aria-invalid`/`htmlFor`); `SortableTableHeader` + `ChartA11yToggle` (data-table fallback for charts) show real intent.
- Exemplary code-splitting (all 14 routes lazy), TanStack Query tuned (`staleTime: Infinity`), transactions virtualized, OCR confined to the lazy receipts chunk; complete HSL design-token system + 3 themes via next-themes.
- Textbook optimistic-update-with-rollback in `useTags`; clean loading/skeleton/empty/error in `TransactionList`; `AlertDialog` confirmations on destructive actions.

**Other gaps:** ~164 hardcoded color utilities + ~189 hex literals across 40 files (dark-mode drift), non-theme-aware chart palettes, framer-motion (119 KB) shipped despite the package.json "removed" note, Tesseract eagerly downloading multi-MB lang data on mount (before any scan), 4 render-blocking font families, optimistic updates in only 3 of ~10 mutation hooks, uneven responsive coverage (fixed `max-w-2xl` modals risk overflow at 320–375 px).

**Effort:** ~30–40 engineer-days for UI/UX hardening (a11y 7.5 + visual/theming 14 + interaction 10.5 + perf 10, with overlap). The two highest-ROI fixes are tiny: the Button token/variant bugs (~1.5d, app-wide visual correctness) and error-vs-empty disambiguation (~1.5d, stops masking backend outages).

> *Caveat: this is a **code-level** pass — it can't judge rendered visual polish or run Lighthouse. A true visual/CWV pass needs the app running (dev server + DB + auth) driven via browser tooling.*

---

## 7. Effort Estimate to Production

Estimates are engineer-days of focused work for an engineer familiar with the codebase. Many items share infrastructure (e.g. **one Redis integration** fixes rate-limit + cache + AI cap; **one CI pipeline** unlocks all test gating).

| Phase | Scope | Est. |
|---|---|---|
| **P0 — Launch blockers** | Deploy target + runbook, DB SSL, `trust proxy`, `/uploads` auth, GRZ Money rewrite + audit logging, AI PII sanitization + tool-arg validation, Redis-backed rate-limit + cron lock, CI gate, real-DB integration tests for Goals/Transactions/Investments | **~25–35 days** |
| **P1 — Concurrency & correctness** | Transactions FOR UPDATE + overdraft + idempotency-in-txn, FX engine → Decimal + fail-on-missing-rate, budgets non-atomic recalc, env validation, unhandled-rejection handlers, versioned migrations on deploy, client money antipatterns | **~15–20 days** |
| **P2 — Test/coverage hardening + un-audited modules** | Un-skip security/audit tests, enforce coverage thresholds (incl. financial folders), deterministic CI-runnable E2E, deep-audit the 8 remaining modules + fix their findings, fix client test-runner config + stale mocks | **~15–25 days** |
| **P3 — Polish** | Dark-mode CSS variables, aria-labels/keyboard nav, LOC splits, remove `as any`/`: any`, bundle code-splitting (charts/tesseract), retire the dual calc engine | **~10–15 days** |

**Total: ~110–150 engineer-days (≈ 5.5–7 months solo; ≈ 11–15 weeks for a 2–3 person team).**
*Revised upward after auditing all 22 modules: the per-module efforts sum to ~128 engineer-days bottom-up. The original 65–95 estimate was based on the cross-cuts + 2 modules and undercounted module-specific work (the long tail of non-atomic writes, missing role checks, visibility leaks, and broken tests across the other 20 modules). The phase table above counts shared cross-cutting work (CI, Redis, deploy) once rather than per-module. UI/UX hardening (§6.1) adds ~25–35 incremental engineer-days, net of the bundle/perf items already counted.*

P0s are a smaller gating subset (**~35–45 days**) and should land first; P2/P3 hardening can partly run post-launch behind a limited rollout.

---

## 8. Recommended Sequence

1. **Reconcile the deploy target first** (§3.1) — nothing else matters if the backend doesn't deploy. Produce a real deploy runbook.
2. **Stand up CI** (§3.10) running `check` + both test suites against an ephemeral Postgres — this makes every subsequent fix verifiable and stops regression.
3. **Close the DPA-critical data paths:** AI PII sanitization (§3.8/3.9) and GRZ Money + audit logging (§3.6/3.7). These are regulatory, not just quality.
4. **Harden money concurrency:** transactions FOR UPDATE + overdraft + idempotency (§4), then the FX engine.
5. **Build real-DB integration tests** for Goals/Transactions/Investments (§3.11) — and **delete the mock-theater concurrency tests** that give false confidence.
6. **Multi-instance infra:** Redis-backed rate-limit/cache + cron lock + DB SSL.
7. **Correct the docs** — `known-issues.md` / `open-issues-summary.md` / `risk-register.md` assert resolved items that are not. Stop counting `parseFloat → Number()` as a remediation.

---

*Generated by an independent multi-agent audit (4 passes, ~59 agents, ~6M tokens). All 22 modules independently scored against code — every one below its documented claim. Cross-cuts (all captured): security, fintech, infra, testing, AI-compliance, and UI/UX (accessibility, visual/theming, interaction, performance). Build/typecheck/test runs executed directly on the working tree. UI/UX is a code-level pass — a rendered visual / Core Web Vitals pass requires the running app.*
