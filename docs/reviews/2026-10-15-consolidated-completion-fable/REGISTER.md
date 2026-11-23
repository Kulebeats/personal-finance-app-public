# Unified remaining-work register

Every finding from both assessments, deduplicated, at `main` @ `381e943`. All rows are OPEN. Columns: Codex id, Fable id, title, consolidated severity (DECISIONS.md R5), verification state as of 15 October (HTTP+DB = reproduced over HTTP with database read-back; BROWSER; SRC = confirmed in source; PARSER = executed pure function; NOT EXERCISED = adopted on source citations, must be reproduced inside its work order), and the work order (CP) that closes it. A row is closed only per REMEDIATION_PLAN.md §2.6, and the closing agent fills the Status column with commit SHA, test name and evidence path.

Evidence paths: Codex `2026-10-11-deep-readiness/<report>.md:<line>` and `evidence/*.json`; Fable `2026-10-13-independent-readiness-fable/evidence/findings-draft.md`, `evidence/domain-*.md`, `evidence/skeptic-pass.md`, `EVIDENCE.md §4b`.

## 1. P0 clusters (release-stopping)

| # | Codex | Fable | Title | Verification | CP | Status |
|---|---|---|---|---|---|---|
| P0-1 | FIN-01 | PRIV-01, PRIV-03, PRIV-04 | Private-account transactions readable and unlinkable by other members through goal links, goal activity and goal summary; create API never sets `transactions.is_private` | HTTP+DB (both) | CP-04 | OPEN |
| P0-2 | ORG-002 | PRIV-02 | Tag transaction lists ignore account privacy | HTTP (Fable), SRC (Codex) | CP-04 | OPEN |
| P0-3 | OPS-005 | PRIV-05 | Recurring rules on private accounts visible to other members (direct recurring routes and weekly recap) | HTTP (Fable, recurring routes); SRC (Codex, recap path) | CP-04, CP-18 | OPEN |
| P0-4 | | ISO-01 | Outsider household reads `GET /api/goals/:id/activity` (`goals.controller.ts:359-369` ignores householdContext) | HTTP (Fable, skeptic re-run) | CP-04 | OPEN |
| P0-5 | ORG-003 | adopted | Rule actions accept and apply category, tag, owner and split-category ids from another household; foreign tag usage count polluted | HTTP+DB (Fable 14 Oct) | CP-14 | OPEN |
| P0-6 | FIN-02, FIN-03 | IMP-01 | CSV overwrite: re-import soft-deletes rows and skips replacements (balance 1257.50 to 415.00 with a success response); account-level overwrite deletes one leg of a transfer | HTTP+DB (both, FIN-02); SRC (FIN-03) | CP-10 | OPEN |
| P0-7 | | GRZ-01, GRZ-02, GRZ-04 | Principal repayment booked as ledger income (250000.00); coupons and principal of a sold bond still payable; early pay and pay into another account accepted | HTTP+DB (Fable) | CP-15 | OPEN |
| P0-8 | | RC-01 | Ratios and debt analysis perform no currency conversion and ignore private/hidden filters (liquidAssets 40202.92 instead of 42115.42 at the stored 26.50 rate) | HTTP (Fable, reproduced twice) | CP-09 | OPEN |
| P0-9 | FIN-06 | BGR-01 | Budget spend sums foreign-currency amounts unconverted (USD 50.00 counted as K50.00) | HTTP+DB (Fable), SRC (Codex) | CP-11 | OPEN |
| P0-10 | OPS-003 | F-OPS-01 | No scheduler drives recurring, rollover, snapshots, FX or investment automation in the declared deployment; `CRON_SECRET` optional | SRC (both) | CP-13, CP-16 | OPEN |
| P0-11 | AH-01 | SES-01 | Session revoke deletes `user_sessions` only; the express `session` row survives and the revoked cookie keeps working; correct helper used only by password change | HTTP+DB (both) | CP-01 | OPEN |
| P0-12 | OPS-008 | (observed, unrated) | Push subscription accepts any HTTPS endpoint; with VAPID configured the server connects to it (SSRF class). P0 once push is enabled | HTTP (accept observed); egress NOT EXERCISED | CP-18 | OPEN |

## 2. P1 rows (required for the full product)

### 2.1 Identity, sessions, verification (CP-01, CP-02)

| Codex | Fable | Title | Verification | CP | Status |
|---|---|---|---|---|---|
| AH-02 | F-AUTH-02 | `/me`, login, register, profile and members DTOs expose MFA code, backup codes, verification token hash, `nrc`, `salaryRangeEncrypted`, lockout counters | HTTP (both) | CP-01 | OPEN |
| AH-10 | | One-time MFA and backup code consumption not atomic | NOT EXERCISED | CP-01 | OPEN |
| AH-12 | | Password change bypasses the registration/reset policy (P2 in Codex, raised for consistency) | NOT EXERCISED | CP-01 | OPEN |
| | DEL-01 | Deleted user's express session row survives; cookie accepted via the tombstone | DB+SRC | CP-01 | OPEN |
| | SNA-SEC-02 | E-mail and password change send no notice and write no security event | HTTP | CP-01 | OPEN |
| AH-03 | F-AUTH-01 | Verification e-mail links `/auth/verify-email`; client routes `/verify-email`; link renders 404; login refuses unverified users | BROWSER+DB (Fable), SRC (Codex) | CP-02 | OPEN |
| | F-AUTH-04 | CSRF token bound to a non-persisted anonymous session: `POST /api/auth/verify-email` and `/settings/security/email/verify` always 403 outside the registering session | HTTP | CP-02 | OPEN |
| AH-04 | F-AUTH-03 | Registration session has full API access while unverified | HTTP+DB (Codex), DB+SRC (Fable) | CP-02 | OPEN |
| UX-01 | F-UX-01, F-ONB-01 | First-run and anonymous pages fire household-dependent queries: error toasts, raw 404 JSON; no categories seeded on household creation | BROWSER (both) | CP-02 | OPEN |

### 2.2 Household and roles (CP-03, CP-04)

| Codex | Fable | Title | Verification | CP | Status |
|---|---|---|---|---|---|
| AH-05 | F-HH-01, SEC-02, F-HH-03 | Add Member posts to non-existent `POST /api/household/members`; invite e-mail links `/invite/:code` which has no client route and no accept caller; members list shows "Unknown User" (flat vs nested DTO); UI offers a role the server rejects; no client callers for leave and transfer | BROWSER+HTTP (both) | CP-03 | OPEN |
| AH-06 | SEC-01 | Invite acceptance does not check the recipient (member joined as admin on an invite addressed to nobody@); one-household check outside the acceptance transaction so concurrent accepts can both pass | HTTP+DB (Fable, recipient); NOT EXERCISED (concurrency) | CP-03 | OPEN |
| | SEC-06 | Transfer ownership to self returns 200 and leaves the household ownerless, unrecoverable via API | HTTP+DB | CP-03 | OPEN |
| | SEC-07 | A second owner can be created and can demote the original owner | HTTP+DB | CP-03 | OPEN |
| AH-13 | F-HH-02 | Fake "Household Premium" panel, dead "Configure shared views" control, unsupported promises | BROWSER | CP-03, CP-20 | OPEN |
| | VAL-01 | Names unescaped in invitation HTML (P2 in Fable, joined with OPS-009) | HTTP | CP-03 | OPEN |
| ORG-001 | adopted | `requireRole` hierarchy lacks `professional`; `undefined < level` is false so the guard passes for that role and any unknown value | SRC (Fable 14 Oct) | CP-04 | OPEN |
| AH-09 | F-SEC-01 | View-only member writes household-level `household_preferences`; report exports and recap generate also lack a role gate | HTTP+DB (Fable 14 Oct) | CP-04, CP-05 | OPEN |
| FIN-01 (investments variant) | | Investment holdings and transactions scoped to household only; members can read and mutate another member's private holdings; portfolio valuation ignores account privacy | NOT EXERCISED | CP-04, CP-15 | OPEN |
| FIN-01 (export variant) | | Account transaction export includes other members' private transactions | NOT EXERCISED | CP-04, CP-10 | OPEN |

### 2.3 Settings, MFA, data rights (CP-05, CP-06, CP-07)

| Codex | Fable | Title | Verification | CP | Status |
|---|---|---|---|---|---|
| AH-07 | SET-01 | `PUT /api/settings/profile` drops 14 of about 22 form fields and returns "Profile updated" | HTTP+DB (both) | CP-05 | OPEN |
| | SET-02 | Preferences section saves to household preferences; no route writes `user_preferences`; every save returns 200 | HTTP+DB | CP-05 | OPEN |
| | SET-05 | Currency change on a household with a ledger produces 500s and a zeroed recap | HTTP | CP-05 | OPEN |
| OPS-007 | SNA-REC-01 | Recap settings cross-write (recap day overwrites first-day-of-week; widget save resets recap toggles); saved recap content preferences do not govern generated content | HTTP+DB | CP-05, CP-18 | OPEN |
| AH-11 | F-SEC-05 | MFA has no enrolment, disable or recovery UI; mandatory flag inert | BROWSER+SRC | CP-06 | OPEN |
| AH-08 | DATA-01, F-SEC-02 | Personal-data export is a stub (fake id, no row, no file, no audit, no UI) | HTTP+DB | CP-07 | OPEN |
| AH-08 | DEL-02 | Account deletion keeps e-mail and IP in `security_audit_logs` and the password hash on the tombstone; deletes the household's audit history; no UI; not all household states handled | DB+SRC | CP-07 | OPEN |
| | RC-13, server-surface F4 | Account CSV exports and several money writes (pension, SIP, market refresh, budget settings, attachments, cron ledger writes) write no audit row | HTTP+DB | CP-07 | OPEN |
| FIN-16 | | Transaction UPDATE audit written after commit, outside the transaction | SRC | CP-08 | OPEN |

### 2.4 Ledger, currency, consistency (CP-08, CP-09)

| Codex | Fable | Title | Verification | CP | Status |
|---|---|---|---|---|---|
| FIN-05 | X-01 | Import and recurring persist `currency = NULL`; DTOs default to ZMW; summary labels converted totals as ZMW | DB (Fable), DB (Codex) | CP-08 | OPEN |
| FIN-17 | F-TXN-01, RC-06 | Transaction summary cached five minutes under `txn-summary:*` and never invalidated on write; client query-key mismatch; summary uses latest not dated FX rate | BROWSER+HTTP (both) | CP-08 | OPEN |
| | RC-08 | Client builds "this month" in UTC (Lusaka sends 09-30..10-30) across 23 call sites | HTTP+SRC | CP-08 | OPEN |
| FIN-08 | | Editing a split parent's amount leaves child splits and dependent totals stale | NOT EXERCISED | CP-08 | OPEN |
| FIN-13 | | Account currency, asset/liability type and opening balance editable under existing ledger rows without reconciliation | NOT EXERCISED | CP-08 | OPEN |
| | F-DATE-01, 01b, 01c, SEC-04 | Naive timestamps mix DB-local `now()` and JS UTC writes: +2 h display skew, future-tense notifications, invitations "accepted before created", expiry windows 2 h short, tax-year boundary in UTC | HTTP+DB | CP-08 | OPEN |
| | F-UX-02 | `staleTime: Infinity` so other members' writes are invisible until reload | SRC | CP-08 | OPEN |
| | F-TXN-03 | Owner selector ignored on create (`create.ts:186` always creator) | BROWSER+DB | CP-08 | OPEN |
| | RC-02, INV-06 | `fx_rates` and `securities` global and writable by any member of any household; one household's rate changed another's net worth | HTTP+DB | CP-09 | OPEN |
| | RC-03, RC-04 | Card purchase reduces the liability (net worth 41668.69 vs 41577.69); card spending moved to a "debt" bucket and excluded from expenses | HTTP+DB | CP-09 | OPEN |
| | RC-05 | Split transactions missing from budget comparison, transactions report, Sankey and both CSV exports (October actual 1073.75 vs 1273.75) | HTTP | CP-09 | OPEN |
| FIN-14 | | Valuation errors caught and net worth returned without the holdings and without a completeness flag | NOT EXERCISED | CP-09 | OPEN |
| FIN-18 | F-REP-01 | Monthly trends parse a formatted month label as ISO: "Invalid Date", grouped values lost | BROWSER (both) | CP-09 | OPEN |
| | F-CF-01 | Cash-flow averages include future months | HTTP | CP-09 | OPEN |
| | RC-09, RC-10, RC-11, RC-12, RC-14 | Recap week is 8 days; missing-rate 500s on some reports; penny footing differences; merchant total excludes unassigned; net-worth history is snapshot-only | HTTP | CP-09 | OPEN |

### 2.5 Import and receipts (CP-10, CP-17)

| Codex | Fable | Title | Verification | CP | Status |
|---|---|---|---|---|---|
| FIN-04 | | Account-detail import skips every valid row (uuid type mismatch) and reports success | HTTP (Codex) | CP-10 | OPEN |
| FIN-15 | IMP-03 | `2026-02-30` accepted and saved as 2026-03-02; ambiguous slash dates parsed inconsistently; Notes mapping dropped | PARSER (Codex), HTTP+DB (Fable) | CP-10 | OPEN |
| | IMP-02 | Dedupe key is date+type+amount, so two same-day equal purchases merge | HTTP+DB | CP-10 | OPEN |
| | (P3) | `data_imports` rows never written | DB | CP-10 | OPEN |
| | RCP-01 | Receipt `create-transaction` repeatable (double charge 88.40) | HTTP+DB | CP-17 | OPEN |
| | RCP-02 | Receipt amount accepts a negative value that raises the balance | HTTP+DB | CP-17 | OPEN |
| OPS-004 | | OCR worker and WASM assets conflict with the production CSP | SRC | CP-17 | OPEN |
| | (P3) | Receipt details expose server filesystem paths | HTTP | CP-17 | OPEN |

### 2.6 Budgets, goals, recurring (CP-11, CP-12, CP-13)

| Codex | Fable | Title | Verification | CP | Status |
|---|---|---|---|---|---|
| FIN-07 | BGR-03 | "Historical averages" writes the multi-month total as the monthly budget (550.00 where 183.33), overwrites manual budgets, creates 79 zero budgets | HTTP+DB (Fable), SRC (Codex) | CP-11 | OPEN |
| | BGR-02 | Rollover gated on `household_preferences.auto_rollover_budget`, which nothing can set | HTTP+DB | CP-11 | OPEN |
| | BGR-04 | Recalc and clear audit rows fail silently (`entityId "bulk:<uuid>"` into a uuid column) | DB | CP-11 | OPEN |
| FIN-09 | | Goal transaction links do not preserve progress through edit, delete and unlink | NOT EXERCISED | CP-12 | OPEN |
| | GOAL-01 | Contribution of 1,000,000 accepted and irreversible | HTTP+DB | CP-12 | OPEN |
| | F-REC-01, REC-01 | Recurring rules cannot be created from the UI (form omits `frequency` and `nextDueDate`; 400 with no message) | BROWSER | CP-13 | OPEN |
| FIN-12 | REC-02, REC-03, REC-04 | Monthly rule drifts after a short month (day capped at 28); one missed occurrence per run; member can post future-dated occurrences via `asOfDate`; investment schedules miss overdue runs and drift past month-end | HTTP+DB (Fable), SRC (Codex) | CP-13, CP-15 | OPEN |
| OPS-013 | | Scheduler locks expire without renewal, carry no scheduled-date identity, share the `allkeys-lru` namespace | SRC | CP-13 | OPEN |
| | F-OPS-05 | Outbox, job and receipt-matcher workers dormant | SRC | CP-13, CP-17 | OPEN |
| | (P2) | `POST /api/recurring/detect` returns 500 | HTTP | CP-13 | OPEN |

### 2.7 Organisation and rules (CP-14)

| Codex | Fable | Title | Verification | CP | Status |
|---|---|---|---|---|---|
| ORG-004 | adopted | Dry-run with add_tags writes a tag link and bumps usage count; with split_transaction creates two split rows; response reports neither (category actions are pure) | HTTP+DB (Fable 14 Oct) | CP-14 | OPEN |
| ORG-005 | | Rule split allocations can exceed the parent amount | NOT EXERCISED | CP-14 | OPEN |
| ORG-006 | ORG-02, F-CLIENT-01 | Six merchant-detail endpoints the UI calls return 404 (analytics, transactions, alias add/delete, logo upload/delete); `POST /rules/:id/test` 404 | HTTP+SRC (both) | CP-14 | OPEN |
| ORG-007, ORG-008 | | Merchant delete options disagree with server behaviour; undo adjusts counts from the snapshot rather than restored rows | NOT EXERCISED | CP-14 | OPEN |
| ORG-009 | (P3) | Repeated tag removal decrements usage count; stale usage counts | SRC | CP-14 | OPEN |
| ORG-010 | F-CLIENT-02 | Saved default filter preset stored but never applied; preset create/delete UI unreachable | SRC | CP-14 | OPEN |
| | ORG-01 | `POST /api/tags/merge` returns 500 (uuid vs text in SQL) | HTTP | CP-14 | OPEN |
| | F-TXN-02 | Category picker lists only Uncategorized (form filters on a `groupType` the API never returns) | BROWSER+SRC | CP-14 | OPEN |
| | F-ACC-01 | Accounts page defaults to `ownerUserId=shared` and shows "No accounts yet" after the first account | BROWSER | CP-14 | OPEN |
| | (P2) | Rules accept non-existent action values and apply silently; tag names duplicate by case and whitespace; `includeArchived=false` ignored | HTTP | CP-14 | OPEN |

### 2.8 Investments and GRZ (CP-15)

| Codex | Fable | Title | Verification | CP | Status |
|---|---|---|---|---|---|
| | GRZ-03 | Selling a bond computes no gain or loss, credits no cash, absent from tax reports | HTTP+DB | CP-15 | OPEN |
| | GRZ-05 | Bond create accepts couponRate "14" (coupons of 70000 on 10000 face), negative face, maturity before purchase | HTTP | CP-15 | OPEN |
| | GRZ-06 | `Money.isPositive()` true for zero, so a T-bill bought at or above face makes every maturity cron run fail; cron response echoes SQL with ids | HTTP+DB | CP-15 | OPEN |
| FIN-10 | INV-01 | Buys never update `holdings.cost_basis` | HTTP+DB (Fable), SRC (Codex) | CP-15 | OPEN |
| FIN-11 | INV-02, INV-03 | Negative-quantity sell adds phantom shares; holdings via POST and SIP buys have no tax lot so selling returns 409 | HTTP (Fable), SRC (Codex) | CP-15 | OPEN |
| | INV-04 | `amount_zmw` never computed from posted FX (180 USD gain reported as 180.00 ZMW) | HTTP+DB | CP-15 | OPEN |
| | INV-07, INV-08 | Tax summary shows 0.00 interest income and ZRA export empty despite WHT taken; 31 Dec dividend counted in two tax years | HTTP+DB | CP-15 | OPEN |
| | INV-10 | Pension contributions unvalidated, unaudited, no transaction; SIP with past next-date never runs | HTTP+DB | CP-15 | OPEN |
| | F-INV-01 | GRZ, tax and pension tabs unreachable without an equity holding; `/investments/tax` link broken | BROWSER | CP-15 | OPEN |
| | (P2) | 360 vs 365-day bases, unrounded vs stored rate, tenor and maturity disagreement, fees dropped, portfolio values as floats, coupon rows unnamed and uncategorised | HTTP+DB | CP-15 | OPEN |

### 2.9 Deployment, operations, platform (CP-00, CP-16)

| Codex | Fable | Title | Verification | CP | Status |
|---|---|---|---|---|---|
| DEP-01 | F-DEP-01 | Nine production advisories (1 critical `proxy-addr`, 4 high); CI audit step would fail | RUNTIME (both) | CP-00 | OPEN |
| DEP-02 | | Node 20 pinned in `engines`, CI and render.yaml; end-of-life | SRC | CP-00 | OPEN |
| | F-SEC-04c, F-SEC-04b | `generalLimiter` mounted globally and per router (double count): 429 within three page loads; 5-per-minute per-IP auth limiter on `/api/auth/*` including `/me` blocks ordinary flows | BROWSER+HTTP | CP-00 | OPEN |
| OPS-011 | F-TEST-01 | Local Playwright can run against the dev database; root vitest config unguarded; stale tracked coverage | SRC (both) | CP-00, CP-21 | OPEN |
| OPS-001 | F-OPS-02 | Uploads on ephemeral local disk; 30 user files tracked in git; no disk in render.yaml | SRC (both) | CP-16 | OPEN |
| OPS-002 | F-OPS-03 | `/healthz` checks only the shutdown flag; readiness never probes Redis | SRC (both) | CP-16 | OPEN |
| OPS-014 | F-OPS-04 | Logger serialises a fixed field list and drops context (errors, job outcomes); `redactSensitive` unused | SRC (both) | CP-16 | OPEN |
| OPS-015 | F-OPS-06 | DB TLS certificate verification off unless explicitly configured; blueprint only comments | SRC (both) | CP-16 | OPEN |
| | F-DATA-01 | Long FK names will churn generated migrations; no tag uniqueness; admin route on a missing table | SRC | CP-16 | OPEN |
| QA-02 | F-OPS-07 | No staging, no backup restore drill, no rollback rehearsal, no load test, no real devices | explicit gap | CP-16, CP-21 | OPEN |

### 2.10 Notifications, recap, AI (CP-18, CP-19)

| Codex | Fable | Title | Verification | CP | Status |
|---|---|---|---|---|---|
| OPS-009 | VAL-01 | User-controlled names interpolated into notification and invitation e-mail HTML | SRC (Codex), HTTP (Fable, invite) | CP-18, CP-03 | OPEN |
| OPS-010 | | Notification delivery status and dedupe do not reflect per-channel outcomes | NOT EXERCISED | CP-18 | OPEN |
| OPS-006 | RC-07, SNA-REC-03, SNA-REC-04 | Recap returns zeros on missing FX (errors swallowed); e-mail labels ZMW as "$"; history shows current net worth for every week | HTTP (Fable), SRC (Codex) | CP-18 | OPEN |
| | (P3) | Login-noise notifications | HTTP | CP-18 | OPEN |
| OPS-012 | F-AI-01, AI-01 | Provider failure or no provider returns 200 with an empty or irrelevant answer; quota consumed; hard-coded retired model; status reports configuration not health; consent version reported but not enforced; no idempotency on chat; evaluation pack has no prompts | BROWSER+DB (Fable), SRC (Codex) | CP-19 | OPEN |
| CHG-AI-01 | | Claude primary, Gemini fallback, local degraded mode, consent naming both processors, shared admission ledger | specification | CP-19 | OPEN |

### 2.11 UX, device, accessibility (CP-20)

| Codex | Fable | Title | Verification | CP | Status |
|---|---|---|---|---|---|
| UX-02 | F-MOB-01 | Phone viewport: sidebar covers and clips content; reports overflow at 1280 px | BROWSER (both) | CP-20 | OPEN |
| | F-GOAL-UX-01, F-TXN-04, (P3 list) | Silent wizard validation; transfer legs indistinguishable; native `confirm()` dialogs; dead TopBar radios; disabled "Reset Defaults"; toast-only "Copy balance history"; "Good morning, User" greeting; unlabeled icon buttons | BROWSER | CP-20 | OPEN |

### 2.12a Verifier rows made explicit after the cross-read (15 October)

These rows were covered only by generic wording before; the Codex comparison was right that an agent could miss them. Ids are qualified by report because the Fable domain reports reuse prefixes.

| Report id | Title | Sev. | Verification | CP | Status |
|---|---|---|---|---|---|
| settings SET-04 | Notification preference partial update nulls omitted thresholds; arbitrary notification type accepted | P2 | HTTP+DB | CP-05 | OPEN |
| settings SEC-03 | MFA can be enabled before possession of the factor is proven | P1 | HTTP | CP-06 | OPEN |
| settings REC-05 | Recap feedback claims recorded without a structured, queryable persistence contract | P2 | HTTP+DB | CP-18 | OPEN |
| settings NOT-01, NOT-03 | Missing VAPID configuration returns 500; alert counter counts deduplicated attempts | P2 | HTTP | CP-18 | OPEN |
| settings NOT-02 | Quiet hours have no writer (backend capability without a configuration path; a completion choice, not a reproduced defect) | P2 | SRC | CP-18 | OPEN |
| budgets GOAL-03, GOAL-04 | Default partial assignment invalid; projections use a 30-day month and show remaining time on completed goals | P2 | HTTP | CP-12 | OPEN |
| F-CLIENT-02 | Filter preset create and delete controls unreachable; individual correction and delete actions missing | P2 | SRC | CP-14 | OPEN |

### 2.12 Verification system (CP-21)

| Codex | Fable | Title | Verification | CP | Status |
|---|---|---|---|---|---|
| QA-01 | | Playwright specs fill forms without submitting or assert nothing; `if (control)` guards pass silently; populated investment tab skipped | SRC (Codex, suite run) | CP-21 | OPEN |
| | (EVIDENCE §5) | Playwright smoke blocked locally by browser build mismatch | environment | CP-00 | OPEN |
| | (ADM) | Module assessment metadata, W9/W10 coverage and release notes reflect the June state | SRC | CP-21 | OPEN |

## 3. Counts

| Severity | Rows | Of which reproduced at runtime by at least one package | Of which source-only or not exercised |
|---|---|---|---|
| P0 clusters | 12 | 10 | 2 (scheduler, push egress) |
| Rows in §2 | 55 rows covering about 100 source ids (45 rated P1, 10 rated P2 or P3) | see the Verification column | 19 rows SRC-only or NOT EXERCISED |
| P2 and P3 | about 45 items listed above and in the Fable GAPS.md §3–4 | most | some |

## 4. What verifiably works (do not break it)

From the Fable verifier reports and the Codex ledger read-back, kept here so regressions are visible:

- Ledger: balances to the cent after income, expense, transfer; paired transfer legs; idempotent creates; `FOR UPDATE` under three-way concurrent goal transfers (exactly two of three succeed); five concurrent contributions summing exactly; no duplicate budget periods under concurrent recalculates; recurring materialisation exactly once per period; zero drift across 21 accounts and 89 transactions.
- Money: Money class arithmetic; budget spent and remaining to the ngwee for single-currency spend including month boundaries and splits; GRZ coupon and WHT schedule; T-bill maturity interest; FIFO tax lots; report FX conversion with the dated rate where a rate exists; category breakdown and expense classification exact.
- Security: private items 404 on direct reads; outsider 404 or 403 on every id-based endpoint except ISO-01; `/uploads` auth and traversal guard; CSRF on mutations; admin endpoints 403; lockout after five failures for 15 minutes; password reset revokes all sessions; step-up on money moves; upload extension derived from mimetype; 33 of 37 probed view-only writes denied.
- Platform: `npm run check`, 2660 server tests, 1384 client tests and the build green; versioned migrations apply from empty and match the push-built schema exactly; receipts upload idempotency and image-hash dedupe; report exports audited; AI consent gate and honest `ai_query` audit rows; conversations persisted.
