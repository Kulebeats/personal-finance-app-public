<!-- Subagent inventory report saved verbatim by the lead (bold markers removed). Source: code-explorer agent, read-only, no suites executed by the agent, 2026-10-13, HEAD 381e943. -->

## Verification System Inventory: personal-finance-app

Read-only pass. No test suites were run by this agent and nothing under docs/reviews/ was read (the scripts do read it; see section 7). Counts come from grep and find. File lists are exact; heuristics behind the counts are stated where they matter.

### Headline cautions for the lead

1. Do not run server tests from the repo root. `npx vitest run server/...` from the root uses `vitest.config.ts` (lines 4-12). That config has no test-database derivation and no refusal guard. `server/db.ts:1` does `import "dotenv/config"`, which loads the root `.env` with the DEV `DATABASE_URL`. The real-DB suites DELETE users and households in cleanup.
   - Safe: `npm run test:server:run`, or `cd server && npx vitest run <path>`. `server/vitest.config.ts:22-28` sets `DATABASE_URL` to the test DB before any test imports `db`.
   - The Stop hook runs root-config `npx vitest run server/core/calculations`. That is safe only because `fxRates.db.integration.test.ts:51` uses `describe.skipIf(!process.env.DATABASE_URL)` and the root config does not load `.env`. If `DATABASE_URL` is exported in the shell, that file runs against it. It only touches XTS/XXX rows.
2. `npm run check` writes nothing tracked. Its `--check` mode is read-only (section 7). `tsc` writes only `node_modules/typescript/tsbuildinfo`.
3. `coverage/server/` is tracked in git (74 files, for example `coverage/server/coverage-final.json`). It is stale: vitest now writes to `.local/coverage/*`, which is gitignored. Do not treat the tracked copy as evidence.

### 1. Suite map

| npm script | Config | Include globs | Env | DB |
|---|---|---|---|---|
| `test`, `test:run`, `test:coverage`, `test:client:integration`, `test:run:settings/rest/split` (package.json:23-28, 32) | `client/vitest.config.ts` | `client/**/*.{test,spec}.{ts,tsx}` (line 17) | jsdom; setup `client/src/test-setup.ts`; threads pool, `fileParallelism:false`, `maxConcurrency:1` (lines 8-13) | None. Client tests never import `server/`. |
| `test:server`, `test:server:run`, `test:coverage:server` (package.json:29-30, 33) | `server/vitest.config.ts` (via `cd server`) | Vitest default include relative to `server/`: all `*.test.ts` and `*.spec.ts`. 201 files. | node; serial; `testTimeout` 15s, `hookTimeout` 30s (lines 32-36) | Real Postgres. `resolveTestDatabaseUrl` in `server/testing/test-database.ts:46-80`: `TEST_DATABASE_URL` wins; else an ambient `DATABASE_URL` already test-scoped is used as-is (CI's `pfa_test`); else it derives `<name>_test`. `assertNotDevDatabase` (lines 91-128) throws if the resolved name equals the ambient dev name or is not test-scoped (regex `(^|_)test(_|$)`). The guard is unit-tested in `server/testing/__tests__/test-database.test.ts`. |
| (no script; Stop hook only) | root `vitest.config.ts` | `server/**/*.{test,spec}.{ts,tsx}` and `server/**/__tests__/**` (lines 7-10) | node, `globals:true` | UNGUARDED (see caution 1) |
| `test:e2e`, `test:e2e:smoke`, `:headed`, `:ui` | `playwright.config.ts` | `./e2e`; 4 projects: chromium, firefox, webkit, Mobile Chrome (lines 22-39) | Browser; `globalSetup ./e2e/global-setup` (registers a user and writes `e2e/.auth/credentials.json`, gitignored). Web server is `npm run dev` with `NODE_ENV=test` (lines 41-55). | Whatever `DATABASE_URL` the dev server picks up. Locally that is `.env`, i.e. the dev DB, with no guard. In CI it is `pfa_e2e`. |
| `test:ai:eval` | `scripts/ai-eval-gate.ts` | n/a | tsx | None. It calls `runAIEvalPack()` from `server/modules/ai/ai.eval-pack.ts`. Static catalog checks, not model calls (not fully read). |
| `db:test:setup` | `scripts/setup-test-db.mjs` | n/a | node | CREATEs `<name>_test` if absent, then `drizzle-kit push` into it. Schema push, not migrate. CI uses `db:migrate`. |

`tsconfig.json` includes `server/**/*` and `client/src/**/*` with no test exclusion, so `tsc` in `npm run check` type-checks test files.

### 2. Classification counts

Server: 201 test files. Heuristic split by grep for imports of `db` and `vi.mock(`.
- (b) Real-DB: 77 files. They import the real `db` (not `vi.mock`ed) and issue inserts, deletes or selects against Postgres.
- (a) Mock-based: 70 files with `vi.mock(` and no real DB. 22 mock `db` itself, 53 mock db, storage or repositories (union).
- Neither: 54 files (pure unit, property, or HTTP with no mocks).
- (c) HTTP-level (supertest): 75 files. 45 are real-DB plus HTTP and 30 are HTTP with mocks or in-process stubs.
- fast-check property tests: 10 server files and 10 client files.

Client: 164 files, all jsdom. 95 use `vi.mock`, 17 mock `fetch` globally. No msw and no real backend. All client tests prove UI behaviour only, not persistence.

E2E: 10 spec files (accounts 11 tests, auth 7, budget 10, dashboard 6, goals 6, investments 3, organization 14, recurring 6, reports 6, transactions 8).

Real-DB tests that go through HTTP (supertest plus real Postgres): 45 files. Strongest persistence evidence.
- server/__tests__/uploads-auth.integration.test.ts
- server/modules/accounts/__tests__/accounts.realdb.integration.test.ts
- server/modules/accounts/__tests__/accounts.stepup.db.integration.test.ts
- server/modules/ai/__tests__/ai.consent.realdb.integration.test.ts
- server/modules/ai/__tests__/ai.multi-turn-context.db.test.ts
- server/modules/ai/__tests__/ai.status-degraded.realdb.integration.test.ts
- server/modules/auth/__tests__/auth.password-reset.realdb.integration.test.ts (partial mock)
- server/modules/budgets/__tests__/budgets.integration.test.ts
- server/modules/categories/__tests__/categories-security.integration.test.ts
- server/modules/goals/__tests__/goals.images.db.integration.test.ts
- server/modules/goals/__tests__/goals.projection.realdb.integration.test.ts
- server/modules/goals/__tests__/goals.realdb.integration.test.ts
- server/modules/health/__tests__/health.integration.test.ts
- server/modules/household/__tests__/household.updateGeneral.db.integration.test.ts (partial mock)
- server/modules/investments/__tests__/investments.db.integration.test.ts
- server/modules/investments/__tests__/investments.sell-overdraft.realdb.integration.test.ts
- server/modules/merchants/__tests__/merchants.integration.test.ts
- server/modules/receipts/__tests__/receipts.upload.db.integration.test.ts
- server/modules/recurring/__tests__/recurring.db.integration.test.ts
- server/modules/reports/__tests__/reports-export-audit.integration.test.ts
- server/modules/rules/__tests__/rules.integration.test.ts
- server/modules/rules/__tests__/rules.privacy.realdb.integration.test.ts
- server/modules/settings/__tests__/settings.banner.db.integration.test.ts
- server/modules/settings/__tests__/settings.integration.test.ts
- server/modules/settings/__tests__/settings.password-change-session-revocation.realdb.integration.test.ts
- server/modules/settings/__tests__/settings.picture.db.integration.test.ts
- server/modules/settings/__tests__/settings.stepup.db.integration.test.ts
- server/modules/tags/__tests__/tags-security.integration.test.ts
- server/modules/tags/__tests__/tags.transactions.visibility.realdb.integration.test.ts
- server/modules/transactions/__tests__/transactions.attachments.tempfile.integration.test.ts
- server/modules/transactions/__tests__/transactions.bulk-owner.realdb.integration.test.ts
- server/modules/transactions/__tests__/transactions.realdb.integration.test.ts
- server/modules/weekly-recap/__tests__/weekly-recap-guard.integration.test.ts
- server/modules/weekly-recap/__tests__/weekly-recap.integration.test.ts
- server/routes/__tests__/grz-audit.integration.test.ts
- server/routes/__tests__/grz-money.integration.test.ts
- server/routes/__tests__/grz-record-only.integration.test.ts
- server/routes/__tests__/grz-securities.sell-race.db.integration.test.ts
- server/routes/__tests__/grz-securities.v7-envelope.integration.test.ts
- server/routes/__tests__/import.execute.realdb.integration.test.ts
- server/routes/__tests__/investment-tax.money-audit.realdb.integration.test.ts
- server/routes/__tests__/p6a-login-history-export-audit.realdb.integration.test.ts
- server/routes/__tests__/security.email-tokens-hashed.realdb.integration.test.ts (partial mock)
- server/services/transaction/__tests__/p6a-create-delete-audit.realdb.integration.test.ts
- server/services/transaction/__tests__/p8b-update-audit.realdb.integration.test.ts

Real-DB tests that call a service or repository directly, no HTTP: 32 files.
- server/core/calculations/currency/__tests__/fxRates.db.integration.test.ts (`skipIf(!DATABASE_URL)`; lazy `db` import)
- server/core/events/__tests__/outbox.transactional.db.integration.test.ts
- server/modules/ai/__tests__/ai.conversation.persistence.db.test.ts
- server/modules/filter-presets/__tests__/filter-presets.default-atomicity.db.integration.test.ts
- server/modules/filter-presets/__tests__/filter-presets.name-unique.db.integration.test.ts
- server/modules/recurring/__tests__/recurring_concurrency.integration.test.ts
- server/modules/reports/__tests__/reports.export.budget.currency.db.integration.test.ts
- server/modules/settings/__tests__/settings.account-deletion.db.integration.test.ts
- server/modules/settings/__tests__/settings.account-deletion.files.db.integration.test.ts
- server/modules/settings/__tests__/settings.account-deletion.race.db.integration.test.ts
- server/modules/weekly-recap/__tests__/weeklyRecapConsent.test.ts (partial mock)
- server/repositories/__tests__/HouseholdRepository.createWithOwner.concurrency.db.integration.test.ts
- server/repositories/__tests__/HouseholdRepository.createWithOwner.db.integration.test.ts
- server/repositories/__tests__/HouseholdRepository.test.ts
- server/repositories/__tests__/budgetRepository.test.ts
- server/repositories/__tests__/householdOwnership.atomicity.test.ts
- server/repositories/__tests__/householdRoles.scp333.test.ts
- server/repositories/__tests__/taxonomy.scp335.test.ts
- server/repositories/budgets/__tests__/BudgetCrudRepository.delete.db.integration.test.ts
- server/repositories/reports/__tests__/NetWorthReportRepository.fxfailclosed.db.integration.test.ts
- server/repositories/reports/__tests__/ReportRepositories.fxfailclosed.db.integration.test.ts
- server/services/__tests__/GoalTransferService.lockorder.db.integration.test.ts
- server/services/__tests__/InvestmentAutomationService.concurrency.integration.test.ts
- server/services/__tests__/TransactionDeletion.concurrency.test.ts
- server/services/__tests__/TransferService.concurrency.test.ts
- server/services/budget/__tests__/BudgetRecalculation.race.db.integration.test.ts
- server/services/budget/__tests__/budgetRecalc.atomicity.test.ts
- server/services/receipt/__tests__/linkReceiptRace.test.ts (partial mock)
- server/services/recurring/__tests__/processRecurring.atomicity.test.ts
- server/services/recurring/__tests__/processRecurring.materialization.realdb.integration.test.ts
- server/services/rule/__tests__/applyRulesAtomic.test.ts
- server/services/rule/__tests__/dryRunVisibility.test.ts

HTTP-level tests that do NOT touch a real DB (30 files; supertest with mocked services or storage, or a bare express app): household-isolation.security, accounts.integration, ai.ratelimit-429-headers, ai.remaining-quota-plumbing, auth.integration, auth.lockout, auth.mfa.resend, auth.ratelimit, auth.security, auth.stepup, categories.integration, filter-presets.audit, goals.integration, household.integration, investments.integration, notifications.integration, receipts.integration, recurring.integration, reports.integration, settings.security, tags.integration, transactions.integration, routes/budgets.integration, routes/goals.integration, routes/receipts.integration, routes/recurring.integration, routes/reportWidgetPreferences, routes/reports.integration, routes/transactions.integration, utils/errorHandler.retryAfter.

The `*.integration.test.ts` suffix is not a proof of persistence. 81 files contain "integration" in the name, but only about half hit Postgres. For example `transactions.integration.test.ts` has 9 `vi.mock`s, and the routes version has 15.

Files that `vi.mock` the db module outright (22): ai.provider-fallback, ai.service.sanitization, ai.tool-arg-validation, auth.geo, auth.report, AnalyticsReportRepository, CashflowReportRepository, CompositeReportRepository, NetWorthReportRepository, SankeyHelpers, TransactionReportRepository, transactionAtomicity.property, transactionRepository, routes/investments.test, budgetService, fx.failclosed, fxAttributionService, GoalTransferService, investmentPerformanceService, investmentTaxService, SessionAuditLogging.property, SessionService.property.

### 3. Financial-logic coverage and quality of expected values

"H" means hardcoded, independent numbers. "C" means computed by the production function under test.

| Area | Files | Evidence quality |
|---|---|---|
| Money class | server/core/__tests__/money.test.ts (470 lines, 105 expects) | H, strong: `add` → "30.30", `subtract` → "0.20", `divide` → "5.00" (lines 21-71). |
| Budget rollover | core/calculations/cashflow/__tests__/budgetRollover.currency.test.ts, budgetComparison.currency.test.ts, services/budget/__tests__/BudgetCoreService.edge.test.ts, services/__tests__/budgetService.test.ts (mocks `db`) | Rollover: H ("500.00"/"150.00"/"650.00", lines 92-99). budgetService is mock-DB. |
| Budget recalc persistence | BudgetRecalculation.race.db (real DB, H: "450.00"), budgetRecalc.atomicity | Real DB, H. |
| Transfers | TransferService.concurrency.test.ts (real DB; balances "0.00"/"100.00"/"-100.00"; transfer row counts), TransactionDeletion.concurrency, transactions.realdb | Real DB, H. Strong. |
| Goal transfers and contributions | GoalTransferService.test.ts (mock db; H e.g. "900.01", "66.77"), GoalTransferService.lockorder.db, core/calculations/goals/__tests__/goals.test.ts (H), goals.realdb (persisted `targetAmount` "5000.00" plus audit row) | Mixed. |
| Goal projection | services/goal/__tests__/GoalProjectionCalculator.test.ts lines 46-47 | C: weak. The "matches the underlying scenario engine" test compares to `calculateScenario` output. |
| Imports | routes/__tests__/import.execute.realdb (real DB, H: balance "1000.00"/"49.75", persisted row counts, 403/404), services/__tests__/import.dedupe.characterization (H golden keys), import.parse.characterization, routes/__tests__/import.test.ts | Strong where real DB. |
| Recurring execution | processRecurring.materialization.realdb (H: nextDue "2024-03-01", created counts, replay idempotence, `appliedDelta` "100.00"), processRecurring.atomicity, recurring_concurrency, recurring.db.integration; the two `recurring.integration.test.ts` files are mocked | Real DB, H. |
| GRZ / investments | routes/__tests__/grz-money.integration.test.ts (real DB over HTTP, H: coupon gross "836.70", WHT "125.51", net "711.19"; principal "100.00"), investment-tax.money-audit.realdb (H: "0.60"/"0.30"), investmentTaxService.test (mock db, H "115.00"/"420.00"/"375.00"), core/calculations/investments (TWR, H), investments.sell-overdraft.realdb (409 plus held quantity), grz-securities.sell-race, InvestmentAutomationService.concurrency | Real DB, H. |
| FX conversion | core/calculations/currency/__tests__/fxRates.test.ts (H: 25.43, `MISSING_FX_RATE`), conversion.fxfailclosed, fxRates.db.integration (real DB, pinned TZ UTC-12), services/__tests__/fx.failclosed (mock db), fxAttributionService (mock db) | Mixed. Fail-closed covered with a real DB in the two `*.fxfailclosed.db` files. |
| Reports aggregation | NetWorthReportRepository.fxfailclosed.db and ReportRepositories.fxfailclosed.db (real DB; `{amount:"40.00",currency:"USD"}`), reports.export.budget.currency.db; the other repositories/reports/__tests__/*.test.ts are mock `db` | The mock-db report repositories do not prove that the real SQL aggregation is correct. Only the 3 real-DB files hit Postgres. Reports HTTP tests (reports.integration x2) are mocked. |

Not located: a real-DB test of budget rollover SQL, multi-currency report totals, or `Money` precision through the Drizzle string-decimal round trip.

### 4. Weak spots (file:line)

Skipped tests (2 in total):
- server/core/calculations/currency/__tests__/fxRates.db.integration.test.ts:51: `describe.skipIf(!process.env.DATABASE_URL)`.
- e2e/investments.spec.ts:103: `test.skip(!hasHoldings, ...)`.
- No `.todo`, `xit`, `.only` or `.fixme` anywhere under server, client/src or e2e.

`expect(true)` and similar vacuous assertions: server/core/calculations/__tests__/performance.test.ts:199; server/repositories/__tests__/budgetRepository.test.ts:499; server/core/calculations/__tests__/helpers.test.ts:384 (failure marker, not vacuous); client/src/pages/settings/__tests__/apiEndpointCompatibility.property.test.ts:133, 138, 143; client/src/pages/settings/__tests__/errorBoundaryIsolation.property.test.tsx:46; client/src/pages/settings/__tests__/independentLoadingStates.property.test.tsx:45.

`expect.anything()`: low overuse (budgetService.test.ts 6, household-isolation.security.test.ts 3, settings.security.test.ts 2, 3 others with 1 each).

Broad `vi.mock("../../db")`: 22 files (list in section 2). Examples: budgetService.test.ts:28, GoalTransferService.test.ts:33, investmentTaxService.test.ts:7, investmentPerformanceService.test.ts:8, the 6 report-repository tests at line 4, transactionRepository.test.ts:16.

Swallowed errors: client/src/lib/__tests__/queryClient.authExpiry.test.ts:80, 94, 113, 136, 154, 163 (`.catch(() => {})` on mutations expected to reject); e2e/reports.spec.ts:85; settings.account-deletion.files.db.integration.test.ts:335, 370 (cleanup); e2e/investments.spec.ts:~101. No empty `try { ... } catch {}` blocks in server tests.

Console suppression: `client/src/test-setup.ts` makes any unexpected console output FAIL a test (strong guard). Four files mock `console.error` to silence it (ErrorBoundary.test.tsx:9, endToEndScenarios.property.test.tsx:121, integration.test.tsx:60, apiFailureStatePreservation.property.test.ts:17). Server has no equivalent.

Structural weak spots: Playwright CI uses `retries: 2` and `workers: 1` (playwright.config.ts:13-14). `test:e2e:smoke` excludes `reports.spec.ts` and runs chromium only. The 70 mock-based server files plus the 30 mock-service HTTP tests mean the "integration" label overstates coverage in several modules (transactions, goals, reports, budgets-in-routes, recurring-in-routes, receipts). The server `coverage.include` globs name specific directories; a new directory would silently not be gated (server/vitest.config.ts:141-144).

### 5. CI (.github/workflows/)

ci.yml: triggers `pull_request` and `push` to main. Concurrency group `ci-${{ github.ref }}`, `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}` (lines 14-23). No `permissions:` block, no `continue-on-error`, no `upload-artifact`. Runner ubuntu-latest, Node 20, `actions/checkout@v7`, `actions/setup-node@v6` (versions not verified).
- verify job (timeout 30 min), Postgres `postgres:16`, DB `pfa_test`. Env: `GEMINI_API_KEY`, `CRON_SECRET`, `SESSION_SECRET` placeholders. Steps: `npm ci`; `npm audit --omit=dev` (blocking); `npm run check`; `npm run db:migrate`; `npm run test:coverage:server` (thresholds armed); `npm run test:coverage` (client; thresholds armed); `npm run build`; `npm run check:bundle` (300 kB gzip initial JS budget).
- e2e job: `needs: verify`, timeout 20 min, Postgres `pfa_e2e`, `PORT 5000`, SMTP blanked. `npm ci`, `npx playwright install --with-deps chromium`, `npm run db:migrate`, `npm run test:e2e:smoke` (9 specs on chromium; `reports.spec.ts` excluded). No trace or report artifact uploaded.

Enforced coverage thresholds. Client (`client/vitest.config.ts:52-141`): global statements 42, branches 38, functions 38, lines 42; per-glob: ai 85/78/85/85; settings feature 95/85/95/95; goals 80/50/80/80; utils 70/65/85/70; budget 62/56/60/63; cashflow 60/43/58/60; recurring 60/52/44/60; reports feature 47/38/40/49; components/reports 60/65/50/63; accounts 36/25/29/35; investments 49/36/29/49; transactions 41/41/31/40; hooks 28/15/29/29; lib 28/20/33/29. Server (`server/vitest.config.ts:86-150`): global 60/45/60/60; core/calculations 50/40/55/50; main modules 75/58/78/78; repositories 60/44/63/62; services budget/goal/etc. 38/34/37/39; GRZ 40/28/50/41; ai 45/33/50/46; import 68/52/74/68. These are regression floors calibrated to current measurements. CLAUDE.md Rule 17 asks for 80% on financial operations; GRZ money math is gated at about 40%.

ai-eval-gate.yml: path-filtered to `server/modules/ai/**` etc.; runs `npm run test:ai:eval`; no DB. amplify.yml: third-party security scan on `amplify-security/runner-action@main` (unpinned); not a test gate.

Not in CI: `deploy:verify`, `smoke:staging:health`, `check:w9-evidence`, `check:modules-final`.

### 6. Hooks and gates

`.claude/settings.json` has 3 PreToolUse hooks and 1 Stop hook, run as `node .claude/hooks/*.mjs`.
- PreToolUse on `Write|Edit`: `block-money-floats.mjs`. Exit 2 (block) when the file path matches `/(server[\/\\]services|server[\/\\]routes[\/\\]grz|core[\/\\]calculations|currency|budget|Money)/i` AND the new content matches `/\.toFixed\(|parseFloat\(|Number\([^)]*amount|amount[^;]*\*[^;]*rate|rate[^;]*\*[^;]*amount/i`. Applies to test files in those paths too. `[^;]*` crosses newlines (known false-positive landmine).
- PreToolUse on `Write|Edit`: `block-any-casts.mjs`. For `.ts`/`.tsx` blocks `/\bas any\b|:\s*any\b|@ts-ignore/`, including test files.
- PreToolUse on `Bash`: `scan-secrets.mjs`. Only when the command matches `git commit`, scans `git diff --cached` for `AIza...`, PEM private-key headers, `GEMINI_API_KEY=...`, and `sk-...`.
- Stop: `stop-gate.mjs`. Skips if `REMEDIATION_GATE=off` or if `package.json` is absent. Otherwise runs `npm run check`, then `npx vitest run server/core/calculations --reporter=dot` (root config). Either failure exits 2 and blocks ending the turn. The DB-dependent `fxRates.db` test silently skips here.
- Every hook swallows a JSON-parse failure of its stdin and exits 0 (fail-open).

`scripts/check-loc-limits.mjs` (in `npm run check`) is a ratchet: server `*.ts` 500 LOC (non-test), `server/modules/*/*routes.ts` 100, `client/src/**/*.tsx` 300. Baseline `scripts/loc-baseline.json`, 62 entries (29 server, 33 client), generated 2026-07-20. Fails for a file not in the baseline over its limit, or a baselined file that grew. `--update` rewrites the baseline.

Other `npm run check` parts: `check-no-storage-imports.mjs`, `check-node-tool-syntax.mjs`, `check-module-assessment-metadata.mjs`, `generate-module-assessment-status-report.mjs --check`, `check-w9-template-coverage.mjs`, `check-w10-worksheet-coverage.mjs`. The last four read docs/reviews, docs/module-status and similar; if those docs drift, `npm run check` fails for documentation reasons.

### 7. Generators and scripts that modify tracked or persistent state

Safe, read-only: `npm run check` (all parts); `check:*` scripts; `check:bundle` (needs `dist/public`); `deploy:verify`; `test:ai:eval`; all `test:*` scripts apart from the coverage output below.

Write tracked files: `node scripts/check-loc-limits.mjs --update` writes `scripts/loc-baseline.json`; `npm run report:modules` (no `--check`) overwrites `docs/reviews/module-assessment-status-report.md` (`generate-module-assessment-status-report.mjs:617`); `check:modules-final` does not write but fails unless all modules are final-ready.

Write other files: `smoke:staging:health --json <path>` writes the given path and makes network calls; `test:coverage*` writes `.local/coverage/{client,server}` (gitignored); Playwright writes `playwright-report/`, `test-results/` and `e2e/.auth/credentials.json` (gitignored) and its global setup registers a user in the DB the dev server points to; `tsc` writes `node_modules/typescript/tsbuildinfo`.

Database-mutating: `db:push`, `db:generate`, `db:migrate`, `db:test:setup`, `migrate:merchants`; unwired `scripts/*.ts` (`fix-all-columns`, `fix-database-schema`, `fix-first-name`, `add-nrc-column`, `add-email-verification-columns`, `run-migration`, `run-enhanced-migration`, `seed-system-roles`, `create-test-user`, `scripts/tools/create-test-user-local.ts`, `update-merchant-logos`); `scripts/windows/*.bat`.

### 8. Unverified items

- `.claude/agents/*.md` and `.claude/skills/*` bodies not opened.
- The real-DB classification is heuristic (import-path regexes). The 9 HTTP-with-mocks files that use `getTestApp()` fixtures could hit the real DB despite `vi.mock` calls; not opened.
- Expected values spot-checked in about 20 files; the "C versus H" calls are a sample.
- Whether CI is green on current main is unknown to this agent.
- No test, script or CI step was executed by this agent, so real test counts are from the lead's runs (EVIDENCE.md).
- GitHub Action versions (`checkout@v7`, `setup-node@v6`) not verified.
- `server/modules/ai/ai.eval-pack.ts` only grepped.
- The memory note that e2e CI gates only `auth.spec` is stale: `ci.yml` runs 9 of 10 specs.
