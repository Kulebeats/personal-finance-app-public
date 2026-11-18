# Production Readiness Open Findings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close every partially closed or still-open finding from `docs/reviews/production-readiness-audit-2026-06-04.md`, starting with all P0 deployment, scheduler-lock, and CI/E2E gaps.

**Architecture:** The June audit remains the authoritative requirements source. This plan is the implementation map: each item ties the audit requirement to current live-code evidence, exact files, test strategy, and acceptance criteria. Work proceeds from launch-blocking P0s to data-correctness P1s, then UX/performance and lower-priority hardening.

**Tech Stack:** Node 20, TypeScript, Express, Drizzle/Postgres, Redis via `ioredis`, Vitest, Playwright, GitHub Actions, Vite/React/Tailwind.

---

## Source Requirements

- Authoritative audit: `docs/reviews/production-readiness-audit-2026-06-04.md`.
- Current status baseline: the repo has materially closed many original P0s, but the remaining non-closed queue is 21 unique findings: 3 P0 partials, 2 core P1 partials, 7 core P1 open, 3 UX P1 partials, 1 lower-priority partial, and 5 lower-priority open.
- Latest verified baseline before this plan: `main` was clean and tracking `origin/main`; local build and GitHub Actions were green after commit `757e6e7b8fade62f1d2d2a46d84c627c1f79573f`.

## Execution Order

1. P0 deployment/readiness proof.
2. P0 scheduler Redis lock correctness.
3. P0 deterministic E2E CI gate.
4. Core data correctness P1s.
5. Test/coverage P1s.
6. UX/performance hardening.
7. Lower-priority polish and responsive cleanup.

---

### Task 1: P0 Scheduler Redis Lock Correctness

**Files:**
- Modify: `server/config/redis.ts`
- Modify: `server/scheduler.ts`
- Test: `server/config/__tests__/redis-infra.test.ts`
- Test: `server/__tests__/scheduler.lock.test.ts`

**Audit Requirement:** Cron jobs must not double-fire under horizontal scaling, and the distributed lock must not run unlocked after Redis failure or release another instance's lock.

**Current Evidence:**
- `withRedisLock` uses `SET key "1" EX ttl NX`.
- On Redis acquisition error, it logs and runs the job without a lock.
- Release uses plain `DEL`, so an expired lock holder can delete a new holder's lock.

**Implementation:**
1. Write failing tests with an injected fake Redis client proving:
   - another holder returns `{ ran: false }`;
   - acquisition failure in production does not execute `fn`;
   - release uses owner-token compare/delete and does not delete a different owner's lock;
   - release deletes only when the token still matches.
2. Export a small testable helper from `server/config/redis.ts`, for example `runWithRedisLockClient`.
3. Generate a unique owner token with `crypto.randomUUID()`.
4. Acquire with `SET lockKey token EX ttl NX`.
5. Release with a Lua compare/delete script:
   ```lua
   if redis.call("get", KEYS[1]) == ARGV[1] then
     return redis.call("del", KEYS[1])
   end
   return 0
   ```
6. Keep dev/test no-Redis fallback running directly.
7. In production, fail closed if Redis lock acquisition fails; do not run the scheduled job unlocked.
8. Wrap cron callbacks in `.catch(...)` logging so fail-closed behavior is visible rather than unhandled.

**Verification:**
```bash
cd server
npx vitest run config/__tests__/redis-infra.test.ts ../server/__tests__/scheduler.lock.test.ts
```

**Acceptance Criteria:**
- Scheduler jobs run once when Redis lock is acquired.
- Scheduler jobs skip when another instance holds the lock.
- Production Redis acquisition errors do not execute jobs unlocked.
- Lock release cannot delete another owner's lock.

---

### Task 2: P0 Deploy Readiness Proof and Runbook Refresh

**Files:**
- Create: `scripts/verify-deploy-readiness.mjs`
- Modify: `package.json`
- Modify: `docs/runbooks/deploy.md`

**Audit Requirement:** The deploy path must run the backend, migrations, health check, production env validation, Redis-backed cluster primitives, and documented rollback/smoke verification.

**Current Evidence:**
- `.replit` now uses `deploymentTarget = "cloudrun"` and `run = ["npm", "run", "start"]`.
- `render.yaml` provisions web service, Postgres, Redis keyvalue, `preDeployCommand: npm run db:migrate`, and `/healthz`.
- `docs/runbooks/deploy.md` still says single-instance only and Redis is optional/deferred.

**Implementation:**
1. Add `scripts/verify-deploy-readiness.mjs` to assert:
   - `.replit` deployment target is not static and starts `npm run start`;
   - `render.yaml` has `buildCommand`, `preDeployCommand: npm run db:migrate`, `startCommand: npm run start`, `healthCheckPath: /healthz`;
   - `render.yaml` injects `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `CLIENT_URL`, `APP_URL`, and `TRUST_PROXY`;
   - `package.json` exposes `build`, `start`, and `db:migrate`.
2. Add `"deploy:verify": "node scripts/verify-deploy-readiness.mjs"`.
3. Update deploy runbook:
   - Redis is required in production, not optional for scale only.
   - Multi-instance safety depends on Redis-backed rate limits/cache/scheduler locks.
   - Local closure command is `npm run deploy:verify`.
   - Live Render checklist remains manually verified by operator.

**Verification:**
```bash
npm run deploy:verify
npm run build
```

**Acceptance Criteria:**
- Repo-level deploy readiness can be checked locally with one command.
- Runbook matches actual Render/Replit configuration.
- The plan does not falsely mark live Render deployment checks complete without external proof.

---

### Task 3: P0 Deterministic E2E CI Gate

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `e2e/investments.spec.ts`
- Modify: `e2e/recurring.spec.ts`
- Modify: `e2e/goals.spec.ts`
- Modify: `e2e/reports.spec.ts`
- Possibly modify: `e2e/utils/testUser.ts`
- Possibly modify: `playwright.config.ts`

**Audit Requirement:** CI must include a deterministic browser smoke/regression gate. E2E specs must not silently fall through unauthenticated because seeded credentials drift.

**Current Evidence:**
- CI has the E2E job commented out.
- `e2e/global-setup.ts` seeds `TestPass123!`.
- Multiple specs manually submit `TestPassword123!`.

**Implementation:**
1. Replace hardcoded credentials in affected specs with `getTestUser()`.
2. Keep global setup writing `e2e/.auth/credentials.json`.
3. Enable a CI `e2e` job after `verify`, with Postgres service and the same test env placeholders as `verify`.
4. Run the auth/session Chromium smoke spec first in CI to keep the P0 gate deterministic; the full browser matrix and feature-heavy specs remain P1 hardening until their seed data and runtime are stable.

**Verification:**
```bash
npm run test:e2e:smoke
gh workflow view CI --yaml
```

**Acceptance Criteria:**
- E2E specs use the seeded user consistently.
- CI runs the auth/session E2E smoke gate after type/server/client/build verification.
- A failing login/setup fails CI loudly.

---

### Task 4: P1 Transfer and Transaction Update Locks

**Status:** Closed in `codex/production-readiness-p1` batch 1. Transfer updates now lock transfer rows and all affected account rows before calculating net deltas; ordinary transaction updates lock the transaction/account row before recalculating balance impact.

**Files:**
- Modify: `server/services/TransferService.ts`
- Modify: `server/repositories/TransactionRepository.ts`
- Test: focused real-DB transaction/transfer integration tests under `server/**/__tests__`

**Audit Requirement:** Balance mutations must lock affected account rows before reversal/application and re-check sufficient funds under lock.

**Implementation:**
1. Add failing real-DB tests for concurrent transfer update and expense update.
2. Lock affected accounts with `FOR UPDATE` in a deterministic order.
3. Recalculate old and new balance effects under the same transaction.
4. Reject insufficient asset-account balances.

**Verification:**
```bash
cd server
npx vitest run path/to/transaction-lock.test.ts
```

---

### Task 5: P1 Expense Overdraft Guard

**Status:** Closed in `codex/production-readiness-p1` batch 1. Asset-account expenses and updates now fail before balances can go negative; liability accounts still support negative balances.

**Files:**
- Modify: `server/repositories/TransactionRepository.ts`
- Possibly modify: shared validation or service layer around transaction creation/update
- Test: real-DB tests for asset expense create/update

**Audit Requirement:** Non-transfer expenses against asset accounts must not silently drive cash/bank balances below zero.

**Implementation:**
1. Write failing tests for expense create and update overdrafts.
2. Allow liabilities/credit semantics explicitly if existing domain expects negative balances there.
3. Enforce guard in the same transaction as balance mutation.

---

### Task 6: P1 Transaction Visibility Pagination

**Status:** Closed in `codex/production-readiness-p1` batch 2. Transaction/account privacy predicates now run inside the SQL query before ordering, `limit`, and `offset`; the count query already used matching SQL visibility predicates.

**Files:**
- Modify: `server/repositories/TransactionQueryRepository.ts`
- Test: repository or HTTP real-DB tests for hidden accounts/transactions with pagination

**Audit Requirement:** Visibility filters must be applied in SQL before pagination, not after `limit/offset`.

**Implementation:**
1. Write failing test where hidden rows consume the first page and visible rows are incorrectly omitted.
2. Push visibility conditions into the SQL query used by `findByHouseholdWithVisibility`.
3. Keep count query and page query behavior aligned.

---

### Task 7: P1 Budget Repository Split

**Status:** Closed in `codex/production-readiness-p1` batch 3. `BudgetRepository` remains the stable public facade while CRUD, budget-period, and rollover persistence logic now live in focused helpers under `server/repositories/budgets/`; existing budget API and service behavior is unchanged.

**Files:**
- Modify: `server/repositories/BudgetRepository.ts`
- Create: smaller repository/helper files under `server/repositories/budgets/`
- Test: existing budget integration suite

**Audit Requirement:** Reduce overlarge repository complexity without behavior changes.

**Implementation:**
1. Split CRUD, period, and stats/rollover responsibilities.
2. Preserve public API while moving internals.
3. Run existing budget tests after each extraction.

---

### Task 8: P1 Budget Period Modes

**Status:** Closed in `codex/production-readiness-p1` batch 4. Budget creation/update now has a consistent monthly-only contract across API validation, service-level defensive validation, client types, and schema comments; `yearly` and `custom` remain explicitly rejected until period-aware progress/forecast calculations are implemented.

**Files:**
- Modify: `server/modules/budgets/budgets.validation.ts`
- Modify: budget period calculation services/repositories as needed
- Test: budget API tests for `monthly`, `yearly`, and `custom`

**Audit Requirement:** Either implement advertised `yearly/custom` periods or remove them from product/API claims.

**Implementation:**
1. Write tests for accepted/rejected period values and generated periods.
2. Implement period-aware date windows or explicitly remove unreachable modes from schema/docs.
3. Prefer implementation only if service calculations can be made correct without broad redesign.

---

### Task 9: P1 Skipped Risky Tests

**Status:** Closed in `codex/production-readiness-p1` batch 5. All known `.skip` calls under `server`, `client`, and `e2e` have been removed. Budget race tests now expect controlled 400/409 conflicts instead of tolerating 500s; recurring DB/route skips now pass against current contracts; rate-limit tests now assert deterministic route middleware wiring because limiters intentionally bypass live throttling in `NODE_ENV=test`; account archive unit tests now match the TOCTOU-safe repository contract and mock audit writes explicitly.

**Files:**
- `server/modules/budgets/__tests__/budgets.integration.test.ts`
- `server/routes/__tests__/recurring.integration.test.ts`
- `server/modules/weekly-recap/__tests__/weekly-recap.integration.test.ts`
- `server/modules/rules/__tests__/rules.integration.test.ts`
- `server/modules/recurring/__tests__/recurring.db.integration.test.ts`
- `server/modules/merchants/__tests__/merchants.integration.test.ts`
- `server/services/__tests__/accountService.test.ts`

**Audit Requirement:** Security, rate-limit, audit, and race tests must not remain skipped.

**Implementation:**
1. Unskip one test at a time.
2. Run it and classify as stale test vs product bug.
3. Fix product bugs or update stale assertions to current contracts.
4. Leave no unexplained `.skip`.

**Verification:**
- `rg -n "\.skip\(|describe\.skip|it\.skip|test\.skip" server client e2e -g "*.ts" -g "*.tsx"` returns no matches.
- Focused suites passing: budget integration, recurring route integration, recurring DB integration, weekly recap/rules/merchants integration, and account service unit tests.

---

### Task 10: P1 Coverage Thresholds

**Status:** Closed in `codex/production-readiness-p1` batch 6. Client and server Vitest coverage now enforce V8 thresholds against financial and core folders. The thresholds are baseline-based, pass on current coverage, and are scoped to fail meaningful regressions without forcing legacy low-coverage shared UI folders into the first gate.

**Files:**
- Modify: `client/vitest.config.ts`
- Modify: `server/vitest.config.ts`
- Test fix: `server/repositories/__tests__/transactionRepository.test.ts`

**Audit Requirement:** Coverage thresholds must be enforced, especially around financial folders.

**Implementation:**
1. Generate current coverage baseline.
2. Add realistic thresholds that pass today but fail on meaningful regression.
3. Include financial folders incrementally.

**Verification:**
- `npm run test:coverage:server` passed with server coverage at 62.32% statements / 47.12% branches / 63.47% functions / 62.99% lines.
- `npx vitest run --coverage --config client/vitest.config.ts --reporter=dot --silent` passed 108 client test files / 1033 tests, with client coverage at 43.79% statements / 39.59% branches / 39.32% functions / 44.04% lines.
- `npm run check` passed.
- `npm run build` passed.

---

### Task 11: P1 Filter Preset Default Atomicity

**Status:** Closed in `codex/production-readiness-p1` batch 7. Filter preset defaults are now enforced by a partial unique index on `(household_id, user_id, context) WHERE is_default = true`. Default create/update paths now run the clear-and-set sequence inside one transaction and take a scope-level advisory lock so concurrent default changes serialize cleanly instead of leaving duplicate defaults or surfacing raw database errors.

**Files:**
- Modify: `server/modules/filter-presets/filter-presets.service.ts`
- Modify: `shared/schema.ts`
- Create migration under `migrations/`
- Test: real-DB filter preset tests

**Audit Requirement:** Setting one default preset must be atomic and database-enforced.

**Implementation:**
1. Add failing concurrent/default tests.
2. Add a partial unique index for `(household_id, user_id, context) WHERE is_default = true`, or an equivalent scoped invariant.
3. Wrap clear-and-set operations in one transaction.

**Verification:**
- `cd server && npx vitest run modules/filter-presets/__tests__/filter-presets.default-atomicity.db.integration.test.ts --reporter=dot` passed 3 real-DB tests.
- `npm run check` passed.
- `npx drizzle-kit check` passed.
- `npm run build` passed.

---

### Task 12: UX and Lower-Priority Hardening

**Status:** Closed in `codex/production-readiness-p1` batch 8. Launch UX hardening now uses theme-token CTA buttons in the targeted account/dashboard/investment/cash-flow command paths, route-level error boundaries reset on navigation, shared dialogs have mobile viewport constraints, cash-flow/report chart fallbacks use CSS-variable chart tokens, weekly recap no longer ships `framer-motion`, and startup font loading is reduced to two non-blocking font families.

**Files:**
- CTA tokens: `client/src/pages/Accounts.tsx`, `client/src/pages/Dashboard.tsx`, `client/src/pages/Investments.tsx`, account import modals, weekly recap components.
- Bundle/framer-motion: `package.json`, `client/src/components/weekly-recap/**`, Vite build config if adding budgets.
- Fonts: `client/index.html`, theme CSS.
- Chart palettes: reports/cashflow chart components.
- Error boundaries: route composition under `client/src/App.tsx` and route wrappers.
- Responsive modals: dialog/modal components and feature modal callsites.

**Audit Requirement:** Bring launch UX closer to production polish: tokenized CTAs, theme-aware charts, controlled bundles, fewer render-blocking fonts, route-level recovery, and mobile-safe dialogs.

**Implementation:**
1. Start with tokenized CTAs and hardcoded orange command buttons.
2. Add route-level error boundaries.
3. Remove or lazy-load framer-motion-heavy weekly recap pieces.
4. Consolidate font families.
5. Add responsive modal width constraints.

**Verification:**
- `npm run check` passed.
- `npx vitest run client/src/components/weekly-recap/__tests__/WeeklyRecapWizard.test.tsx client/src/features/cashflow/__tests__/CashFlowComponents.test.tsx client/src/features/accounts/__tests__/AccountDetailComponents.test.tsx --config client/vitest.config.ts --reporter=dot` passed 3 files / 10 tests.
- `npm run build` passed and no `motion` chunk was emitted.
- `npx vitest run --config client/vitest.config.ts --reporter=dot --silent` passed 108 client test files / 1033 tests.

---

## Overall Verification Gates

Run at P0 close:

```bash
npm run deploy:verify
npm run check
cd server && npx vitest run config/__tests__/redis-infra.test.ts ../server/__tests__/scheduler.lock.test.ts
cd ..
npm run build
npm run test:e2e:smoke
```

Run before final merge/claim:

```bash
npm run check
npm run test:server:run
npm run test:run
npm run build
npm run deploy:verify
npm run test:e2e:smoke
```
