# Production Readiness Closeout Assessment

**Date:** 2026-07-05  
**Repo:** `C:\Dev\personal-finance-app`  
**Branch:** `main`  
**HEAD:** `eba68d4a3b2ed41af3b15a15e2f94e9efd1ee45f`  
**Baseline:** `docs/reviews/production-readiness-audit-2026-06-04.md`  
**Method:** Live Git, CI, command, dependency, and code review. Prior audit/status documents were treated as leads, not authority.

## Verdict

The June P0 remediation campaign is substantially closed, and the repo is materially stronger than the original June audit. However, the codebase is **not yet defensibly 100/100 production ready**.

Current score:

| Dimension | Score | Reason |
|---|---:|---|
| Code-side remediation maturity | 85/100 | Most June launch blockers are closed, CI is green, full local check/build/tests pass, and real-DB coverage exists for many money/privacy paths. |
| True production readiness | 78/100 | Production dependency audit is red, global import execution has live write/privacy gaps, tags transaction reads can expose private transactions, and UX/a11y/test-noise quality issues remain. |
| Target for release without caveats | 100/100 | Requires all blockers in the paired remediation plan to be closed and verified. |

## Live Repository State

| Check | Result |
|---|---|
| Current branch | `main` |
| Upstream | `origin/main` |
| Current SHA | `eba68d4a3b2ed41af3b15a15e2f94e9efd1ee45f` |
| Open PRs | none (`gh pr list --state open` returned `[]`) |
| Registered worktrees | only `C:\Dev\personal-finance-app` |
| Local branches | `main` only |
| GitHub Actions on current main | CI success and Amplify Security success on `eba68d4` |
| Dirty files before this assessment | `docs/reviews/module-assessment-status-report.md`, `docs/reviews/module-assessments-index.json`, `scripts/tools/generate-module-assessment-status-report.mjs`, `server/services/emailService.ts` |

## Verification Results

| Command | Result | Notes |
|---|---|---|
| `npm run check` | PASS | `tsc` and storage-import check completed with exit 0. |
| `npm run build` | PASS | Client and server production build completed. Largest chunks remain `recharts-vendor` 463.43 kB raw / 122.19 kB gzip, app index 334.98 kB raw / 101.61 kB gzip, `radix` 258.77 kB raw / 82.50 kB gzip, `nivo-sankey` 133.72 kB raw / 47.28 kB gzip. |
| `npm run deploy:verify` | PASS | Deploy readiness verification passed. |
| `npm run report:modules` | PASS | Regenerated `docs\reviews\module-assessment-status-report.md` with 20/20 assessed modules and 4 security gate entries. |
| skipped/todo scan | PASS | No `.skip` or `.todo` tests found in `server`, `client`, or `e2e`. |
| `npm run test:run:split -- --reporter=dot` | PASS | Client split suite exit 0. Settings sub-suite reported 33 files / 293 tests passed; rest suite also completed. |
| `npm run test:server:run -- --reporter=dot` | PASS | Server suite exit 0. Output is noisy but no failing exit. |
| Targeted risky tests | PASS | Tags security, tags route tests, uploads auth, rate-limit wiring, and import route tests completed: 5 files / 60 tests passed. |
| `npm audit --omit=dev --json` | FAIL | 16 production vulnerabilities: 8 high, 8 moderate, 0 critical. |

## Dependency Security Gate

`npm audit --omit=dev --json` is the largest release blocker outside code logic. Current production dependency risk:

| Package | Severity | Current | Fix direction | Assessment |
|---|---:|---|---|---|
| `drizzle-orm` | high | 0.39.3 | 0.45.2 major | Must be upgraded or mitigated. Drizzle is central to all DB access. Current `sql.raw` use appears whitelist-gated in `server/core/authorization/ownership.ts`, but dependency risk remains. |
| `express-rate-limit` | high | 8.2.1 | patch/minor | Must be upgraded. Current custom key generators use `req.ip` and `validate: { ip: false }` in several limiters, so the IPv4-mapped IPv6 bypass should be treated as live until fixed. |
| `multer` | high | 2.0.2 | 2.2.0 | Must be upgraded. Upload endpoints are authenticated and limited, but file upload attack surface is production reachable. |
| `nodemailer` | high | 7.0.13 | 9.0.3 major | Must be upgraded or strongly mitigated. Current usage is simple `sendMail`, but high advisory remains in a production email boundary. |
| `ws` | high | 8.19.0 | 8.21.0 | Must be upgraded or removed if unused in production. |
| transitive packages | moderate/high | varies | mostly patch/minor | Includes `lodash`, `minimatch`, `path-to-regexp`, `qs`, `file-type`, `body-parser`, `bn.js`, `brace-expansion`, `geoip-lite`/`ip-address`. |

`npm audit fix --omit=dev --dry-run --json` indicates many vulnerabilities are patchable with lockfile/package updates, but Drizzle and Nodemailer require major-version review.

## Confirmed Current Blockers

### P0-1: Global Import Execute Allows Write-Path Bypass

**Status:** open  
**Affected modules:** Transactions, Accounts, Imports, Budgets, Tags/Recurring side effects, Audit  
**Severity:** P0 because this is an authenticated financial write path with privacy and data-loss consequences.

Evidence:

- `server/routes/import.ts:42-45` applies `requireAuth`, `householdGuard`, and `uploadLimiter`, but `/api/import/execute` has no `requireRole("member")`. A `view_only` member can reach a write endpoint.
- `server/routes/import.ts:29` accepts `rows: z.array(...).min(1)` with no max row count.
- `server/routes/import.ts:136` validates `targetAccountId` with `accountRepository.findById(...)`, not `findByIdWithVisibility(...)`.
- `server/repositories/AccountRepository.ts:114-129` confirms `findById` checks account id, household id, and deleted status only.
- `server/repositories/AccountRepository.ts:135-148` already has the private-account visibility helper that should be used.
- `server/services/ImportService.ts:138-145` deletes transactions for `prioritize_csv` by account/date range only, without household/private visibility predicates in the delete.
- `server/services/ImportService.ts:225-238` inserts directly into `transactions`, bypassing the normal transaction service pipeline.
- `server/services/ImportService.ts:276` parses money with `parseFloat`.

Impact:

- View-only users can initiate import writes if they have a valid session.
- A member can import into another member's private account if they know the account UUID.
- Overwrite imports can delete transactions in a date range without caller visibility checks.
- Direct inserts bypass transaction service invariants: audit logging, idempotency, balance behavior, currency checks, outbox/events, and shared validation.
- Money parsing accepts malformed partial numeric strings that strict money parsing would reject.

Existing test gap:

- `server/routes/__tests__/import.test.ts` is a mocked route-level test. It verifies household fallback/override, but does not exercise real HTTP, real Postgres, role enforcement, private-account visibility, overwrite delete scope, audit rows, or persisted transaction state.

### P0-2: Tags Transaction Read Can Expose Private Transactions

**Status:** open  
**Affected modules:** Tags, Transactions, Privacy  
**Severity:** P0 because this is a same-household private transaction disclosure path.

Evidence:

- `server/modules/tags/tags.routes.ts:38` exposes `GET /api/tags/:id/transactions` to any household member after `householdGuard`; no user visibility is passed.
- `server/modules/tags/tags.controller.ts:28-31` parses `offset`, but `server/modules/tags/tags.controller.ts:320-324` passes only `id`, `householdId`, and `limit`.
- `server/modules/tags/tags.service.ts:292-309` verifies the tag belongs to the household, then calls `findTransactionsByTag(tagId, householdId, limit)`.
- `server/repositories/TagRepository.ts:233-257` filters by tag, household, and `deletedAt`, but not by `transactions.isPrivate = false OR ownerUserId = currentUserId`.

Impact:

- If a private transaction has a shared household tag, another household member can list it by tag.
- Pagination semantics are also wrong because `offset` is accepted but ignored.

Existing test gap:

- `server/modules/tags/__tests__/tags-security.integration.test.ts` verifies tag write operations cannot mutate another household or another member's private transaction.
- It does **not** test `GET /api/tags/:id/transactions` for private transaction visibility.
- `server/modules/tags/__tests__/tags.integration.test.ts` mocks repositories for many route assertions, so it cannot prove SQL visibility.

### P0-3: Production Dependency Audit Is Red

**Status:** open  
**Affected modules:** cross-cutting  
**Severity:** P0 because the app handles financial data and PII, and production dependencies have high-severity advisories.

Evidence:

- `npm audit --omit=dev --json` reports 16 production vulnerabilities: 8 high and 8 moderate.
- Direct high-risk dependencies include `drizzle-orm`, `express-rate-limit`, `multer`, `nodemailer`, and `ws`.
- `npm ls drizzle-orm express-rate-limit multer nodemailer ws express file-type geoip-lite --depth=0` confirms vulnerable versions are installed.

Impact:

- Release cannot honestly be marked 100/100 while known high-severity production dependency advisories remain unresolved or explicitly mitigated.

## Important Non-Blocking But Score-Limiting Issues

| Item | Severity | Evidence | Required for 100 |
|---|---|---|---|
| Client a11y/test warnings | P1/P2 | Client test output includes missing Radix `DialogContent` descriptions, `TagColorPicker` `act(...)` warnings, nested button warning in `TagsMultiSelect`, and query functions returning undefined in mocks. | Clean warning budget or documented accepted warnings with tests. |
| Bundle/performance budget | P2 | Build output still ships large `recharts-vendor`, `radix`, and `nivo-sankey` chunks. | Bundle budget, lazy-loading, or accepted budget with perf evidence. |
| Module-status generator still covers 20 modules | P2 | `module-assessment-status-report.md` covers 20 canonical modules; AI Assistant and Filter Presets are assessed in this closeout but not in the generated index. | Add canonical assessments or extend generator/index. |
| `npm outdated` drift | P2 | Many production and dev packages are behind wanted/latest versions. | Security-first upgrades at minimum; broader dependency hygiene plan after P0s. |
| Debug/noisy tests | P3 | Settings debug tests print internal state; server tests emit expected but noisy error logs. | Clean test output before release-candidate discipline. |

## Current Module Scores

These scores are independent current-readiness scores from live evidence. They intentionally differ from `module-assessment-status-report.md`, which derives from older canonical assessment files and still contains stale status metadata.

| Module | Current | To reach 100 |
|---|---:|---|
| Accounts | 86 | Import must use account visibility, and account write/read paths need dependency gate clear. |
| Auth | 84 | Dependency audit and rate-limit package/IP normalization must be closed. |
| Budgets | 93 | Strong after recent fixes; dependency and final staging smoke still cap at under 100. |
| Cashflow | 85 | FX fail-closed paths are improved; bundle/a11y/dependency gates remain. |
| Categories | 82 | No new P0 found in this pass; needs full current canonical reassessment and warning cleanup. |
| Dashboard | 84 | Hook crash is closed; bundle and UI warning budget remain. |
| Goals | 87 | Real-DB coverage exists; upload dependency and staging smoke remain. |
| Health | 88 | Deploy verify passes; staging smoke/rollback proof remains. |
| Household | 88 | Prior P0s appear closed; dependency gate and final canonical refresh remain. |
| Investments | 87 | GRZ fixes appear in place; dependency gate and final smoke remain. |
| Merchants | 85 | No current blocker found; UI dialog warning and dependency gate remain. |
| Notifications | 88 | Email dependency and production SMTP behavior cap readiness. |
| Receipts | 82 | Upload parser dependencies and upload attack surface cap readiness. |
| Recurring | 88 | Atomicity tests exist; dependency/staging proof remain. |
| Reports | 86 | Export audit and FX are improved; bundle/dependency gate remain. |
| Rules | 90 | Prior privacy fixes appear in place; full current canonical score should be regenerated. |
| Settings | 90 | Strong tests; banner upload dependency and debug/noisy tests remain. |
| Tags | 72 | Private transaction read leak and pagination bug are open. |
| Transactions | 78 | Global import bypasses transaction service and private visibility. |
| Weekly Recap | 90 | Consent/audit improvements appear in place; email dependency remains. |
| AI Assistant | 86 | Sanitization and persistence appear improved; Gemini/live external smoke and dependency gate remain. |
| Filter Presets | 80 | Prior atomicity work appears improved; generated module assessment coverage is missing. |

## Delta From June

| Area | June 2026 audit | 2026-07-05 state |
|---|---|---|
| Overall | Not production-ready, avg roughly 65, 0 modules ready | Much stronger, avg roughly 85, but true readiness capped at 78 by current blockers |
| CI | Major gap | Main CI and Amplify Security green on `eba68d4` |
| Typecheck/build | Build/check passed but tests broken | Check/build/deploy verify pass locally |
| Test safety net | Misconfigured and many failures | Broad client/server suites exit 0; no skipped/todo tests found |
| Upload exposure | Static unauthenticated `/uploads` was a blocker | Authenticated `/uploads` handler and real tests pass |
| Money/FX | Many silent fallback/raw float paths | Most core paths fixed; import parser remains a clear gap |
| Remaining release blockers | Many P0s across infra, AI, GRZ, transactions, household, recap | Narrower P0s: import write/privacy, tags read privacy, dependency audit |

## Release Recommendation

Do not declare 100/100 or release without caveats yet. The release-candidate bar is:

1. Close P0-1 global import execution.
2. Close P0-2 tags private transaction read leak.
3. Resolve or formally mitigate all production dependency audit findings.
4. Re-run `npm audit --omit=dev`, `npm run check`, `npm run build`, `npm run test:run:split`, `npm run test:server:run`, `npm run deploy:verify`, and GitHub Actions on the final SHA.
5. Update canonical module assessments so generated scores match live code.
6. Run staging smoke/rollback against the real deploy target.

Until then, the honest state is **near release candidate, not final production ready**.
