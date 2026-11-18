# CLAUDE.md — Personal Finance App (v1.6)

> **STATUS SUPERSEDED — 2026-06-04.** An independent multi-agent code audit (14 module
> audits + adversarial verification + full build/test/typecheck runs) supersedes the
> completion claims in this file. The application is **NOT production-ready**: average
> verified score ~65/100, **0 of 22 modules production-ready**, with P0 blockers across
> deployment, security, financial integrity (GRZ Money + audit logging), external-AI PII,
> and an ungated, partly-fictional test safety net. The "100%" and "COMPLETE" claims below
> are retained as history but were refuted against code. **Live remediation status lives in
> Linear, not in this file and not in `docs/`.** This is exactly what Rule 5 (Previous
> Session Audit Rule) already demands: treat any completion claim as an unverified
> hypothesis until proven against code and a passing test in CI.

Full-stack personal finance app: React 18 + TypeScript frontend, Express + PostgreSQL
backend. Session-based auth, household collaboration, transaction tracking, budgets, goals,
investments, including GRZ (Government of the Republic of Zambia) sovereign-debt instruments
(bonds, T-bills, coupons, withholding tax).

Last updated: 2026-06-04 (audit supersession). The prior header asserted "QA Score: 100%" on
2026-01-29; that claim is false and is retained only for the record.

**Enforcement (NEW).** The rules below are no longer honour-system only. The remediation
scaffold enforces the highest-risk ones at the system level, because the audit's root finding
is that stated discipline failed at scale (213/213 claimed fixed, untrue):
- Rule 1 (no float money) and Rule 16 (no `as any`) are enforced by a PreToolUse hook that
  blocks the write before it lands.
- The Definition of Done is enforced by a Stop hook that blocks ending a turn while
  `npm run check` or the core tests are red.
- Rule 5 (do not trust completion claims) is operationalised by an adversarial verifier
  subagent and by CI. **CI does not exist yet; standing it up is the P0 keystone.**

**Version history:** v1.6 audit supersession + enforcement layer. v1.5 AI assistant doc
alignment. v1.4 Auth overhaul (91/100, claimed). v1.3 module-review lessons (rules 16-18).

---

## Critical Commands (RUN AFTER EVERY CHANGE)

```bash
npm run check              # TypeScript + no-storage-imports guard - MUST PASS before commit
npm run test:run           # Client tests (single run)
npm run test:server:run    # Server tests (single run; auto-uses <dbname>_test, NEVER finance_app)
npm run db:test:setup      # Create the dedicated test DB + push schema (run once)
npm run dev                # Backend dev server (Express)
npm run dev:client         # Frontend dev server (Vite port 5000)
npm run db:push            # drizzle-kit push: IMPERATIVE diff of shared/schema.ts vs the live DB
```

> **Server tests can no longer touch your dev database (enforced 2026-07-20).**
> `server/vitest.config.ts` loads `.env`, so `DATABASE_URL` used to point the suite at the
> DEV database — and the real-DB suites DELETE users/households in cleanup. That destroyed
> live dev data (observed: a fixture vanished mid-session, a working login started 401ing).
> The config now derives `<dbname>_test`, honours `TEST_DATABASE_URL`, and **refuses to run**
> against any database that isn't test-scoped. The "NEVER finance_app" rule is enforced, not
> honour-system. Run `npm run db:test:setup` once to create the database.

> **`npm run db:push` does NOT run versioned migrations.** It diffs `shared/schema.ts`
> against the database and applies changes directly. `./migrations` is inert because
> `drizzle-kit generate` is never run, so there is no migration history. Production must not
> deploy by imperative push. **P1 (DEPLOY-MIGRATE):** adopt `drizzle-kit generate` +
> `migrate` so dev, CI, and prod share one versioned history. Before that, give the long
> foreign keys explicit names under 63 characters in `schema.ts` (Postgres truncates
> identifiers at 63 bytes), or generated migrations will churn on every run.

---

## P4 Enterprise Refactoring — MERGED 2026-01-13 (verification claims later refuted)

**Merged to main:** 2026-01-13 (76 commits, 1312 files changed)
**Plan:** `docs/architecture/implementation-plan-p4-refactor-cutover-audit.md`

> The 2026-06-04 audit checked the verification claims below against code. They did not hold.
> Retained as history; do not treat as current state.

| Component             | Claimed (Jan 2026)   | Verified (2026-06-04)                                                          |
| --------------------- | -------------------- | ------------------------------------------------------------------------------ |
| Module Cutover        | DONE                 | 26 legacy route files deleted (plausible)                                      |
| Feature Flags         | REMOVED              | A dual calculation engine (legacy + new) still runs in parallel                |
| Audit Logging         | DONE, all covered    | REFUTED: GRZ writes, reports CSV export, and weekly-recap email write no audit row |
| Controller Splits     | DONE, all <500 LOC   | REFUTED: `BudgetRepository.ts` is 548 LOC, among others                        |
| Security Verification | PASS, 7/7 P0 items   | REFUTED: `trust proxy` not set in prod, `/uploads` unauthenticated, no DB SSL  |

---

## CRITICAL RULES (NEVER BREAK THESE)

### 1. Money/Arithmetic Rule (HIGH RISK)

**NEVER use `parseFloat()`, `Math.round()`, or `Number()` for financial calculations.**
*(Enforced: a PreToolUse hook blocks these patterns in financial paths.)*

- ✅ USE: `Money` class from `server/core/money.ts` with currency context
- ❌ BAD: `parseFloat(amount)`, `Math.round(x * 100) / 100`
- Currency sources: `goal.currency`, `account.currency`, `transaction.currency`
- Money columns are Postgres `decimal`, returned as STRINGS by the driver; the live danger
  is `parseFloat`/`Number` on a string amount, then arithmetic.

> **GRZ is the highest-risk, never-reviewed money path (audit P0).**
> `server/services/grz-service.ts` does bond coupon, withholding-tax, discount, and yield
> math in raw `number` + `.toFixed()`, persists it, and creates real ledger transactions via
> `server/routes/grz-securities.ts`. This path was never in the "213 fixed" pass. Every
> monetary line here must go through `Money`, and see Rule 9 for its audit-logging gap.

> **FX silent fallback (audit P0/P1).** A missing exchange rate must be a logged, surfaced
> error, never a quiet `rate = 1`. The audit found silent `rate = 1` in
> `BaseReportRepository.ts` and `transaction/queries.ts`, materially corrupting
> multi-currency totals.

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

> **Scope correction (2026-07-20).** This rule previously named only
> `server/routes/`, `server/services/`, and `server/modules/*/controller.ts`.
> The P4 modular refactor moved most code to `server/modules/{domain}/
> {domain}.service.ts`, which that wording never covered, so the limit went
> unenforced across most of the server: a literal-scope audit found 5
> violations where a full sweep found 23 (plus 7 module routers over 100).
> The lesson generalises — a rule scoped by directory silently stops applying
> when the directories move.

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

> **Audit P0 - named violations to fix in the AI module (`server/modules/ai/`):**
> 1. Only 3 of 12 tools route through the sanitiser; the other 9 send raw DB rows (internal
>    UUIDs, raw account/merchant/goal names) `JSON.stringify`'d into the Gemini prompt.
> 2. `ai.service.ts` hardcodes `data_sanitized: true` for ALL queries - a false compliance
>    attestation in the audit log. Set it only from the real sanitiser result.
> 3. The Zod tool-arg schemas in `ai.validation.ts` are dead code (never imported); Gemini
>    tool args are `as`-cast straight into ILIKE/gte/lte SQL filters. Wire them in.
> 4. The conversation endpoints are stubs (list returns `[]`, get returns a hardcoded 404,
>    delete is a no-op), so chat history never persists. The advertised feature is
>    non-functional.

**WHEN implementing features that use external AI APIs (Google Gemini, OpenAI, etc.):**

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

#### 4.4 Security Requirements

- ✅ **Rate limiting:** per-household (not per-user). The audit found this cap is an in-process
  `Map`, so it is not enforced cluster-wide - move to Redis (P1 infra).
- ✅ **Consent:** check `households.ai_consent_given` before processing
- ✅ **Data minimization:** top 20 results, summaries only
- ✅ **No PII:** strip PII before sending to AI (this is the sanitiser that 9 tools bypass)
- ✅ **API keys:** environment variables, rotate every 90 days

#### 4.5 Type Safety Requirements

- ❌ **NEVER use `any`** in AI tool definitions (enforced by hook; see Rule 16)
- ✅ **Define proper types** for all tool parameters and return values
- ✅ **Use Zod** for request validation (and actually import the schemas; see violation 3)

#### 4.6 Error Handling Requirements

- ✅ **Use AppError** for AI-specific errors; handle external API failures with retries;
  return clear errors for rate limits, consent issues, API outages.

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

Helpers from `server/core/http`: `success(res, data)`, `created(res, data)`, `noContent(res)`.
Pagination: `{ success: true, data: [...], pagination: { total, page, pageSize, hasNext, hasPrev } }`.

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

> **Audit gaps the 2026-06-04 audit found (fix these):** auditing currently lives only in the
> transactions *controller*, so paths that bypass it are unlogged - **GRZ bond/T-bill/coupon
> writes**, **reports CSV export** of financial+PII data, and the **weekly-recap email**.
> Move audit calls into the service/repository layer (inside the same transaction) so
> controller-bypassing callers are still logged. The weekly recap also needs a per-user
> consent gate before egress.

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

> **Audit found the transactions/transfer path has NO FOR UPDATE and NO overdraft guard**, and
> idempotency runs outside the transaction. `transactions.idempotencyKey` is already unique at
> schema level, so the fix is to run the check inside the txn, not to add a column. Ownership
> transfer, accept-invite, recurring batch, and default-toggle are also non-atomic. Optimistic
> locking exists via `budgetPeriods.version`; use it on the recalc path.

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

> **Audit found a live leak:** `dryRunRule` uses `findById`, so a member can dry-run a rule
> against another member's private transaction and read its name/amount/category. Use
> `findByIdWithVisibility`.

### 12. Rate Limiting Rules

**ALL routes MUST have rate limiting.** Tiers (`server/middleware/rateLimit.ts`):
`generalLimiter` 100/min, `analyticsLimiter` 30/min, `authLimiter` 10/min, `strictLimiter`
5/min, `uploadLimiter` 20/hour, `expensiveAnalyticsLimiter` 10/min.

```typescript
router.use(generalLimiter);
router.get("/detect", analyticsLimiter, controller.detect);
router.get("/sankey", expensiveAnalyticsLimiter, controller.getSankey);
```

> **Audit P0 infra:** the limiter store is per-process; a Redis store is built but no limiter
> uses it, so limits are bypassable across instances. One Redis integration fixes rate-limit +
> cache + AI cost cap.

### 13. Caching Rules

Use `withCache()` for expensive operations. TTL presets: `SHORT` 30s, `MEDIUM` 5m, `LONG` 30m,
`HOUR` 1h. *(Audit: cache is in-memory only and incoherent across instances - move to Redis.)*

### 14. Event Publishing Rules

Use `outboxEventService.publish({ eventType, aggregateType, aggregateId, householdId, payload })`,
non-blocking with `.catch()`, minimal payload (IDs + changed fields).

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

**NEVER use `as any` in production code.** *(Enforced: a PreToolUse hook blocks new `as any`,
`: any`, and `@ts-ignore` in `.ts`/`.tsx`.)* Use Zod-inferred types, import proper library and
domain types. Acceptable only in test files and documented third-party workarounds; NEVER for
financial data or API request/response types.

### 17. Test Coverage Requirements

Minimum: financial operations 80%, reports/analytics 60%, UI 50%. Per endpoint, test: happy
path, validation failure (400), not found (404), authorization (403/404), privacy (private
items invisible to other users).

> **Audit reality:** counts are healthy but coverage is thin - "integration" tests are mocked,
> Goals and Transactions have zero real-DB HTTP tests, and the client coverage config excludes
> every financial folder. "Integration" must mean a real HTTP request against real Postgres.

### 18. Client-Server Contract Rules

Types must match between client and server. Use shared types; `MoneyDto` consistently (not
sometimes string, sometimes object); nullable fields marked `?` on both sides; endpoint paths
match between client API calls and server routes.

---

## Architecture Quick Reference

```text
client/src/          # React 18 + TypeScript frontend
  ├── features/      # Feature modules (goals/, settings/)
  ├── pages/         # Page components
  └── components/    # Shared UI (Radix UI + Tailwind)
server/
  ├── modules/       # Modular routes (controller + validation + routes)
  ├── routes/        # Auth, security, reports (non-modular endpoints)
  ├── services/      # Business logic layer (split into submodules)
  ├── core/          # Money class, validation, audit logging, events
  └── storage.ts     # Database access (Drizzle ORM)
shared/schema.ts     # Database schema + Zod validators (single source of truth)
```

**Tech Stack:** React 18, Express, PostgreSQL, Drizzle ORM, Passport.js sessions, TanStack
Query, Vitest.

**Schema anchors (use these exact names; do not invent identifiers):** DPA audit →
`auditLogs(userId, householdId, action, entityType, entityId, details, ipAddress)`; auth/security
events → `securityAuditLogs`; AI/recap consent → `households.aiConsentGiven/aiConsentDate/
aiConsentVersion`; idempotency (unique) → `transactions.idempotencyKey`, `pendingReceipts.
idempotencyKey`; optimistic locking → `budgetPeriods.version`; export records → `dataExports`
(`parameters` jsonb).

---

## Error Handling & Debugging

- All async operations need try/catch; log errors with context (don't swallow); use `AppError`
  from `server/core/errors.ts`; return appropriate HTTP status codes.
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

Conventional commits with co-author. PRs include: summary and rationale, screenshots for UI,
test coverage notes, breaking changes highlighted. Before committing: `npm run check`,
`npm run test:run`, `npm run test:server:run` must pass.

---

## Verification Workflow (Use After Every Change)

```bash
# 1. Type check
npm run check
# 2. Run affected tests
npm run test:run              # Client
npm run test:server:run       # Server
# 3. Verify LOC limits (if you split files) - PowerShell on Windows
(Get-Content path/to/file.ts | Measure-Object -Line).Lines
# Cross-platform alternative (works in the desktop app, WSL, CI):
node -e "console.log(require('fs').readFileSync('path/to/file.ts','utf8').split(String.fromCharCode(10)).length)"
```

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
- [ ] **The relevant suite is green in CI on the branch** (CI is the P0 keystone; until it
      exists, this line cannot be satisfied, which is why CI lands first)
- [ ] If the change writes financial data: a `BusinessAuditService` row is written and a test
      asserts the `auditLogs` row
- [ ] If the change touches more than one table/row: it is inside `withTransaction`, with
      `FOR UPDATE` on balance/owner/role paths
- [ ] Used the correct status label (✅/⚠️/❌/🔍)
- [ ] Linear issue moved to Done only after CI is green

---

## Documentation Index

- **Architecture:** `docs/architecture/implementation-plan-p4-refactor-cutover-audit.md`
- **Setup:** `docs/setup/database-quickstart.md`
- **Schema:** `shared/schema.ts` (database + Zod validators)
- **Independent audit (authoritative):** `production-readiness-audit-2026-06-04`

> **Source-of-truth note.** `docs/issues/known-issues.md`, `docs/reviews/open-issues-summary.md`,
> and `docs/risk-register.md` assert resolved items that the 2026-06-04 audit refuted against
> code. Treat them as historical. **Live status is in Linear.** Do not edit these files to mark
> a fix done, and do not count `parseFloat → Number()` as a remediation.

> **Module scores below are Jan-2026 review numbers from a different method than the June audit,
> and they do not even agree with the scores in the summary docs - which is itself the reason to
> keep one source of truth. Superseded by the 2026-06-04 audit (avg ~65/100, 0/22 ready):**
> Auth 91, CashFlow 82, Recurring 72, Goals 68, Receipts 65, Reports 52, Investments 45.

### Code Review Skills (Slash Commands)

`/review-code` (Senior Developer), `/review-qa` (QA Engineer), `/review-fintech` (Compliance),
`/review-functionality` (Product Manager). These pair with the scaffold's domain subagents
(fintech-money, concurrency, dpa-compliance, infra-deploy, test-builder) and the verifier.

### AI Assistant Feature Documentation

- **Code Audit:** `docs/reviews/ai-assistant-code-audit.md` (15/100 for external code)
- **BRD:** `docs/specifications/ai-assistant-brd.md`
- **User Stories:** `docs/specifications/ai-assistant-user-stories.md`
- **Technical Design:** `docs/architecture/ai-assistant-technical-design.md`

---

## Prompts for Claude (YOU - Follow These)

**Starting work:** research first (read relevant files); use plan mode for multi-file tasks;
use `docs/` context before asking. **During implementation:** incremental changes; run
`npm run check` after each edit; update the Linear issue (not the status docs). **Before
finishing:** run the full suite + type check; check LOC limits; confirm CI is green on the
branch before claiming done. **Communication:** concise; no over-explanation; link to files as
`[file.ts:123](server/index-dev.ts#L123)`; report blockers with what you tried and why it failed.
