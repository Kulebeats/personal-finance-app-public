# Production-Readiness Reconciliation — Personal Finance App

**Date:** 2026-07-03
**Baseline:** `docs/reviews/production-readiness-audit-2026-06-04.md` (14 P0 blockers, long P1 tail, 0/22 modules ready, ~110–150 engineer-days estimated).
**Method:** Independent code-level verification sweep of every P0 and P1 audit finding against current `main` (24ef7ce), performed in-session with direct file reads and pattern sweeps. Per the repo's Previous Session Audit Rule, no claim below rests on docs, commit titles, or session memory alone — every CLOSED verdict cites the closing code.
**Tooling caveat:** shell execution and subagent dispatch were unavailable for part of this session (permission-classifier outage), so `npm run check`, the test suites, and the live GitHub CI status were **not executed here**. Those signals are marked 🔍 and CI remains the authority for them.

> **SESSION 2 UPDATE (2026-07-03, later the same day).** A follow-up session with working shell + agents closed the runtime 🔍 gaps and drove the pending work forward. Headlines, each verified live:
> 1. **CI on `main@24ef7ce` is GREEN** (run 28531719758) — every ✅ in §3/§4 is now CI-backed. The "3 locally-failing server test files" in §2 were a stale artifact; the same suites pass in CI.
> 2. **`npm run check` clean locally** on main and on both work branches.
> 3. **PR #58 opened for `codex/production-readiness-p1`** (now 8 commits, not 6 — filter-preset default atomicity and UX polish/error-boundary commits landed after §5 was written). First-ever CI run on the branch: **green**. Three adversarial review agents (concurrency, security, code-review) then audited the diff; the T-5 privacy-pagination fix and filter-preset atomicity are CONFIRMED sound, but the review found merge-blockers — **fixed on the branch this session** (see §4b): the new overdraft guard rejected deposits into negative-balance accounts (regression), `BudgetCrudRepository.delete` could destroy another household's `budget_periods` (CRITICAL, pre-existing but relocated), coverage thresholds were not wired into CI at all, and the new `RouteErrorBoundary` was untested.
> 4. **PR #59 opened and fully green** (verify + e2e + scans): NetWorth FX fail-closed fix. Root cause was deeper than §4's residual note — the silent `rate=1` lives in `buildFxRateExpr`'s SQL `COALESCE`, which also underlies **six more report surfaces** (§4b).
> 5. **CSRF long-tail is now CONFIRMED, not a suspicion** (§4b): ~17 mutation endpoints across 5 client hook files send no `x-csrf-token` and fail 403 in any real browser session.
> 6. **New HIGH found by the security reviewer:** the rules-engine bulk paths (`applyRulesToTransactions`, `testRule`) read **and mutate** other members' private transactions — full Rule-11 bypass, pre-existing on main (§4b).
> Merging #58 and #59 is left to the maintainer (agent-authored PRs are not self-merged).
>
> **FINAL CLOSE-OUT UPDATE (2026-07-04).** This document was reconciled again against current `main@4e173da`. The earlier unmerged-PR notes are superseded: PRs #58, #59, #60, #62, #64, and #65 are merged; there are no open PRs; `main` equals `origin/main`; GitHub CI and Amplify Security are green on `4e173da`; and local `npm run check` passes. No P0/P1 merge blocker from this reconciliation remains open. The remaining work is lower-priority hardening: client-side amount parsing cleanup, the monthly-only budget-period product/data contract, rollover persistence atomicity, and a filter-preset duplicate-name DB constraint.
>
> **LATE HARDENING UPDATE (2026-07-04).** The close-out moved further after the final update above: PR #70 closed client amount parsing, PR #72 closed the monthly-only budget-period DB contract, PR #73 removed unused Nivo chart packages, and rollover/filter-preset atomicity were re-verified with targeted real-DB suites. Coverage ratcheting is now tracked in `docs/operations/coverage-ratchet-plan.md`. The remaining readiness item is external Render provisioning and staging smoke testing per `docs/runbooks/deploy.md`.

---

## 1. Verdict

> **The 2026-06-04 audit close-out is complete for the tracked P0/P1 launch-blocking set on current `main@4e173da`.** The earlier pending-branch state was resolved by merging the follow-up PRs listed in the final close-out update above. The remaining known items are hardening/product-debt follow-ups, not branch-cleanup or merge blockers.

This is a dramatic delta from June: the audit estimated 110–150 engineer-days; roughly a month of SCP-3xx remediation waves landed the P0 set and most of the P1 set.

**Superseding verification:** current GitHub CI + Amplify Security are green on `main@4e173da`, local `npm run check` passes, and `server/test-results.txt` is a stale January 2026 artifact rather than current test evidence.

---

## 2. Ground-Truth Signals

| Check | Result | Detail |
|---|---|---|
| `npm run check` | ✅ verified in final close-out | Passed locally on `main@4e173da`. CI also runs it on every PR/push (`.github/workflows/ci.yml:59`). Root `tsconfig.json` no longer excludes any test files — all `.test.ts`/`.test.tsx` are type-checked. |
| CI pipeline exists | ✅ verified in code | `ci.yml`: typecheck → versioned migrations → server tests vs **real Postgres 16 service** → client tests → build, plus a dependent Playwright e2e smoke job. Triggers: every PR + push to main. |
| Latest local server-test artifact | ⚠️ stale artifact | `server/test-results.txt` was last modified 2026-01-29, so its 3 failures are not current evidence. Current CI is the authority and is green on `main@4e173da`. |
| Branch state | ✅ verified in final close-out | `main` = `origin/main` = `4e173da`; no open PRs; no extra local branches; no registered worktrees. `playwright-report/index.html` was removed from Git tracking and `playwright-report/` is ignored. |
| Deploy path | ✅ verified in code | `render.yaml` blueprint (web + Postgres + Key Value/Redis, `preDeployCommand: npm run db:migrate`, health check `/healthz`); `.replit` deployment now `cloudrun` with `build`+`start`. Six versioned migrations exist under `migrations/`. |

---

## 3. P0 Close-Out (all 14 items)

| # | Audit finding (June 4) | Verdict | Evidence |
|---|---|---|---|
| 1 | Deploy target ships no backend (`.replit` static) | ✅ CLOSED | `.replit:9-13` now `cloudrun` + `npm run start`; `render.yaml` full blueprint with pre-deploy migrations |
| 2 | Redis rate-limit store built but unused | ✅ CLOSED | `server/middleware/rateLimit.ts:75-83` — `createLimiter` factory threads a per-prefix RedisStore into **every** limiter (SCP-307) |
| 3 | Cron jobs double-fire (no distributed lock) | ✅ CLOSED | `server/scheduler.ts:99-114` — all 3 jobs run through `withRedisLock` (SCP-308) |
| 4 | No DB SSL | ✅ CLOSED | `server/db.ts:15-34` — SSL on by default in production, `DATABASE_SSL` override |
| 5 | `trust proxy` absent in prod | ✅ CLOSED | `server/app.ts:37-51` — defaults to `1` in production, `TRUST_PROXY` override; `render.yaml:28` sets it explicitly |
| 6 | GRZ money math in raw floats | ✅ CLOSED | `server/services/grz-service.ts:56-346` — coupon/WHT/discount/yield all via `Money` + `Decimal`; zero `parseFloat`/float `.toFixed` remain in the file |
| 7 | GRZ writes unaudited | ✅ CLOSED | `businessAuditService` calls in `server/routes/grz-securities.ts` and `grz-auctions.ts` |
| 8 | AI: 9/12 tools send raw PII; `data_sanitized` hardcoded true | ✅ CLOSED | Central `ai.sanitizer.ts` covers every tool type; `SanitizedToolOutput.sanitized` drives the audit value (`ai.types.ts:159-163`, SCP-313); `ai.service.sanitization.test.ts` asserts **every** tool sanitises and the flag is honest (incl. a false-case test) |
| 9 | Gemini tool args cast straight into SQL | ✅ CLOSED | `ai.tool-arg-validation.test.ts` exercises Zod rejection of malformed tool args before SQL |
| 10 | No CI runs the suites | ✅ CLOSED | `.github/workflows/ci.yml` (§2) |
| 11 | Mocked "integration" tests; no real-DB Goals/Transactions | ⚠️ PARTIAL | Real-DB suites now exist and exercise the risky paths: `transactions.realdb.integration.test.ts` (SCP-320 concurrent double-spend races), `TransferService.concurrency.test.ts` (real Postgres, header explicitly retires mock-theater), household ownership/lifecycle race tests, settings erasure race tests, `processRecurring.atomicity` real-DB, taxonomy SCP-335. Goals has integration files in two locations; module-level mock usage persists in some suites; Investments SELL-race coverage not verified. |
| 12 | Dashboard Rules-of-Hooks crash | ✅ CLOSED | `client/src/pages/Dashboard.tsx:165-167` — early return moved below all hooks, with a comment pinning the invariant |
| 13 | Ownership transfer / acceptInvite non-atomic | ✅ CLOSED | `server/repositories/HouseholdRepository.ts:237-259` (both member rows FOR UPDATE, one txn), `:538-591` (invite + household locked); SCP-333 race tests |
| 14 | Weekly recap: no consent, no audit, cron double-fire | ✅ CLOSED | `weekly-recap.email.service.ts:246-294` — SCP-319 consent gate on `households.aiConsentGiven` + egress audit row; cron lock per item 3 |

**P0 verdict: 13 CLOSED, 1 PARTIAL (real-DB coverage breadth).** Nothing in the P0 set remains an unaddressed launch blocker in code.

---

## 4. P1 Close-Out

### Closed on main (verified)

| Area | Finding | Evidence |
|---|---|---|
| Transfers | No FOR UPDATE / overdraft / idempotency-in-txn | `TransactionTransferRepository.ts:65-75` locks both accounts (consistent order); `:133` insufficient-funds guard; `TransferService.ts:43` idempotency under the locks; real-DB race test proves exactly-one-wins |
| Bulk endpoint | Unvalidated/uncapped | `transactions.bulk.controller.ts:16,35` — schema wired via `safeParse` |
| FX engine | Silent `rate=1`, float math | SCP-321 fail-closed in `BaseReportRepository.ts:71-83`, `transaction/queries.ts:243-251`, `currency/conversion.ts:72-90,146-164` — missing rate logs + throws; Decimal Money math |
| Budgets | Non-atomic recalc; schema-only-in-SQL constraints | `BudgetRecalculationService.ts:292` withTransaction; `shared/schema.ts:1629` budget-period unique, `:587` household-members unique, `:1383` transaction-tag unique, `:1304` transfer-pair unique |
| Client money | Split modal / budget group floats | Split modal has a dedicated Money test (`SplitTransactionModal.money.test.tsx`); `budgetGroupUtils.ts` contains no float reduce/parseFloat |
| Infra | Env validation, crash handlers, in-memory-only cache, `/uploads`, drain signal | `validateEnvOrThrow` at `app.ts:28` (SEC-STARTUP-001); `registerProcessErrorHandlers` wired via `startup.ts:18`; AI cache Redis-backed L2 (`ai.cache.ts`, SCP-328); `/uploads` behind `requireAuth + householdGuard + serveUpload` (`app.ts:227`, SEC-327); `/healthz` returns 503 when shutting down (`app.ts:254-260`) and is Render's health check |
| AI | Consent, per-household cap, conversations | Consent endpoints + gate (`ai.controller.ts:206-256`); Redis-backed daily household counter (`ai.middleware.ts:17-73`); real `ai_conversations`/`ai_messages` tables + scoped repository (`schema.ts:3195+`, `ai.conversation.repository.ts`) |
| Module long-tail | Settings erasure, rules dry-run leak, rules apply atomicity, receipts link race, merchants merge counts, tags drift, categories reorder, goals calc, household role check, member names, notifications 404 rejections | `settings.account-deletion.service.ts:397-496` (SCP-332 + race tests); `rule/service.ts:250-252` visibility + test; `rule/actions.ts:243` (SCP-334); `receipt/transaction.service.ts:110-122` + race test; `MerchantService.ts:232-263` count-correct merge; TagRepository atomic `onConflictDoNothing` + unique index (SCP-335); `categories.operations.controller.ts:143-145` atomic scoped reorder + audit; goals SCP-337 + zero-progress tests; `household.controller.ts:124-130` owner/admin gate; `HouseholdRepository.ts:176` users join; notifications suites passing in latest artifact |
| UI | Orange CTA, broken variants, skip link, two toasters, error-as-empty (Investments) | `button.tsx:12-21` token-based variants (no orange, no phantom classes); `Layout.tsx:110-124` skip link; single `SonnerToaster` (`App.tsx:88`); `Investments.tsx:40-43` surfaces holdings error + refetch |
| Test infra | Client runner sweeping server/e2e; type-unchecked tests | `client/vitest.config.ts:21` scopes include to client specs + `@shared` alias (SCP-334); root `tsconfig.json` has no test exclusions |

### Superseded: items that were open before the final merge wave

The table below records the pre-merge state from the reconciliation session. As of the 2026-07-04 final close-out, these items have landed on `main` through PRs #58, #60, #62, #64, and #65, except for the intentionally deferred monthly-only budget-period product/data contract.

| Item | State on main | Branch commit that claims it |
|---|---|---|
| T-5: list privacy filtered in JS after SQL pagination | OPEN | `fix: paginate visible transactions in sql` |
| Balance mutations outside transfer path unlocked | PARTIAL (transfer path locked; `TransactionRepository.update` path not) | `fix: lock transaction balance mutations` |
| B-4: budget period locked to monthly (`budgets.validation.ts:12` TODO) | OPEN | `fix: close budget period mode contract` |
| TC-3: coverage thresholds not enforced; financial folders outside client coverage include | OPEN (`client/vitest.config.ts:26-51` — thresholds "documented but not enforced") | `fix: enforce production coverage thresholds` |
| TC-5: 13 skipped tests across 7 risky-area files | PARTIAL | `fix: close skipped risky tests` |

Per the audit rule, those commit titles are **hypotheses until CI passes on the branch and the diff is reviewed** — but they map 1:1 onto the residual list, which is strong convergence.

### Still OPEN on main — no known fix in flight

*(Session-2 strikethroughs: items closed by PR #58's later commits, PR #59, or on-branch fixes.)*

| Item | Severity | Detail |
|---|---|---|
| ~~Residual silent FX fallback (NetWorth)~~ | ~~P1~~ | **CLOSED by PR #59** — fail-closed via `buildFxRateExpr({ nullOnMissing })` + real-DB regression test. Superseded by the wider SQL-COALESCE finding in §4b |
| Bundle: recharts + all 4 nivo packages | P1 (perf) | framer-motion **is removed on PR #58's branch** (verified: zero imports remain; `WeeklyRecapWizard` rewritten to Tailwind animate-in). Chart-lib consolidation (recharts + 4 nivo) still outstanding. ~1–2d |
| ~~Filter-presets default toggle not transactional~~ | ~~P2~~ | **CLOSED on PR #58's branch** — `pg_advisory_xact_lock` + partial unique index (migration 0006) + 23505→409 + real-DB race test; reviewer-CONFIRMED. Name-dedupe check in the same service is still read-then-insert (MEDIUM residual, §4b) |
| Client float long-tail (input/OCR paths) | P2/P3 | `receiptParser.ts` (multiple `parseFloat(...).toFixed(2)` producing OCR amounts), `ImportTransactionsModal.tsx:99` (`parseFloat(amount)` on import), `GoalLinkingSection.tsx:130-131` (progress % — display-only). Server re-validates, but parsed amounts should go through `parseMoneyString`/`client/src/lib/money.ts`. Verified untouched by PR #58 |
| ~~CSRF header long-tail~~ | **P1 — upgraded and CONFIRMED** | Moved to §4b: it is not a residual audit item but live breakage of ~17 mutations |
| ~~BudgetRepository.ts LOC~~ | ~~P3~~ | **CLOSED on PR #58's branch** — split into `repositories/budgets/{Crud,Period,Rollover}` sub-repositories; reviewer diffed every method: faithful move |
| ~~Single global error boundary~~ | ~~P3~~ | **CLOSED on PR #58's branch** — `RouteErrorBoundary` wraps all 16 routes, resets on navigation; unit tests added this session |
| E2E beyond smoke | P2 | CI gates only `auth.spec.ts` smoke (`test:e2e:smoke`). Full Playwright suite determinism (seeds/creds) unverified |
| UI theming sweep | P3 | June's ~164 hardcoded color utilities / non-theme-aware chart palettes not re-swept — assume largely outstanding |

### §4b — NEW findings from session 2 (adversarial review + live verification)

**Fixed this session (commits on the respective branches):**

| Finding | Severity | Fix |
|---|---|---|
| Overdraft guard rejects positive deltas: delete an income → account −80 → every deposit < 80 rejected "Insufficient funds" (regression introduced by PR #58's balance-lock commit) | HIGH | Guard now fires only when `delta < 0` (`assertAssetAccountCanApplyDelta` + `updateTransfer` twin); real-DB deposit-into-negative test |
| `BudgetCrudRepository.delete` deleted `budget_periods` scoped only by budgetId, before the household check, no transaction — cross-tenant destructive write via foreign budget UUID | CRITICAL | Single household-scoped `budgets` delete; periods ride ON DELETE CASCADE; real-DB attacker/victim test |
| Coverage thresholds never run in CI (no `--coverage` anywhere in `ci.yml`) — "enforce coverage thresholds" enforced nothing | HIGH | CI steps switched to `test:coverage` / `test:coverage:server`; thresholds documented as regression floors |
| `RouteErrorBoundary` (new, wraps every route) had zero tests and sat outside coverage include | MEDIUM | 4-case unit test (render/fallback/reset-on-navigation/retry) + coverage include entries; `services/TransferService.ts` added to server coverage include |
| Transfer pair lock had no ORDER BY (plan-dependent deadlock window) | LOW | `ORDER BY id` added |
| NetWorth silent FX fallback | P1 | PR #59 (see above) |

**Open follow-ups (tracked, not blocking #58/#59):**

| Finding | Severity | Detail |
|---|---|---|
| CSRF long-tail — **confirmed live breakage** | HIGH (functional) | `useSecurity` (4 email-change mutations), `useReceipts` (7: upload/OCR/match/create-txn/retry/delete), `useNotifications` (3), `useAttachments` (2), `useWeeklyRecapData` feedback POST send no `x-csrf-token`; server exempts only pre-auth/cron/healthz, so all 403 in a real browser (`NODE_ENV=test` skips CSRF, which is why every suite is blind to it). `useGoals` has its own CSRF-aware helper (`useGoals.ts:371`) — extract it into `lib/api.ts` and route all five files through it. ~1d |
| Rules engine reads+mutates other members' private transactions | HIGH (privacy) | `rules.controller.ts:97,146,242` + `rule/service.ts:210` call `findByHousehold` with no visibility filter; `applyRulesToTransactions` then mutates matched rows (category/merchant/tags/split) including private ones. Full Rule-11 bypass, pre-existing. Route through the new `visibleToUserId` option from PR #58's T-5 fix. ~0.5–1d |
| Systemic SQL FX fallback: `COALESCE((SELECT rate...), 1)` | P1 (money) | `buildFxRateExpr` default + its duplicate in `SankeyNodes.ts:55` silently convert at 1 across Cashflow (×4 call sites), Sankey (×3), Spending, TransactionReport, BudgetComparison. These aggregate in SQL, so NULL-poisoning is not a safe fix — each needs a pre-aggregation rate-availability guard (assert all distinct currencies in range have rates, else throw). ~1–2d |
| `softDelete` balance reversal unlocked | HIGH (money) | `TransactionRepository.softDelete` reads via `findById` outside the txn, no FOR UPDATE on row or account — races update/move; stale reversal corrupts balances. Same sweep should cover `AccountCoreService.adjustBalance` (unlocked, unguarded) and delete dead `AccountRepository.updateBalance` (float signature, zero callers) |
| Transfer deletion is two sequential `softDelete` txns | HIGH (money) | `transaction/service.ts:428-437` — crash between them leaves a half-reversed transfer pair. Wrap pair deletion in one `withTransaction` with pair locks |
| Transfer pair desync via generic PUT | MEDIUM | `transaction/service.ts:218-224` only blocks transfer edits when `data.type` is supplied; amount-only PUT on one leg desyncs the pair |
| Budget period contract enforced at service boundary only | MEDIUM | Existing `yearly`/`custom` rows: computed as monthly, un-editable (400 on round-trip). Needs data migration or DB CHECK |
| `persistBudgetPeriodRollovers`: N upserts via `Promise.allSettled`, no txn, rejections silently dropped | MEDIUM | Partial rollover batches are invisible; wrap + log |
| Filter-preset duplicate-name check still read-then-insert | MEDIUM | Same service as the (fixed) default toggle; no constraint backs the name check |
| `updateTransfer` inline account lock lacks household scope + `deletedAt` filter | MEDIUM | Reuse `lockAccountsForBalanceMutation` instead of the inline duplicate |
| Coverage thresholds are back-derived regression floors (e.g. hooks 15% branches) | MEDIUM (honesty) | Now at least CI-enforced; ratchet plan needed |
| `Money.add/subtract` only warns on currency mismatch | MEDIUM | Legacy null-currency rows degrade silently in delta maps; consider throwing outside legacy read paths |
| 23505→409 translation in filter-presets never exercised by a test | LOW | Advisory lock prevents the service tests from reaching it |
| `updatePreset` racing `deletePreset` returns `undefined` typed as `FilterPreset` | LOW | Lock or post-update existence check |

---

## 5. Pending-Work Reconciliation

- **Final merge state (2026-07-04):** the pending `codex/production-readiness-p1` work landed through PRs #58 and #60, and the follow-up hardening PRs #59, #62, #64, and #65 are merged. `main` = `origin/main` = `4e173da`; there are no open PRs, no extra local branches, and no registered worktrees.
- **CI state:** GitHub CI and Amplify Security are green on `main@4e173da`; local `npm run check` passes.
- **Working tree cleanup:** the generated `playwright-report/index.html` artifact has been removed from Git tracking; `playwright-report/` was already ignored, so future report churn should not dirty the checkout.
- **Known deferred items from the remediation log:** client amount parsing cleanup, monthly-only budget-period product/data contract, rollover persistence atomicity, filter-preset duplicate-name DB constraint, tag-dedup forward-migration rework (dedupe-then-index as a *new* migration rather than rewriting merged `0003`), and Render provisioning per the deploy runbook.
- **Linear:** not reachable from this session (connector unauthenticated) — the SCP-3xx board should be reconciled against this final state.

---

## 6. Per-Module Delta (June verified score → today's code-verified state)

| Module | June | Today (qualitative) | Basis |
|---|---|---|---|
| AI Assistant | 34 🔴 | Materially remediated | Sanitiser-everywhere + honest attestation + arg validation + real conversations + Redis cap (all verified) |
| Investments/GRZ | 48 🔴 | Materially remediated | GRZ on Money + audited; SELL-race test coverage still unverified |
| Transactions | 58 🟠 | Near-closed | Locks/overdraft/idempotency real-DB-proven; privacy pagination pending branch merge |
| Household | 61 🟠 | Closed set | Atomic ownership/invites + role checks + user join, race-tested |
| Settings | 62 🟠 | Closed set | Real erasure service + race tests; step-up reauth shipped |
| Dashboard | 61 🟠 | Hooks crash closed | Bundle weight still outstanding |
| Weekly recap | 66 🟠 | Closed set | Consent gate + egress audit + cron lock |
| Budgets | 79 🟠 | Near-closed | Atomic recalc + schema constraints; period modes + LOC pending |
| Recurring | 74 🟠 | Closed set | SCP-330 atomicity, real-DB |
| Reports | 70 🟠 | Near-closed | FX fail-closed + export audit; NetWorth `??1` residual |
| Rules / Tags / Categories / Merchants / Receipts | 68–74 🟠 | Closed set | SCP-334/335 + race fixes verified |
| Filter-presets / Notifications / Health | 66–68 🟠 | Mostly closed | Presets default-toggle txn residual |
| Auth | 74 🟠 | Closed set | trust proxy + env validation + step-up + MFA paths |

No numeric re-score is asserted without running the suites; the table records which June findings no longer exist in code.

---

## 7. Product Gap Assessment vs Monarch Money

Feature inventory from code (`client/src/App.tsx` routes; `server/modules/*`): Dashboard (widget-customisable, drag-and-drop), Accounts (+detail, balance history), Transactions (splits, rules, tags, merchants, filters, bulk ops, CSV import wizard, exports), Budget, Goals (+detail, account linking, debt payoff calculators), Investments (+GRZ securities & auctions, security prices), Recurring, Cash Flow (incl. sankey + forecast with confidence scoring), Reports (multi-repository suite + CSV export with DPA audit), Receipts (OCR via tesseract), Advice ("Thandi" AI assistant, consent-gated, quota'd, persisted conversations), Settings (household roles/invites, security incl. MFA, step-up reauth, sessions, notifications incl. web push), weekly recap email, command palette, 3 themes, net-worth + account-balance snapshot tables.

**Parity with Monarch (manual-first equivalents):** multi-user household with roles, rules engine, recurring detection, budgets with rollover machinery (`budgetRollover.ts`) and a flex-budget unique index in schema, goals with account funding, cash-flow forecasting, CSV import/export, AI assistant, notifications, net-worth snapshot infrastructure.

**Gaps vs Monarch:**
1. **Bank/mobile-money sync** — none (by design in the Zambian market; Plaid-class aggregation doesn't exist there). The equivalent lever is richer *statement import*: bank-specific and MTN/Airtel Mobile Money CSV/PDF import profiles on top of the existing wizard.
2. **Net worth over time as a first-class surface** — the snapshot tables and report repository exist, but there's no dedicated dashboard trend + breakdown view comparable to Monarch's.
3. **Investment analytics** — holdings and prices exist (incl. `yahoo-finance2`), but no allocation/performance-vs-benchmark views.
4. **Budget flexibility exposed to users** — flex/rollover machinery exists server-side; the API still hard-locks `period: monthly` (pending branch) and the UI doesn't surface flex budgeting.
5. **Mobile** — no native apps and the PWA is incomplete: `sw.js` exists only for push; **no `manifest.json`, no app-shell registration** → not installable.
6. **Advisor/collaborator access** — absent (Monarch has advisor seats). Household roles partially cover this.
7. **Asset valuation** (Zestimate-style) — absent; manual asset accounts only.

**Differentiators over Monarch:** GRZ sovereign-debt module (bonds/T-bills, auctions, coupon + WHT handling), receipts OCR, Zambia DPA compliance (consent registry, real right-to-erasure, egress audit), multi-currency with fail-closed FX, household-level *private* transactions, step-up reauth, self-hosted deployability.

**Top enhancement candidates (product, post-readiness):**
1. Installable PWA (manifest + icons + offline shell) — the only viable "mobile app" in scope. *(product-gap)*
2. Net-worth trend dashboard widget over the existing snapshots. *(product-gap)*
3. Zambian statement-import profiles (Stanbic/Zanaco/FNB CSV, MTN/Airtel MoMo). *(product-gap, market differentiator)*
4. Expose budget periods + flex budgeting end-to-end (unblocked by the pending branch). *(product-gap)*
5. Investment allocation/performance views over existing holdings + prices. *(product-gap)*
6. Recurring calendar view. *(polish)*
7. Goal auto-funding (scheduled transfers using the recurring engine). *(product-gap)*
8. Chart-library consolidation (drop nivo or recharts) — doubles as the P1 bundle fix. *(polish/perf)*
9. Error-state UX consistency + per-route error boundaries. *(polish)*
10. AI assistant deep links ("show me" → filtered transactions view). *(polish)*

---

## 8. Revised Effort to Deploy-Ready

| Wave | Scope | Est. |
|---|---|---|
| 0. Prove green | Confirm CI and local typecheck on current `main@4e173da` | DONE |
| 1. Land branch work | Merge the production-readiness P1 and follow-up hardening PRs | DONE |
| 2. Residual hardening | Client amount parsing through `parseMoneyString`; monthly-only budget-period contract/migration decision; rollover persistence atomicity; filter-preset duplicate-name DB constraint | 2–4d |
| 3. Perf + polish gate | Chart-library consolidation and coverage-threshold ratchet plan | 1–3d |
| 4. Deploy | Render blueprint provisioning per runbook, staging smoke (auth, transfer, GRZ purchase, recap consent), go-live checklist | 1–2d |
| 5. Post-launch hardening | Full e2e determinism beyond smoke; theming sweep; product-roadmap items from §7 | 2–3d |

**Total to a defensible production deploy from the final close-out state: ~4–9 engineer-days**, mostly staging/deploy proof and lower-priority hardening. Product enhancements (§7) are a separate roadmap (~30–40d for the top five).

## 9. Recommended Sequence (updated after session 2)

1. ~~Confirm CI green on `main`~~ **DONE** — CI and Amplify Security are green on `4e173da`.
2. ~~Merge PR #58/#60/#59/#62/#64/#65~~ **DONE** — the production-readiness P1 and follow-up hardening wave is on `main`.
3. Commit the durable reconciliation record and stop tracking the generated Playwright report artifact.
4. Address the remaining hardening items in small PRs: client amount parsing, budget-period product/data contract, rollover persistence atomicity, filter-preset duplicate-name DB constraint, then chart-library consolidation/coverage ratchet.
5. Provision Render from `render.yaml`, run the deploy runbook, smoke the four money-critical flows on staging.
6. Start the Monarch-gap roadmap, biggest first: PWA manifest, net-worth surface, statement-import profiles.

---

*Method note: single-session, single-agent verification (classifier outage prevented the planned multi-agent fan-out and all shell/test execution). Every verdict above traces to a file:line read this session; items that needed a runtime signal are explicitly marked 🔍. This document supersedes the残 open-items view of the 2026-06-04 audit but does not supersede its method or its history.*
