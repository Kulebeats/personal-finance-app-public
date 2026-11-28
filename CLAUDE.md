# CLAUDE.md — Personal Finance App

Full-stack personal finance app: React 18 + TypeScript frontend, Express + PostgreSQL
backend. Session-based auth, household collaboration, transaction tracking, budgets, goals,
investments, including GRZ (Government of the Republic of Zambia) sovereign-debt instruments
(bonds, T-bills, coupons, withholding tax).

Last verified against `main`: 2026-11-23. The rules below are durable; status lines go stale.
Treat any completion claim, in this file, in `docs/` or in a transcript, as an unverified
hypothesis until it is proven against code and a green CI run (Verification Rule 5).

## Current state (2026-11-23)

- **Not production-ready.** Requirements live in the register; per-row status is in the
  dated re-check reports and on the board (see "Where status lives"), not in this file.
- **Where work happens.** The public repository `Kulebeats/personal-finance-app-public`. The
  earlier private repository is frozen since the 23 Nov 2026 cutover: open nothing against
  it. In the owner's checkout the public repository is the git remote `public` and `origin`
  is the frozen one, so branch from `public/main` and push to `public`.
- **Everything committed is world-readable.** Commit as author and committer
  `Kulebeats <209983880+Kulebeats@users.noreply.github.com>`; check `git config user.email`
  before the first commit. Keep personal e-mail addresses, the operating-system user name,
  the staging server's address and hostname, and secrets out of diffs, commit messages, PR
  titles and PR bodies. Scan all of them before every push.
- **Pull requests.** One branch per task, cut from `main`; one PR straight into `main`,
  opened READY. A draft gains nothing: every PR into `main` runs the full CI either way, and
  marking it ready starts the run again. `main` is protected: the `verify` and `e2e` checks
  must pass, the rule binds admins, and force-push and deletion are blocked. A coordinator
  session reviews each PR once and merges it on green. Builder ("lane") sessions never merge
  and never push to `main`.
- **Where status lives.** Process and day-to-day status: the coordinator's board. It is local
  to the owner's checkout and untracked, at
  `$(git rev-parse --git-common-dir)/coordinator/goal-safe-to-trust.md`. Codex is reached
  through the board. Requirements: `docs/reviews/2026-10-15-unified-completion-spec/`
  (`FINAL_COMPLETION_SPEC.md`, `REGISTER.csv`, `REVIEW_PROTOCOL.md`). The register lists the
  requirements; its status column is not maintained. Per-row status is in the dated
  re-check and morning reports (`REGISTER-RECHECK-<date>.md`, `MORNING-<date>.md`), which
  also sit untracked in the owner's main checkout, under that folder's `reviews/`, and are
  not in this repository.
- **Staging.** An Oracle Cloud VM runs the application on a two-week soak that started
  23 Nov 2026, with outbound mail through Brevo SMTP. Staging changes only on the owner's
  typed go, and only through the dedicated `safe-test-site` session. The production host is
  decided after the soak.
- **Owner decisions of 23 Nov 2026 (settled; build to them).** MFA is mandatory after a
  14-day grace period. Securities are an operator-curated catalogue plus household-private
  custom securities. Runtimes are Node 24 and Postgres 18. The weekly recap is sent on each
  user's chosen day, in household time. Rate limits are 600/min per user and 10/min per IP
  for credential attempts.
- **History.** The January 2026 "100%" and "COMPLETE" claims, and the P4 refactor's
  verification claims, were refuted against code by the independent audit of 2026-06-04
  (`docs/reviews/production-readiness-audit-2026-06-04.md`: 213/213 "fixed" was untrue, 0 of
  22 modules ready). That is why the rules below are enforced by tooling. The P4 plan is
  `docs/architecture/implementation-plan-p4-refactor-cutover-audit.md`; the pre-audit text of
  this file is `CLAUDE.md.pre-audit.bak`; later versions are in git history.

## Enforcement (what the tooling blocks)

The June audit's root finding was that stated discipline failed at scale, so the highest-risk
rules are enforced. Each guard has a narrower reach than its rule; the rule binds everywhere.

- **`.claude/hooks/block-money-floats.mjs`** (PreToolUse on Write/Edit). Blocks `parseFloat(`,
  `.toFixed(`, `Number(` around an amount, and amount-times-rate arithmetic on code lines, in
  files whose path contains, in any letter case, `server/services`, `server/routes/grz`,
  `core/calculations`, `currency`, `budget` or `money`. It does not match `Math.round(` and
  does not cover most of `server/modules/`.
- **`.claude/hooks/block-any-casts.mjs`** (PreToolUse on Write/Edit). Blocks `as any`, `: any`
  and `@ts-ignore` in every `.ts`/`.tsx` write, test files included.
- **`.claude/hooks/scan-secrets.mjs`** (PreToolUse on Bash). On `git commit`, blocks staged
  content that contains a Google API key (`AIza…`), a PEM private-key header, a
  `GEMINI_API_KEY=` assignment, or `sk-` followed by 20 or more letters and digits. It does
  not match an Anthropic key (`sk-ant-…`) or other secret formats, so read the staged diff
  yourself.
- **`.claude/hooks/stop-gate.mjs`** (Stop). Blocks ending a turn while `npm run check` or the
  `server/core/calculations` tests are red.
- **CI, `.github/workflows/ci.yml`.** On every PR into `main` and every push to `main`: job
  `verify` (dependency audit, runtime, test-target and limiter guards, the static
  deploy-readiness check, `npm run check`, server and client suites with coverage floors
  against a disposable Postgres 18, build, bundle budget), then job `e2e` (Playwright smoke,
  submit-and-read-back, mutation check). Both are required to merge.
  `.github/workflows/ai-eval-gate.yml` runs the AI eval pack when `server/modules/ai/**`
  changes.
- **Adversarial verifier**, `.claude/agents/verifier.md`: run it after any "fixed" claim
  (Verification Rule 5).

A hook or guard refusal is a deliberate blocker. Change the code until it passes. The stop
gate may be switched off only in the way `.claude/settings.json` and `stop-gate.mjs` describe
(`REMEDIATION_GATE=off`, for a deliberate exploratory session). No other hook is ever
bypassed.

---

## Critical Commands (RUN AFTER EVERY CHANGE)

```bash
npm run check              # Runtime pin, TypeScript, storage-import + LOC + tooling guards - MUST PASS before commit
npm run test:run           # Client tests (single run; no database, outbound credentials blanked)
npm run test:server:run    # Server tests (single run; ONLY a declared disposable test target, NEVER finance_app)
npm run db:test:setup      # Bootstrap the declared test target by applying ./migrations
npm run dev                # Backend dev server (Express)
npm run dev:client         # Frontend dev server (Vite port 5000)
npm run db:generate        # drizzle-kit generate: write a versioned migration into ./migrations
npm run db:migrate         # drizzle-kit migrate: apply ./migrations (what a deploy runs)
npm run db:push            # drizzle-kit push: IMPERATIVE diff of shared/schema.ts vs a DB - local dev only
```

> **Tests cannot touch a real database (enforced).** The real-DB suites DELETE users and
> households in cleanup; pointed at the dev database through `.env`, they once destroyed live
> dev data. The database-backed test scripts (`test:server`, `test:server:run`,
> `test:coverage:server`, `test:e2e*`) now run through `scripts/run-protected-tests.mjs`, which never loads `.env`
> and blanks outbound credentials; the client scripts use the same wrapper with the database
> disabled. A database run refuses to start
> (`REFUSING TEST TARGET`) unless `TEST_DATABASE_URL`, `TEST_RUN_ID` and a
> `TEST_TARGET_MANIFEST` name the same loopback database, called `pfa_ci_…_<runId>_test` or
> `pfa_completion_…_<runId>_test`. `DATABASE_URL` is never a fallback. The working recipe is
> the CI step "Declare and bootstrap disposable server test target" in
> `.github/workflows/ci.yml` (`scripts/create-test-target.mjs`, then `npm run db:test:setup`);
> the guard is `server/testing/test-target.mjs`. NEVER aim a test at `finance_app`, staging
> or any shared database. One file:
> `node scripts/run-protected-tests.mjs database vitest --server run <path relative to server/>`.

> **Schema changes ship as versioned migrations.** `./migrations` holds the history
> (`meta/_journal.json`). A deploy applies it with `npm run db:migrate` (`render.yaml`
> `preDeployCommand`), and so does `db:test:setup`. `npm run db:push` does NOT run migrations:
> it diffs `shared/schema.ts` against a database and applies the difference directly, so it
> is for local dev only and never for a deployed database (`docs/runbooks/deploy.md`). By
> lane process (owner-approved working practice, not enforced in code), the coordinator
> assigns migration numbers: ask before you generate one. Check that the new journal entry's
> `when` is higher than every earlier entry, because a migrated database silently skips an
> entry with a lower one. Give long foreign keys explicit names under 63
> characters in `schema.ts` (Postgres truncates identifiers at 63 bytes), or generated
> migrations will churn on every run.

---

## CRITICAL RULES (NEVER BREAK THESE)

### 1. Money/Arithmetic Rule (HIGH RISK)

**NEVER use `parseFloat()`, `Math.round()`, or `Number()` for financial calculations.**
*(Partly enforced: see `block-money-floats.mjs` under Enforcement for what the hook matches.)*

- ✅ USE: `Money` class from `server/core/money.ts` with currency context
- ❌ BAD: `parseFloat(amount)`, `Math.round(x * 100) / 100`
- Currency sources: `goal.currency`, `account.currency`, `transaction.currency`
- Money columns are Postgres `decimal`, returned as STRINGS by the driver; the live danger
  is `parseFloat`/`Number` on a string amount, then arithmetic.

> **GRZ is the highest-risk money path.** `server/services/grz-service.ts`,
> `server/services/grz/` and `server/routes/grz-*.ts` do bond coupon, withholding-tax,
> discount, and yield math, persist it, and create real ledger transactions. The June audit
> found this math in raw `number` + `.toFixed()`; it now runs on `Money` and `Decimal`. Every
> monetary line here must go through `Money`, and every write here must be audited (Rule 9).

> **FX silent fallback.** A missing exchange rate must be a logged, surfaced error, never a
> quiet `rate = 1`, which materially corrupts multi-currency totals. Reports fail closed:
> every aggregate that embeds `buildFxRateExpr` (`server/repositories/reports/fxRateExpr.ts`)
> first calls `assertFxRatesAvailable` (`BaseReportRepository.ts`). Follow that pattern.

**Common Antipatterns Found in Code Reviews (AVOID THESE):**

```typescript
// ❌ ANTIPATTERN 1: Central utility using parseFloat (propagates everywhere)
// Found in: BaseReportRepository.convertAmount - affected ALL 7 report repositories
const numeric = parseFloat(String(amount || "0"));

// ✅ FIX: Use Money class
const money = new Money(String(amount || "0"));

// ❌ ANTIPATTERN 2: Money → number → arithmetic (defeats the purpose)
// Found in: 50+ instances across Goals, Recurring modules
const value = new Money(x).toNumber();
const result = value + otherValue; // Now doing unsafe arithmetic

// ✅ FIX: Keep Money objects through calculations
const money = new Money(x);
const result = money.add(new Money(otherValue));

// ❌ ANTIPATTERN 3: JavaScript aggregation losing precision
// Found in: Reports, Recurring modules
const total = amounts.reduce((sum, a) => sum + parseFloat(a.amount), 0);

// ✅ FIX: Use Money for aggregation
const total = amounts.reduce(
  (sum, a) => sum.add(new Money(a.amount)),
  Money.zero(currency),
);

// ❌ ANTIPATTERN 4: Creating MoneyDto from JavaScript-summed numbers
// Found in: useMerchantFilters.ts
return { amount: sum.toFixed(2), currency: "USD" }; // sum already has precision loss

// ✅ FIX: Keep Money through entire calculation, convert at the end
return toMoneyDto(moneyTotal.toNumber(), household.currency);
```

### 2. LOC Limits

*(Enforced: `node scripts/check-loc-limits.mjs`, wired into `npm run check`.)*

- **Any server production file** (`server/**/*.ts`): **<500 LOC**. This means
  every file — services, controllers, repositories, core, utils — regardless of
  directory. Test files (`*.test.ts`, `__tests__/**`) are exempt.
- **Module routers** (`server/modules/*/*.routes.ts`): **<100 LOC** (Rule 15 —
  they are router glue; handlers belong in the controller).
- Client components (`client/src/**/*.tsx`): **<300 LOC for NEW components**
  - Existing components don't need splitting unless being significantly modified
  - Apply limit when creating new components or major rewrites

> **Lesson (2026-07-20).** This rule once named three directories; the P4
> refactor moved most code out of them and the limit went unenforced across
> most of the server. A rule scoped by directory silently stops applying when
> the directories move. The history is in the header of
> `scripts/check-loc-limits.mjs`.

**The guard is a ratchet, not a cliff.** `scripts/loc-baseline.json` records
every file already over its limit. The build fails when a file **not** in the
baseline exceeds its limit (new debt), or when a **baselined file grows**
(existing debt deepening — this is what caught `ai.service.ts` going 740 → 891
during v1.1 Workstream B). Baselined files may shrink freely; run
`node scripts/check-loc-limits.mjs --update` to lock in the improvement.
Treat the baseline as a debt register to burn down, not a permission slip.

### 3. File Split Patterns

| Type           | Pattern                            | Example                                      |
| -------------- | ---------------------------------- | -------------------------------------------- |
| Route splits   | `{domain}.{subdomain}.ts`          | `settings.profile.ts`                        |
| Service splits | `{Domain}/{subdomain}.ts` + index  | `Goal/crud.ts`                               |
| Client splits  | `{Component}/components/{Sub}.tsx` | `GoalDetailModal/components/OverviewTab.tsx` |

### 4. AI Integration Rule (CRITICAL FOR EXTERNAL AI FEATURES)

> **State of the AI module (`server/modules/ai/`, the "Thandi" assistant).** The provider is
> Anthropic first with Gemini as fallback (`ai.provider-config.ts`, `ai.claude.ts`,
> `ai.gemini.ts`). The four violations the June audit named are fixed; keep them fixed:
> 1. Every tool result passes the central sanitiser, which fails closed when a tool has no
>    sanitiser (`ai.service.ts`, `ai.sanitizer.ts`). No raw DB rows, internal UUIDs or raw
>    account/merchant/goal names go to a provider.
> 2. `data_sanitized` in the audit log comes from the real sanitiser result, never a constant.
> 3. Tool arguments are parsed with the Zod schemas in `ai.validation.ts` before they reach
>    any SQL filter.
> 4. Conversations persist (`ai.conversation.service.ts`, `ai.conversation.repository.ts`).

**WHEN implementing features that use external AI APIs (Anthropic, Google Gemini, OpenAI, etc.):**

#### 4.1 Money Class Requirement

- ✅ **MANDATORY:** All financial amounts returned from AI tools MUST use `Money` class
- ✅ **Currency context:** Always pass household currency to AI analytics functions
- ❌ **NEVER:** Return raw numbers like `{ amount: 1234.56 }` from AI tools

```typescript
// ❌ BAD - Raw numbers
async function getSpending() {
  return { category: "Food", amount: 1250.0 };
}

// ✅ GOOD - Money class
async function getSpending(currency: string) {
  const result = await db.query(/* ... */);
  return { category: "Food", amount: Money.from(result.amount, currency) };
}
```

#### 4.2 Audit Logging Requirement

- ✅ **MANDATORY:** Log ALL AI queries to `audit_logs` table using `BusinessAuditService`
- ✅ **Include:** query text, tools executed, response summary, token count
- ✅ **Purpose:** Regulatory compliance (Zambia DPA), security monitoring

```typescript
await auditService.log({
  householdId: req.user!.householdId,
  userId: req.user!.id,
  action: "CREATE",
  entityType: "ai_query",
  entityId: conversationId,
  details: { query: userMessage, tools_used: toolCalls.map((t) => t.name),
    response_summary: reply.substring(0, 200), token_count: tokenCount },
  ipAddress: req.ip,
});
```

#### 4.3 Module Structure Requirement

- ✅ **MUST follow:** Modular pattern in `server/modules/ai/` (controller, service, analytics,
  validation, middleware, types). ❌ **NEVER:** a single monolithic `routes/ai.ts`.

```text
server/modules/ai/
├── ai.routes.ts              # <100 LOC
├── ai.controller.ts          # <500 LOC
├── ai.service.ts             # <500 LOC
├── ai.analytics.service.ts   # <300 LOC
├── ai.validation.ts          # <150 LOC
├── ai.middleware.ts          # <150 LOC
├── ai.types.ts               # <200 LOC
└── __tests__/
```

The module has since grown to about 45 files around this core. Four of them are over their
limit and sit in the LOC baseline as debt (Rule 2): `ai.service.ts`,
`ai.analytics.service.ts`, `ai.gemini.ts`, `ai.sanitizer.ts`.

#### 4.4 Security Requirements

- ✅ **Rate limiting:** per-household (not per-user). The chat quota (50 per rolling 24 hours)
  is a durable Postgres admission ledger (`ai_requests`, `ai.admission.repository.ts`), so it
  holds across instances.
- ✅ **Consent:** check `households.ai_consent_given` before processing
- ✅ **Data minimization:** top 20 results, summaries only
- ✅ **No PII:** strip PII before sending to AI (the central sanitiser; every tool must have one)
- ✅ **API keys:** environment variables, rotate every 90 days

#### 4.5 Type Safety Requirements

- ❌ **NEVER use `any`** in AI tool definitions (enforced by hook; see Rule 16)
- ✅ **Define proper types** for all tool parameters and return values
- ✅ **Use Zod** for request validation (and actually import the schemas; see point 3 above)

#### 4.6 Error Handling Requirements

- ✅ **Use the error classes** in `server/core/errors` (base `HttpError`; see Rule 7) for
  AI-specific errors; handle external API failures with retries; return clear errors for
  rate limits, consent issues, API outages.

#### 4.7 Testing Requirements

- ✅ **Unit tests:** >80% coverage for AI modules
- ✅ **Integration tests:** rate limiting, consent flow, tool execution (real, not mocked)
- ✅ **Money class verification:** assert all amounts use Money class

**Quick Validation Checklist:** currency via Money; audit logging; modular <500 LOC;
per-household rate limit; consent middleware; no `any`; Zod validation actually imported;
sanitiser on ALL tools; `data_sanitized` from real result; tests >80%.

### 5. Controller Pattern Rules

Controllers are thin HTTP layers: **Request → Validation → Service → Response**

```typescript
export async function handler(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const result = schema.safeParse(req.body);
  if (!result.success) throw new ValidationError("Invalid data", result.error.errors);
  const data = await service.method(householdId, userId, result.data);
  success(res, mapToDto(data));
}
```

- ❌ NO direct database access in controllers
- ❌ NO business logic in controllers
- ✅ Always use `req.householdContext!` for auth context
- ✅ Always validate with Zod `.safeParse()`
- ✅ Always map Money to MoneyDto before response

### 6. Response Format Rules (V7 Envelope)

```typescript
{ success: true, data: T, meta?: {...} }
{ success: false, error: { code: string, message: string, details?: any } }
```

Helpers from `server/core/http`: `success(res, data)`, `created(res, data)`, `noContent(res)`,
`paginated(res, data, { total, page, pageSize })`.
Pagination: `{ success: true, data: [...], pagination: { total, page, pageSize, totalPages, hasNext, hasPrev } }`.

### 7. Error Handling Rules

Use error classes from `server/core/errors`: `ValidationError` 400, `NotFoundError` 404,
`UnauthorizedError` 401, `ForbiddenError` 403, `ConflictError` 409, `RateLimitError` 429.

```typescript
// ❌ BAD
if (!budget) { res.status(404).json({ error: "Not found" }); return; }
// ✅ GOOD
if (!budget) { throw new NotFoundError("Budget not found"); }
```

### 8. Validation Rules

Location `{module}.validation.ts`. Use `positiveMoneyDtoSchema` for amounts; export inferred
types; use `.transform()` for DTO conversion; `.superRefine()` for cross-field validation.

**Date Validation (regex is NOT enough):**

```typescript
// ❌ BAD: regex-only accepts "2025-02-30"
date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
// ✅ GOOD: validate format AND that the date actually exists
const validDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(s + "T00:00:00Z");
    if (isNaN(d.getTime())) return false;
    const [y, m, day] = s.split("-").map(Number);
    return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m && d.getUTCDate() === day;
  }, { message: "Invalid date - the date does not exist" });
```

### 9. Audit Logging Rules (EXPANDED)

**ALL financial CRUD operations MUST be logged** (`businessAuditService.logCreate/logUpdate/
logDelete`, or `.log()` with action `TRANSFER`/`LINK`). Entity types: `transaction`, `budget`,
`goal`, `account`, `recurring_rule`, `holding`, `goal_transfer`, `goal_assignment`.

```typescript
await businessAuditService.logCreate({
  householdId, userId, entityType: "budget", entityId: budget.id,
  details: { name: budget.name, amount: budget.amount },
  ipAddress: businessAuditService.getIpAddress(req),
});
```

> **Where the audit call goes.** Put it in the service/repository layer, inside the same
> transaction as the write (every `businessAuditService` method takes an optional `tx`), so
> callers that bypass a controller are still logged. The June audit found three paths with no
> audit row: **GRZ bond/T-bill/coupon writes**, **reports CSV export** of financial+PII data,
> and the **weekly-recap email**. All three now write one. The weekly recap also needs a
> per-user consent gate before egress; today it is withheld without the household's consent
> or when the user's e-mail preference is off (`weekly-recap.email.service.ts`). A new write
> path or a new egress of financial data needs the same.

### 10. Database Transaction Rules

Use `withTransaction()` for atomic operations. *(Enforced direction: the verifier checks
multi-table writes for `withTransaction`; balance/owner/role paths for `FOR UPDATE`.)*

```typescript
import { withTransaction } from "../utils/withTransaction";
const result = await withTransaction(async (tx) => {
  const [budget] = await tx.insert(budgets).values(data).returning();
  await tx.update(accounts).set({ /* ... */ }).where(/* ... */);
  return budget;
}); // Auto-rollback on any error
```

**FOR UPDATE Locks (CRITICAL for race conditions):**

```typescript
// ❌ BAD: read outside txn, then write (race)
const existing = await findDuplicate(goalId, transactionId);
if (existing) throw new ConflictError("Already linked");
await tx.insert(links).values(data);

// ✅ GOOD: lock the row inside the txn before checking
return await withTransaction(async (tx) => {
  const [goal] = await tx.select().from(goals).where(eq(goals.id, goalId))
    .for("update").limit(1);
  const [existing] = await tx.select().from(links)
    .where(and(eq(links.goalId, goalId), eq(links.transactionId, transactionId)))
    .for("update");
  if (existing) throw new ConflictError("Already linked");
  await tx.insert(links).values(data);
});
```

**When to use FOR UPDATE:** uniqueness checks before insert; balance checks before deduction
(overdraft races); assignment validation; any read-then-write on the same row.

> **Reference implementations.** The June audit found the transfer path with no `FOR UPDATE`,
> no overdraft guard, and idempotency checked outside the transaction. It now locks, guards
> and re-checks the key inside the transaction (`server/services/TransferService.ts`,
> `server/repositories/TransactionTransferRepository.ts`); `transactions.idempotencyKey` is
> unique at schema level. Ownership transfer (`server/modules/household/ownership.service.ts`)
> and invite acceptance (`invitations.accept.ts`) are atomic too. The audit also named the
> recurring batch and default-toggle paths as non-atomic; this refresh did not re-verify
> those, so check them before you build on them. Optimistic locking exists via
> `budgetPeriods.version`; use it on the recalc path.

### 11. Privacy & Visibility Rules

```typescript
async findByIdWithVisibility(id, householdId, userId) {
  const item = await this.findById(id, householdId);
  if (!item) return undefined;
  if (item.isPrivate && item.ownerUserId !== userId) return undefined;
  return item;
}
```

- ✅ Private items only visible to owner; return `undefined` (not error) for invisible items
- ✅ Always scope queries by `householdId`

**Cross-entity linking MUST check visibility** (Receipt→Transaction, Recurring→Transaction,
Goal→Transaction). Use `findByIdWithVisibility`, never `findById`.

> **Why it matters:** the June audit found `dryRunRule` using `findById`, so a member could
> dry-run a rule against another member's private transaction and read its
> name/amount/category. It now uses `findByIdWithVisibility` (`server/services/rule/service.ts`).
> Any new read on behalf of a member needs the same check.

### 12. Rate Limiting Rules

**ALL routes MUST have rate limiting.** Tiers (`server/middleware/rateLimit.ts`):
`generalLimiter` 600/min per user, `analyticsLimiter` 120/min per user (owner, 28 Nov 2026), `authLimiter` 10/min,
`ipAuthLimiter` 10/min per IP (credential attempts), `strictLimiter` 5/min, `uploadLimiter`
20/hour, `expensiveAnalyticsLimiter` 10/min.

```typescript
router.use(generalLimiter);
router.get("/detect", analyticsLimiter, controller.detect);
router.get("/sankey", expensiveAnalyticsLimiter, controller.getSankey);
```

> **Store.** Build every limiter with `createLimiter` in that file: it wires in the shared
> Redis store, so limits hold across instances. The in-memory store is a dev/test fallback
> only; production startup requires Redis (`server/utils/validateEnv.ts`). CI runs
> `npm run test:limiters`, which registers the real routes; a new import that `server/routes.ts`
> calls at load needs a stub in `scripts/__tests__/limiters.test.mjs`.

### 13. Caching Rules

Use `withCache()` (`server/core/cache`) for expensive operations. TTL presets: `SHORT` 30s,
`MEDIUM` 5m, `LONG` 30m, `HOUR` 1h. The store is Redis when configured and in-memory
otherwise, so never rely on in-memory state being shared between instances.

### 14. Event Publishing Rules

Use `outboxEventService.publish({ eventType, aggregateType, aggregateId, householdId, payload }, tx)`
with a minimal payload (IDs + changed fields). Inside `withTransaction`, pass the caller's
`tx` so the event commits or rolls back with the write. With no surrounding transaction,
publish non-blocking with `.catch()`.

### 15. Module Structure Rules

```
server/modules/{domain}/
├── {domain}.controller.ts   # HTTP handlers (<500 LOC)
├── {domain}.service.ts      # Business logic (or re-export)
├── {domain}.routes.ts       # Express router (<100 LOC)
├── {domain}.validation.ts   # Zod schemas
├── {domain}.helpers.ts      # DTO mappers
├── {domain}.types.ts        # TypeScript interfaces
├── index.ts                 # Barrel exports
└── __tests__/               # Unit tests
```

### 16. Type Safety Rules (ZERO `as any` in Production Code)

**NEVER use `as any` in production code.** *(Enforced: a PreToolUse hook blocks `as any`,
`: any`, and `@ts-ignore` in every `.ts`/`.tsx` write, with no exemption for test files or
workarounds.)* Use Zod-inferred types, import proper library and domain types. Acceptable
only in test files and documented third-party workarounds; NEVER for financial data or API
request/response types.

### 17. Test Coverage Requirements

Minimum: financial operations 80%, reports/analytics 60%, UI 50%. Per endpoint, test: happy
path, validation failure (400), not found (404), authorization (403/404), privacy (private
items invisible to other users).

> **What CI gates.** The `verify` job runs both suites with `--coverage`, which arms the
> thresholds in `server/vitest.config.ts` and `client/vitest.config.ts`. Those are regression
> floors set at measured coverage, lower than the minimums above; they do not replace them.
> Goals and Transactions now have real-DB suites (`*.realdb.integration.test.ts`) and the
> client coverage config includes the financial feature folders; the June audit found
> neither. "Integration" must mean a real HTTP request against real Postgres.

### 18. Client-Server Contract Rules

Types must match between client and server. Use shared types; `MoneyDto` consistently (not
sometimes string, sometimes object); nullable fields marked `?` on both sides; endpoint paths
match between client API calls and server routes.

---

## Architecture Quick Reference

```text
client/src/          # React 18 + TypeScript frontend
  ├── features/      # Feature modules (accounts/, budget/, goals/, investments/, settings/, ...)
  ├── pages/         # Page components
  └── components/    # Shared UI (Radix UI + Tailwind)
server/
  ├── modules/       # Modular routes (controller + validation + routes), one folder per domain
  ├── routes/        # Non-modular endpoints: GRZ, investment-*, security/MFA, admin, cron, import
  ├── services/      # Business logic layer (split into submodules)
  ├── repositories/  # Data access (Drizzle ORM); new data access goes here
  ├── core/          # Money class, calculations, errors, http, validation, cache, events
  ├── jobs/          # Scheduled workers (run under server/scheduler.ts)
  ├── testing/       # Test-target guard and test bootstrap
  └── storage.ts     # Legacy data access, frozen: `npm run check` fails on any new import of it
shared/schema.ts     # Database schema + Zod validators (single source of truth)
migrations/          # Versioned Drizzle migrations (see Critical Commands)
```

**Tech Stack:** React 18, Express, PostgreSQL 18, Drizzle ORM, Passport.js sessions, Redis
(rate limits and cache), TanStack Query, Vitest, Playwright. Node is pinned to 24.22.0
(`engines` in `package.json`, `.nvmrc`).

**Schema anchors (use these exact names; do not invent identifiers):** DPA audit →
`auditLogs(userId, householdId, action, entityType, entityId, details, ipAddress)`; auth/security
events → `securityAuditLogs`; AI/recap consent → `households.aiConsentGiven/aiConsentDate/
aiConsentVersion`; idempotency (unique) → `transactions.idempotencyKey`, `pendingReceipts.
idempotencyKey`; optimistic locking → `budgetPeriods.version`; export records → `dataExports`
(`parameters` jsonb).

---

## Error Handling & Debugging

- All async operations need try/catch; log errors with context (don't swallow); use the error
  classes in `server/core/errors` (base `HttpError`, Rule 7); return appropriate HTTP status
  codes.
- Debugging: check `audit_logs` for financial writes; verify currency context in Money usage;
  run `npm run dev:client` + `npm run dev` in parallel; `DEBUG=express:*` for route debugging.

---

## Coding Rules

**Before you code:** propose a plan in bullets and wait for "OK"; read existing code first;
keep solutions minimal (no over-engineering or unrequested refactors).

**Implementation:** small diffs, one concern per change; add/modify tests for changed logic;
no direct DB access in controllers; all financial writes call `BusinessAuditService`; avoid
`any`, use Zod-inferred types.

**Accessibility:** label all form controls; keyboard navigation required; WCAG 2.1 AA.

---

## Git & Code Review

Conventional commits with co-author, under the commit identity and PR flow in Current state.
PRs include: summary and rationale, screenshots for UI, test coverage notes, breaking changes
highlighted. Before committing: `npm run check`, `npm run test:run`, `npm run test:server:run`
must pass. The server suite needs a declared test target (Critical Commands).

---

## Verification Workflow (Use After Every Change)

1. `npm run check`: the type check plus the storage-import, LOC and tooling guards. The LOC
   guard reports any file over its limit, so no manual line count is needed after a split.
2. The affected tests: `npm run test:run` (client), `npm run test:server:run` (server).

---

## Verification Rules (NEVER SKIP THESE)

**Context:** These rules exist because incomplete verification leads to "done" claims for
partial fixes. The 2026-06-04 audit is the proof: 213/213 were claimed fixed and it was untrue.
Follow these rigorously. They are now backed by enforcement (hooks, the verifier subagent, and
CI) rather than memory alone.

### 1. End-to-End Tracing Rule

Before marking ANY data flow fix "done", trace and document the complete path:

```text
UI Component → Hook → API call → Controller → Service → Repository → DB
UI Component ← Hook ← Response ← Controller ← Service ← Repository ← DB
```

Example - "Fixed filter not working": list each file:line you verified, all points confirmed.

### 2. Multi-Location Pattern Rule

When fixing a pattern (e.g. `parseFloat()`): grep for ALL occurrences, list every file and
line, fix ALL of them, then grep again to confirm zero matches remain.

```text
❌ BAD: "Fixed parseFloat in TransferService.ts"
✅ GOOD: "Found parseFloat in 4 locations: TransferService.ts:115/123, 
  TransactionRepository.ts:526/635 → all FIXED. Grep: `grep -rn parseFloat server/` → 0 matches."
```

### 3. Partial Completion Honesty Rule

Use explicit status labels: ✅ DONE (fully complete, verified end-to-end), ⚠️ PARTIAL (gaps
remain), ❌ NOT STARTED (only researched/planned), 🔍 NEEDS VERIFICATION (code exists, untested).

### 4. Grep Before Claiming Done

```bash
grep -rn "parseFloat\|Math\.round\|\.toNumber()" server/ --include="*.ts"
```

**If grep finds matches, the fix is NOT complete.**

### 5. Previous Session Audit Rule

When continuing from a previous session that claims completion: do not trust the claim; read
the actual files; run grep; update status honestly. **This rule is operationalised by the
adversarial verifier subagent and by CI - a claim is only "done" once the relevant suite is
green in CI on the branch, not when the transcript says so.**

### 6. UI Feature Verification Rule

For UI features, provide explicit, reproducible test steps and report which step fails.

### Quick Verification Checklist (Definition of Done)

Before marking ANY fix as done:

- [ ] Traced full data path (UI → API → DB → Response → UI)
- [ ] Ran grep to find ALL occurrences; fixed ALL; grep confirms zero remain
- [ ] A test exercises the change; for data paths, a REAL-DB integration test (not mocked)
- [ ] `npm run check` clean (no new `as any`; no float money in financial paths)
- [ ] **The relevant suite is green in CI on the branch** (the `verify` and `e2e` checks on
      the PR's newest commit, not an earlier one)
- [ ] If the change writes financial data: a `BusinessAuditService` row is written and a test
      asserts the `auditLogs` row
- [ ] If the change touches more than one table/row: it is inside `withTransaction`, with
      `FOR UPDATE` on balance/owner/role paths
- [ ] Used the correct status label (✅/⚠️/❌/🔍)

---

## Documentation Index

- **Requirements and review protocol:** `docs/reviews/2026-10-15-unified-completion-spec/`
  (see Current state)
- **Architecture:** `docs/architecture/implementation-plan-p4-refactor-cutover-audit.md`
- **Setup:** `docs/setup/database-setup.md`, `docs/setup/developer-onboarding.md`
- **Deploy and migrations:** `docs/runbooks/deploy.md`
- **Schema:** `shared/schema.ts` (database + Zod validators)
- **Independent audit (June 2026):** `docs/reviews/production-readiness-audit-2026-06-04.md`

> **Source-of-truth note.** `docs/issues/known-issues.md`, `docs/reviews/open-issues-summary.md`,
> and `docs/security/risk-register.md` assert resolved items that the 2026-06-04 audit refuted
> against code, and the January 2026 module scores in older docs do not agree with each other.
> Treat them as historical; live status is where Current state says. Do not edit these files
> to mark a fix done, and do not count `parseFloat → Number()` as a remediation.

### Code Review Skills (Slash Commands)

`/review-code` (Senior Developer), `/review-qa` (QA Engineer), `/review-fintech` (Compliance),
`/review-functionality` (Product Manager), `/review-ux` (UI/UX and accessibility), `/verify`
(the verification suite), all in `.claude/commands/`. These pair with the domain subagents in
`.claude/agents/` (fintech-money, concurrency, dpa-compliance, infra-deploy, test-builder) and
the verifier.

### AI Assistant Feature Documentation

- **Specifications:** `docs/ai-integration/specifications/`
- **Code Audit (historical):** `docs/reviews/ai-assistant-code-audit.md`
- **BRD:** `docs/specifications/ai-assistant-brd.md`
- **User Stories:** `docs/specifications/ai-assistant-user-stories.md`
- **Technical Design:** `docs/architecture/ai-assistant-technical-design.md`

---

## Prompts for Claude (YOU - Follow These)

**Starting work:** research first (read relevant files); use plan mode for multi-file tasks;
use `docs/` context before asking. **During implementation:** incremental changes; run
`npm run check` after each edit; report status in the PR (not the status docs). **Before
finishing:** run the full suite + type check; check LOC limits; confirm CI is green on the
branch before claiming done. **Communication:** concise; no over-explanation; link to files as
`[file.ts:123](server/index-dev.ts#L123)`; report blockers with what you tried and why it failed.
