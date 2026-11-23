# Evidence, verification limits and assessment additions

Baseline: `381e9439afabe7c6cf829cb1cbded91d36da44ee`, 11 October 2026. This file separates fresh outcomes from historical assertions and unexecuted checks.

## Environment and safety boundary

- Read-only application assessment: no tracked application source, migration, package manifest, lockfile, deployment configuration or existing canonical readiness document was modified.
- Existing unrelated untracked `.claude/launch.json` was preserved.
- All local test writes used freshly created, empty databases: `finance_app_audit_20261011_server_test` and `finance_app_audit_20261011_browser_test`. Versioned `npm run db:migrate` succeeded on both. The real development database `finance_app` was excluded from writes. No `db:push` was used.
- Host: Windows, Node 22.23.2, npm 11.19.1, PostgreSQL 18.6. Repository engines/CI target Node 20/PostgreSQL 16. These local results do not prove target-runtime parity.
- Local browser server was launched on `127.0.0.1:5000` with the named browser database, `NODE_ENV=test`, SMTP/push/Redis unset, and a dummy Gemini key. Synthetic users and financial records only. No real provider email, push message, bank transaction or investment order was sent. A dummy-key AI request failed and the page displayed a local keyword fallback; no successful live-provider integration was established.
- Test mode bypasses CSRF and relaxes production cookies/CSP/rate-limit behavior. Direct SQL was used for specifically identified synthetic verification/membership fixtures; this does not prove actual invitation or email delivery.
- The focused HTTP harness verifies its local SQL target and depends on the separately verified server launch for HTTP target binding. Future reusable testing must assert that binding before its first mutation (P00).
- Raw test logs and probe harnesses are retained locally under `.local/readiness-2026-10-11/`. The durable JSON under `evidence/` is sanitized. Credentials/cookies/token hashes are not part of the shared report.

## Commands and outcomes

| Evidence | Fresh result | Local log / retained artifact |
|---|---|---|
| Git baseline + GitHub main | Both exact SHA above; historical CI run 29771307852 succeeded on 20 July | Assessment tool evidence; current check outcomes below are newer |
| `npm run check` | Exit 0; tsc/guards pass, 62 known oversized files, no newly oversized/grown files; 44 gates, 0 final-ready modules | `.local/readiness-2026-10-11/check.log` |
| `npm run test:run:split` | 35 settings +129 other files; 298 +1,086 tests pass | `client-tests.log` |
| `npm run test:coverage` | Exit 0; 164 files, 1,384 tests, statement53.31/branch45.78/function48.48/line53.97 percent | `client-coverage.log`; `.local/coverage/client/` |
| Server coverage suite with explicit isolated DB | Exit 0; 201 files, 2,660 tests; statement64.92/branch50.27/function67.23/line65.63 percent | `server-tests.log`; `.local/coverage/server/` |
| `npm run build` | Exit 0 | `build.log` |
| `npm run deploy:verify`, `npm run check:bundle` | Pass; static deploy guard only; initial gzip185.78 kB /300 kB | Assessment command output |
| `npm audit --omit=dev --json` | 9 affected production package entries: critical1, high4, moderate4 | `dependency-audit.json` |
| `npx playwright test --project=chromium --workers=2 --reporter=line` with explicit synthetic env | 76 passed, 1 skipped, 9.9 minutes | `e2e-rerun.log` |
| Initial E2E attempt | Required Chromium executable absent; environment failure, not 77 product failures | `e2e.log`; browser subsequently installed and suite rerun |
| Focused runtime probes | Reproductions below; source unchanged | `evidence/runtime-results.json`; ignored `runtime-probes.mjs` |
| Browser fixture SQL read-only transaction | 1,000 opening -125.50 expense =874.50, one active transaction in ZMW | `evidence/browser-ledger-readback.json` |
| Blueprint candidate host probe | Root and `/healthz` timed out; `/health/ready`404 at2026-10-11T18:45:34.960Z | `render-probe.json`; not proof this is the intended live service |

Coverage percentages apply to configured include/exclude sets. Client config excludes all index.ts/index.tsx and several other groups; server coverage likewise is not a percentage of product requirements satisfied. No readiness percentage is inferred from test count or coverage.

## Independently observed runtime outcomes

| Test/observation | Result and interpretation |
|---|---|
| Fresh UI registration -> household -> account -> expense -> report/cashflow -> SQL | Core simple ZMW journey works and persisted amount/balance reconcile. Verification was bypassable at registration, so this is not a successful verified onboarding proof. |
| Owner cookies A/B; revoke B's new tracking UUID from A after step-up; replay B | Revoke200, subsequent B `/api/auth/me`200. AH-01 confirmed. |
| Unverified user creates household | Stored `email_verified=false`, protected `/me`200, household201. AH-04 confirmed. |
| Add Member caller endpoint | POST `/api/household/members`404; missing route confirmed. AH-05. |
| Profile PUT then GET | Bio control persists; offered gender/income/mobile values remain null despite200. AH-07. Response includes verification hash; AH-02. |
| Two identical overwrite imports | First imported1; second imported0/skipped1/deleted1; SQL row soft-deleted and balance reverted100. FIN-02. |
| Account-detail import of valid synthetic row | HTTP200 success with imported0/skipped1. FIN-04; UUID type mismatch traced in live source. |
| Private income linked to shared goal | Direct private transaction404 for member; goal-linked read200 reveals name/amount/notes to member and viewer. Outsider404 and viewer write403 are positive controls. FIN-01. |
| Actual CSV parser | Nonexistent2026-02-30 normalizes toMarch2; ambiguous01/02/2026 choosesJanuary2; no errors. FIN-15. |
| Manual expense and immediate summary | List shows125.50; summary showszero and stillzero after reload. Core server cache and client invalidation mismatch traced. FIN-17. |
| Reports Monthly Trends | “Invalid Date” repeated; actual API label fed to ISO parser. FIN-18. |
| First-run browser | Many household-not-found/raw404 toasts while correct Create My Household onboarding is visible. UX-01. |
| Transactions at390x844 | Expanded sidebar leaves content clipped; collapsed sidebar still leaves fixed summary/toolbar/list unusable across width. UX-02; desktop1280x900 also showed horizontal overflow on reports. |
| Receipt page | Empty state, scan and search/filter controls render. Upload/OCR/match not executed in production mode. |
| Advice page | A synthetic “hello” conversation displayed a spending fallback of125.50 ZMW. Server log at19:11:06Z records Gemini failure and keyword fallback under the dummy-key configuration. This is fallback observation, not a successful external model or consent-lifecycle test. |

Manual screenshots/AX observations were inspected during the assessment. No standalone saved screenshot artifact is claimed. The durable ledger read-back and focused JSON provide reproducible numerical evidence.

## Additional coordinated findings

### DEP-01 — P1: production dependency security gate is stale

Fresh audit entries: proxy-addr (critical), multer/nodemailer/sharp/ip-address (high), body-parser/csv-parse/express/qs (moderate). These are affected packages, not nine demonstrated exploits. `proxy-addr`2.0.7 is inside the reported affected range; [GitHub advisory GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) supplies current advisory details. Fix or eliminate affected dependency paths and document applicability; do not run a blind major-version audit fix. Validate uploads, SMTP, CSV, proxy IP/rate limits and image processing after updates. Re-run exact-release-SHA production audit; retain expiry/owner for any explicitly accepted residual advisory.

### DEP-02 — P1: runtime target requires refresh

`package.json` and CI still target Node20. The [official Node release table](https://nodejs.org/en/about/previous-releases) lists Node20 as end-of-life. Choose a supported LTS, align local/CI/deployment, pin it, and exercise native image/OCR dependencies and PostgreSQL behavior on that declared matrix. This is separate from local tests passing on Node22/PostgreSQL18.

### UX-01 — P1: first-run and anonymous data fetching produces misleading error cascades

Browser registration reached a legitimate setup state while multiple protected resources emitted missing-household errors and raw JSON. The anonymous login surface also received failed resource-fetch toasts. Gate household-dependent queries on authenticated membership; represent expected absence as one actionable onboarding state; show safe, contextual error copy for real failures. Acceptance: new browser -> registration -> verify -> household -> first transaction, with no misleading failure notification; genuine server outage remains visible and retryable. Root implementation change still needs query-by-query tracing.

### UX-02 — P1: small-screen layout prevents core transaction use

Observed at390x844 with expanded and collapsed sidebar. Require responsive navigation, usable table/list strategy, reachable controls and dialogs, and non-overlapping summary content. Test320/390/768/1280 widths, portrait/landscape and200% zoom. All primary actions must remain reachable without horizontal page scrolling; deliberately scrollable data tables need clear labels and keyboard access. This is a manual finding, not a formal WCAG certification.

### QA-01 — P1: green browser tests do not establish completed business journeys

`e2e/transactions.spec.ts:175` fills an expense form without submit or persisted assertion. Several cases guard actions behind `if(control)` without failure when absent. `e2e/investments.spec.ts:103` skips its populated-tab journey when no holdings exist (the one skip in this run). Replace vacuous checks with deterministic owned fixtures and unconditional assertions on intended outcomes. Link each release scenario to role, money/DB oracle, failure case and production-mode evidence. Keep fast smoke tests, but label them honestly.

### QA-02 — P1: operational evidence is incomplete

No owner-supplied deployment URL or service identity was supplied; no authenticated provider inspection, production-mode HTTPS session/CSRF, actual SMTP deliverability, durable upload restart, DB+file restoration, Redis outage, load/SLO test, real mobile-device journey, assistive-technology audit, or approved privacy/support process was established. These are explicit release tasks, not alleged existing outages. Staging is a necessary next environment, as requested by the owner.

## Historical reconciliation and external state

- Existing index:22 modules assessed,44 release gates,0 final-ready. Its zero security entries is a documentation state, contradicted by new findings if treated as a current security guarantee. Do not silently rewrite it to green.
- Earlier July “98/100”, “no local P1”, W9/W10 and zero-advisory claims are historical. The specialist reports distinguish prior genuine repairs from current counterexamples.
- GitHub open PRs during assessment:149 hook prose matching;150 inactive MFA flag honesty;151 CI concurrency;152 draft GRZ route split. None was assumed merged or sufficient to close this package. No open GitHub issues were returned; a separate Linear backlog was not inspected.
- [Render durable-disk documentation](https://render.com/docs/disks) explains that default filesystem content is ephemeral. The repository blueprint declares no upload disk; actual provider configuration remains unknown (OPS-001).
- [Gemini lifecycle documentation](https://ai.google.dev/gemini-api/docs/deprecations) lists a1June2026 shutdown date for the hardcoded `gemini-2.0-flash`; the document qualifies table dates as earliest shutdown dates. A supported configured model and actual controlled provider smoke are required; no successful provider call was made here (OPS-012).
- No claim is made that tax/GRZ product conventions or participant privacy terms satisfy a specific law. Full completion includes product-owner/domain validation of those exact rules and an appropriate privacy review; this assessment is source/runtime engineering evidence.

## Evidence closure rule

A finding closes only when its changed code is identified, relevant regression fails before/passes after, affected UI/API/database paths agree, and its production-dependent acceptance runs on a known deployment. Record commit, environment, timestamp, synthetic fixture, expected/actual outcome and reviewer. A PR title, success toast, mock-only unit test or historic green CI cannot substitute for this chain.
