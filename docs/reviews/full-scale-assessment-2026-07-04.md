# Full-Scale Assessment — Personal Finance App

**Date:** 2026-07-04
**Method:** Independent adversarial verification of the 2026-07-03 reconciliation against
current `main@c0804eb` (5 parallel read-only verification agents + local ground-truth runs:
`npm run check`, CI status, migration/journal inspection), followed by a residual-hardening
fix wave with real-DB tests. Per the repo's Previous Session Audit Rule, no verdict below
rests on a document claim — every CLOSED cites code read this session, and this document
itself verified the *reconciliation's* claims rather than trusting them.
**Baselines:** `production-readiness-audit-2026-06-04.md` (14 P0s, long P1 tail, 0/22 ready)
→ `production-readiness-reconciliation-2026-07-03.md` (close-out claimed complete).

**Close-out addendum (later 2026-07-04):** the residual hardening list below has moved again.
Client amount parsing landed in PR #70, the monthly-only budget-period DB contract landed in
PR #72, chart dependency consolidation landed in PR #73, and rollover/filter-preset
atomicity were re-verified green on `main`. Coverage ratcheting is now tracked in
`docs/operations/coverage-ratchet-plan.md`. The remaining readiness work is external
Render provisioning and staging smoke testing per `docs/runbooks/deploy.md`.

---

## 1. Verdict

> **The 2026-06-04 audit close-out is real.** All 14 P0 launch blockers are closed in code
> on main — independently re-verified this session, not taken from the reconciliation. The
> P1 launch-blocking set is closed. CI (typecheck → versioned migrations → server tests vs
> real Postgres 16 → client tests → build → e2e smoke, with coverage thresholds armed) and
> Amplify Security are green on main; `npm run check` is clean locally.
>
> **What still stands between the repo and a live deploy is operator work, not code:**
> provisioning Render from `render.yaml` per `docs/runbooks/deploy.md` and running the
> staging smoke tests. The code-side residuals identified by this assessment were fixed in
> this session's hardening branch (see §4).

Two verification results were *better* than the reconciliation recorded:

- **P0 #11 (real-DB coverage) upgrades from PARTIAL to CLOSED.** Goals has real-DB HTTP
  integration tests (`goals.realdb.integration.test.ts`) and Investments has a real-DB
  SELL/overdraft concurrency test (`investments.sell-overdraft.realdb.integration.test.ts`)
  — both existed but were unverified in the reconciliation.
- **Zero skipped tests remain** across server and client (the reconciliation still carried
  "13 skipped tests" as partial).

## 2. Ground-Truth Signals (this session)

| Check | Result |
|---|---|
| `npm run check` (main and hardening branch) | ✅ clean |
| GitHub CI on `main@c0804eb` | ✅ green (run 28687536378) |
| Amplify Security on main | ✅ green |
| `main` vs `origin/main` | ✅ in sync; no open PRs before this session's |
| Migrations | 0000–0006 versioned + journal consistent; 0007 added this session |
| Skipped tests (`.skip`) | ✅ zero across server/ and client/src |
| Coverage thresholds | ✅ actually run in CI (`test:coverage`, `test:coverage:server`); client include covers the financial feature folders |

## 3. P0 Re-Verification (all 14, against code)

| # | June P0 | Verdict | Evidence anchor |
|---|---|---|---|
| 1 | Static deploy target | ✅ CLOSED | `.replit` → cloudrun; `render.yaml` (build, `preDeployCommand: npm run db:migrate`, `/healthz`) |
| 2 | Redis rate-limit store unused | ✅ CLOSED | `rateLimit.ts` `createLimiter` threads a per-prefix RedisStore into all 6 limiters |
| 3 | Cron double-fire | ✅ CLOSED | `scheduler.ts` — all 3 jobs via `withRedisLock` |
| 4 | No DB SSL | ✅ CLOSED | `db.ts` `resolveSsl()` — on by default in production |
| 5 | `trust proxy` missing | ✅ CLOSED | `app.ts:37-51` — defaults to 1 in prod, `TRUST_PROXY` override |
| 6 | GRZ float money | ✅ CLOSED | `grz-service.ts` fully on Money/Decimal; residual `Number.toFixed(4)` on auction *yield stats* fixed this session (§4) |
| 7 | GRZ writes unaudited | ✅ CLOSED | audit calls on all 4 write endpoints in `grz-securities.ts` + auction results |
| 8 | AI PII to Gemini + false attestation | ✅ CLOSED | central sanitizer covers all 12 tools; `data_sanitized` derived from real result; false-case tested |
| 9 | Tool args as-cast into SQL | ✅ CLOSED | Zod validation wired before query dispatch; injection-shaped args tested |
| 10 | No CI | ✅ CLOSED | `ci.yml` full pipeline on every PR/push |
| 11 | Mocked "integration" tests | ✅ CLOSED (upgraded) | real-DB suites incl. Goals HTTP and Investments SELL-race |
| 12 | Dashboard hooks crash | ✅ CLOSED | all hooks precede the early return, invariant pinned by comment |
| 13 | Ownership transfer non-atomic | ✅ CLOSED | both member rows FOR UPDATE (deadlock-ordered), invite+household locked |
| 14 | Recap consent/audit/cron | ✅ CLOSED | consent gate on `aiConsentGiven`, egress audit row, cron lock |

## 4. Residual Hardening — fixed this session (branch `fix/residual-hardening-close-out`)

These were the only code-level residuals still open on main, from the reconciliation's §4b/§5
and this session's sweep. All are now fixed with tests on the hardening branch:

| Item | Severity | Fix |
|---|---|---|
| Transfer-pair desync via generic PUT (amount-only edit on one leg bypassed the type-only guard) | HIGH (money) | Material-field guard in `updateTransaction` (amount via Decimal equality, accountId, date, currency) → 400 pointing to the transfer endpoint; unit tests for amount and account moves |
| Rollover persistence non-atomic (`Promise.allSettled`, rejections silently dropped) | MEDIUM (money) | `persistBudgetPeriodRollovers` wrapped in one `withTransaction`, sequential tx-aware upserts, loud log+rethrow; real-DB test proves full rollback on mid-batch FK failure |
| Filter-preset duplicate-name race (read-then-insert, no constraint) | MEDIUM | Migration `0007` dedupe-then-unique-index on (household, user, context, name) + schema entry + 23505→409 translation; real-DB race + rename-collision tests |
| Client float long-tail: OCR receipt amounts via raw float parse | MEDIUM (money) | `receiptParser.ts` on `parseMoneyString`/Decimal end-to-end (incl. largest-amount fallback and confidence consistency check); unit tests incl. float-drift case |
| CSV import validated with `parseFloat` (accepts "12abc") | LOW | strict `isParsableMoneyString` (new in `client/src/lib/money.ts`) + tests |
| GRZ auction yields formatted via `Number.prototype.toFixed` | LOW (consistency) | Decimal `toDecimalPlaces(4)` (columns are `decimal(6,4)`) |
| Stale `TODO-028` on `balanceAdjustmentSchema` (already Decimal) | trivia | comment removed |

Enforcement note: the repo's PreToolUse hooks (float-money, `as any`) fired three times
during this wave and were satisfied by compliant rewrites, not bypassed.

## 5. Remaining Work Register (post-branch)

**Deploy (operator, ~1–2d):** provision Render from `render.yaml` per
`docs/runbooks/deploy.md`; staging smoke of the four money-critical flows (login/session
persistence, transfer, GRZ purchase, recap consent); exercise one rollback.

**Deliberate product decisions (not regressions):**
- Budget periods are now API- and DB-locked to `monthly`; exposing yearly/custom needs a
  product call plus period-aware progress/forecast logic and a forward migration.
- `Money.add/subtract` warn (not throw) on currency mismatch — kept for legacy null-currency
  rows; recommend throwing outside legacy read paths as a follow-up.

**Post-launch hardening (small, sequenced):**
- Chart-library consolidation: CLOSED by PR #73 for the unused Nivo packages; only the
  intentionally retained `@nivo/sankey` package remains alongside Recharts.
- Coverage-threshold ratchet plan: tracked in `docs/operations/coverage-ratchet-plan.md`.
- E2E determinism beyond the CI smoke spec (11 further Playwright specs exist).
- Theming sweep (hardcoded color utilities / non-theme-aware chart palettes from June).
- Migration 0003 was amended in place before any production deploy existed (acceptable);
  any dev DB that applied the *original* 0003 will hash-mismatch on `db:migrate` and should
  be rebuilt once.
- Linear board reconciliation against this state (connector unauthenticated this session).

## 6. Monarch-Parity: Verified Feature Map

Code-verified (not doc-claimed). **Corrections to the reconciliation in both directions:**

**Already present (reconciliation under-claimed):**
- Investment analytics: Holdings, **Performance** and **Allocation** tabs, plus FX-impact
  panel, tax report, pension dashboard, recurring-investment setup (`Investments.tsx`).
- **Recurring calendar view** (dual calendar/list, `Recurring.tsx`) — was listed as a gap.
- **Net-worth trend surface**: `NetWorthWidget` (dashboard trend chart) + Reports net-worth
  tab — the "no dashboard trend" gap is stale; only a standalone page is missing.
- Budget **rollover controls in the UI** (per-category `rolloverEnabled`, rollover balances).
- 11 dashboard widgets, command palette, step-up re-auth, web push, weekly recap wizard,
  3 themes, view-only household role.

**Real gaps vs Monarch (ranked by leverage in a Zambian, manual-first market):**
1. **Installable PWA** — `manifest.json` absent, `sw.js` is push-only, no registration in
   `main.tsx`; the app is not installable. This is the only viable "mobile app" in scope
   and the highest-leverage gap. (~3–5d incl. app-shell caching + icons.)
2. **Bank/MoMo statement-import profiles** — the 5-step CSV wizard is generic column
   mapping; `BankLogo.tsx` already ships Stanbic/Zanaco/FNB/MTN/Airtel logos but no
   auto-detected profiles. Plaid-class sync does not exist in-market, so import profiles
   *are* the sync story. (~5–8d.)
3. **Goal auto-funding** — manual transfers only; wire scheduled funding through the
   existing recurring engine. (~3–5d.)
4. **AI assistant deep links** — Thandi answers text-only; add "show me" navigation payloads
   into filtered views. (~3–4d.)
5. **Benchmark comparison** for investments (allocation/performance exist; no index
   comparison). (~2–3d.)
6. **Budget flexibility end-to-end** — surface periods + flex budgeting once the product
   decision in §5 lands. (~3–5d after the decision.)
7. Advisor seats and Zestimate-style asset valuation — Monarch features with no in-market
   equivalent pressure; defer.

**Differentiators over Monarch (keep and market):** GRZ sovereign-debt module (bonds,
T-bills, auctions, coupon + WHT), receipts OCR, Zambia DPA compliance (consent registry,
real right-to-erasure, egress audit), fail-closed multi-currency FX, household-private
transactions, step-up re-auth, self-hostability.

## 7. Effort to Deploy-Ready (updated)

| Wave | Scope | Est. |
|---|---|---|
| A. Merge hardening branch | this session's PR (review + CI) | 0.5d |
| B. Provision + smoke | Render blueprint, runbook, staging smokes, rollback drill | 1–2d |
| C. Small hardening PRs | chart consolidation, coverage ratchet, Money.add policy | 2–4d |
| D. Product roadmap | §6 gaps 1–5 | ~16–25d |

**Deploy-ready ≈ Wave A + B (about 2 days of operator/review time).** Everything after is
improvement, not readiness.

## 8. Recommended Sequence

1. Review and merge `fix/residual-hardening-close-out` (CI must be green first).
2. Provision Render per the runbook; run the staging smoke set; exercise a rollback.
3. Ship the PWA manifest + app-shell (gap #1) — small, high-visibility.
4. Statement-import profiles (gap #2), then goal auto-funding (gap #3).
5. In parallel, land the small hardening PRs (Wave C) and reconcile Linear.

---

*Verification note: 5 read-only agents (2× P0 re-verification, §4b follow-up verification,
remaining-work sweep, Monarch parity) + direct runs. All 14 P0 verdicts and every §4/§5/§6
claim trace to file-level evidence read this session on `main@c0804eb`. This document
verifies and supersedes the open-items view of the 2026-07-03 reconciliation; history and
method live in the two baseline documents.*
