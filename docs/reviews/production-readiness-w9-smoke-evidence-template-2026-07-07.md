# W9 Staging Smoke Evidence Template - 2026-07-07

This is a fill-in evidence worksheet, not completed W9 evidence. Use it only after the real Render service is serving the current `main` build and the health endpoint proves the app is live.

## Run Identity

| Field | Value |
|---|---|
| Release SHA under test | TODO |
| Render app URL | TODO |
| Render service name | TODO |
| Render deploy ID | TODO |
| Render database name | TODO |
| Render key value service name | TODO |
| Operator | TODO |
| Start time | TODO |
| End time | TODO |
| GitHub CI run | TODO |
| Amplify Security run | TODO |

## Entry Checks

Do not start functional smoke until every entry check is filled.

| Check | Expected | Evidence |
|---|---|---|
| `git rev-parse HEAD` matches deployed commit | Same SHA as release under test | TODO |
| GitHub CI on release SHA | Success | TODO |
| Amplify Security on release SHA | Success | TODO |
| `npm audit --omit=dev` on release SHA | 0 high/critical, no unaccepted moderate | TODO |
| Render service created from `render.yaml` | Yes | TODO |
| `CLIENT_URL` and `APP_URL` | Exact Render URL | TODO |
| `DATABASE_URL` | Render-managed Postgres, not local/dev DB | TODO |
| `REDIS_URL` | Render Key Value URL present | TODO |
| `SESSION_SECRET` | Present and generated/set outside repo | TODO |
| `TRUST_PROXY` | `1` | TODO |
| Optional feature flags | SMTP, Gemini, VAPID enabled or explicitly disabled | TODO |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` before baseline smoke | Not `true` yet | TODO |

## Health And Runtime Checks

Record the command, status code, response body summary, and timestamp. For the four health rows, run:

```powershell
npm run smoke:staging:health -- --base-url <Render app URL>
```

Paste the generated Markdown rows into the evidence cells below. The command must pass before functional smoke starts.

| ID | Probe | Expected | Evidence |
|---|---|---|---|
| HEALTH-001 | `GET /healthz` | HTTP 200 and JSON `status=ok` | TODO |
| HEALTH-002 | `GET /health/live` | HTTP 200 and JSON `status=healthy` | TODO |
| HEALTH-003 | `GET /health/ready` | HTTP 200, JSON `status=healthy`, and DB dependency healthy | TODO |
| HEALTH-004 | `GET /health/startup` | HTTP 200, JSON `status=healthy`, and DB dependency healthy | TODO |
| HEALTH-005 | Browser load of `/` | App shell, not Render welcome page | TODO |
| HEALTH-006 | Render logs during startup | No migration, env validation, Redis, session, or DB errors | TODO |

## Functional Smoke Checklist

Prefer a fresh staging user and non-production staging data. Do not use a production customer dataset for these checks.
Module release-gate traceability is tracked in `docs/reviews/w9-smoke-release-gate-map.json` and checked by `npm run check:w9-template`.

| ID | Area | Action | Expected Result | Evidence |
|---|---|---|---|---|
| AUTH-001 | Auth | Register or use documented staging user, login, logout, login again | Session establishes and clears correctly | TODO |
| AUTH-002 | Auth | Exercise MFA challenge, verify, and resend if MFA is enabled | Correct challenge, resend, and verification behavior | TODO |
| AUTH-003 | Auth | Exercise step-up denial and approval on a protected security action | Denial blocks action, approval permits it | TODO |
| AUTH-004 | Auth | Revoke a session and retry the old session | Old session rejected | TODO |
| AUTH-005 | Auth | Exercise email verification if SMTP is enabled | Verification email and token flow work; if disabled, feature-off state recorded | TODO |
| ACCOUNTS-001 | Accounts | Create, update, archive, and restore an account | Correct state transitions and audit trail | TODO |
| ACCOUNTS-002 | Accounts | Attempt access to another member's private account | 404 or equivalent denial; no data exposure | TODO |
| TRANSACTIONS-001 | Transactions | Create, update, delete, and restore a normal transaction | Balance and audit effects are correct | TODO |
| TRANSACTIONS-002 | Transactions | Create and delete a transfer | Both legs stay synchronized and balances reverse correctly | TODO |
| TRANSACTIONS-003 | Transactions | Run CSV import with valid rows | Transactions persist through central write path; balance updates; audit rows exist | TODO |
| TRANSACTIONS-004 | Transactions | Run CSV import with malformed amount and row-cap scenario where practical | Errors are surfaced per row or request; invalid data does not persist | TODO |
| TAGS-001 | Tags | Tag a visible transaction and page tagged transactions with offset | Stable pagination; visible rows only | TODO |
| TAGS-002 | Tags | Confirm another member cannot see a private tagged transaction | Private transaction excluded | TODO |
| CATEGORIES-001 | Categories | Create, update, archive, restore, seed, and reorder where available | State changes persist and audit rows exist | TODO |
| BUDGETS-001 | Budgets | Create/update budget, inspect spend calculation, and confirm monthly period behavior | Budget math matches transactions and period contract | TODO |
| CASHFLOW-001 | Cashflow | Load cashflow report and export current view | Report and export match scoped data | TODO |
| CASHFLOW-002 | Cashflow | Exercise missing-FX path where practical | Missing rate surfaces as an error, never silent 1.0 | TODO |
| DASHBOARD-001 | Dashboard | Load dashboard, update widget visibility/preferences, reload | Preferences persist; widgets render with retry/empty states where applicable | TODO |
| FILTERS-001 | Filter Presets | List/get/default/create/update/delete preset and duplicate-name conflict | Correct status, audit row on writes, default behavior stable | TODO |
| GOALS-001 | Goals | Create, update, contribute, assign account, upload image, and delete | Money and image paths work; audit rows exist | TODO |
| GOALS-002 | Goals | Attempt cross-household goal access | Denied without data exposure | TODO |
| HOUSEHOLD-001 | Household | Update household settings and inspect member visibility | Changes persist; member data scoped correctly | TODO |
| HOUSEHOLD-002 | Household | Exercise invitation status and role-gated denial | Invitation state correct; insufficient role blocked | TODO |
| INVESTMENTS-001 | Investments | Create GRZ bond and T-bill holdings with and without linked account | Holding records created; no cash movement | TODO |
| INVESTMENTS-002 | Investments | Post coupon or maturity income | Income transaction posts through shared transaction pipeline | TODO |
| MERCHANTS-001 | Merchants | CRUD merchant, duplicate detection, autocomplete, merge, and undo merge | Results correct and rollback-safe | TODO |
| MERCHANTS-002 | Merchants | Open merchant detail with non-ZMW settings currency | Currency formatting uses settings currency | TODO |
| NOTIFICATIONS-001 | Notifications | Read/archive notifications and update notification preferences | State persists | TODO |
| NOTIFICATIONS-002 | Notifications | Save/remove push subscription if VAPID is enabled | Subscription mutation works; if disabled, feature-off state recorded | TODO |
| RECEIPTS-001 | Receipts | Upload receipt with safe and hostile original filenames | Stored names are generated/sanitized; upload succeeds or rejects safely | TODO |
| RECEIPTS-002 | Receipts | Read uploaded receipt via authenticated route | Authenticated read succeeds; unauthenticated read denied | TODO |
| RECEIPTS-003 | Receipts | Exercise OCR/match/create-transaction path if OCR is enabled | OCR path works or disabled state is recorded | TODO |
| RECURRING-001 | Recurring | Create/update recurring schedule and process due item | Generated transaction is atomic and audited | TODO |
| RECURRING-002 | Recurring | Force or simulate processing failure where practical | Failure does not leave partial generated records | TODO |
| REPORTS-001 | Reports | Load scoped reports and export data | Data is scoped; export audit row exists | TODO |
| REPORTS-002 | Reports | Confirm report cache behavior through live app | Cache hit/miss behavior is acceptable and invalidates after writes | TODO |
| RULES-001 | Rules | CRUD rule, preview, reorder, and apply-to-past | Correct ordering and mutations | TODO |
| RULES-002 | Rules | Apply rules around private transactions | Private transactions excluded from other members' rule reads/mutations | TODO |
| SETTINGS-001 | Settings | Update profile, display, notification, household, and report-widget preferences | Changes persist and reload correctly | TODO |
| SETTINGS-002 | Settings | Exercise profile banner upload | Upload succeeds with sanitized storage path | TODO |
| SETTINGS-003 | Settings | Exercise password change, session revoke, and erasure guard | Step-up enforced; session and erasure behavior correct | TODO |
| WEEKLY-001 | Weekly Recap | Load recap and submit feedback | Recap and feedback persist | TODO |
| WEEKLY-002 | Weekly Recap | Update weekly recap settings and consent-gated email path | Email only sends with consent and SMTP enabled; disabled state recorded otherwise | TODO |
| AI-001 | AI Assistant | If Gemini is enabled, run consented AI query using tools | Sanitized tool path, persistence, rate limit, and audit/tracking behavior proven | TODO |
| AI-002 | AI Assistant | If Gemini is disabled, inspect feature-off behavior | Disabled state is explicit and does not break app shell | TODO |

## DB TLS Verification Stop Point

Baseline smoke must pass before this section. Stop and get explicit approval before changing Render env vars for strict certificate verification.

| Step | Expected | Evidence |
|---|---|---|
| Baseline DB connectivity before strict verification | `/health/ready` reports DB ready and functional smoke passed | TODO |
| CA source prepared | `DATABASE_SSL_CA_FILE` points to mounted Render secret file, or `DATABASE_SSL_CA_CERT` is set | TODO |
| Explicit approval to set `DATABASE_SSL_REJECT_UNAUTHORIZED=true` | Approval recorded in thread or change ticket | TODO |
| Redeploy after TLS flip | New deploy succeeds | TODO |
| Post-flip health | `/healthz`, `/health/live`, `/health/ready`, `/health/startup` are 200 | TODO |
| Post-flip targeted smoke | Auth login, account load, transaction list, report load pass | TODO |
| Render logs after TLS flip | No TLS/CA/DB connection errors | TODO |

## Rollback Evidence

Exercise rollback once in staging and record both rollback and forward recovery.

| Step | Expected | Evidence |
|---|---|---|
| Previous known-good deploy identified | Deploy ID and SHA recorded | TODO |
| Rollback action executed | Render rollback succeeds | TODO |
| Post-rollback health | Health endpoint returns 200 | TODO |
| Post-rollback login smoke | Login succeeds | TODO |
| Forward redeploy to release SHA | Release SHA serving again | TODO |
| Post-forward smoke | Health plus auth/account/transaction smoke pass | TODO |

## Completion Rules

- Do not mark W9 done until every applicable row above has evidence.
- Save the completed worksheet as a dated evidence file and run `npm run check:w9-evidence -- --file <completed evidence file>`; the validator must pass before W9 can move to done.
- Do not mark W10 started until W9 is done and the TLS flip evidence is recorded.
- Do not raise any module to 100/100 from local-only evidence.
- If a smoke row fails, create a new remediation packet and leave the corresponding module release-gate metadata open.
