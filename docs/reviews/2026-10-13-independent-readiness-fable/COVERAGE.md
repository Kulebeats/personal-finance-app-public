# B. Surface, module and user-journey coverage matrix

Discovered from current wiring (client routes in `client/src/App.tsx:85-112`, server mounts in `server/routes.ts:77-193`, schema `shared/schema.ts`), not from documentation. Full inventories: `evidence/inventory-client-surface.md`, `evidence/inventory-server-surface.md`, `evidence/inventory-schema.md`, `evidence/inventory-operations.md`, `evidence/inventory-verification-system.md`.

Implementation: PRESENT / PARTIAL / MISSING / UNKNOWN. Verification: SRC (source read), TEST (automated suite), BROWSER (exercised in the app), HTTP (direct API call), DB (row read-back), BLOCKED. Finding IDs refer to GAPS.md. "Verifier" names the domain report under `evidence/domain-*.md`.

## 1. Authentication and onboarding

| Surface | Intended outcome | Entry point | Role | Impl. | Verification and result | Findings |
|---|---|---|---|---|---|---|
| Register | account created, verification mail sent | `/login` → Sign up → `POST /api/auth/register` | public | PRESENT | BROWSER+DB: 201, hashed token, session set while unverified | F-AUTH-03 |
| Email verification | link verifies the address | mail → `/verify-email` → `POST /api/auth/verify-email` | public | PARTIAL | BROWSER+DB: emailed link 404s; correct route verifies; fresh session blocked by CSRF (HTTP) | F-AUTH-01, F-AUTH-04 |
| Login / wrong password / lockout | session, generic error, lockout after N | `/login` → `POST /api/auth/login` | public | PRESENT | BROWSER: 401 generic message; lockout: verifier security-privacy (one attempt budget) | F-SEC-04b, F-UX-01 |
| MFA login and step-up | code by e-mail, step-up for money moves | `MfaVerifyForm`, `StepUpDialog` | user | PARTIAL | BROWSER: step-up on transfer works (401→200→201); MFA enrollment has no UI | F-SEC-05 |
| Password reset | mail link, reset, other sessions revoked | `/forgot-password`, `/reset-password` | public | PRESENT | BROWSER+HTTP+DB: reset 200, other session 401, session table empty | F-AUTH-05 (positive) |
| Logout and protected routes | session ended, redirect to login | Settings → Logout | user | PRESENT | BROWSER: logout 200, `/transactions` → `/login`, API 401 | — |
| Session list / revoke | see devices, revoke | Settings → Security | user | PRESENT | BROWSER renders; revocation effectiveness: verifier security-privacy | F-DATE-01b |
| First-run household | household with currency | Dashboard prompt → `/settings/household` | user | PRESENT | BROWSER+DB: 201, owner membership, tags seeded, categories not seeded | F-ONB-01 |
| Current-user DTO | safe profile payload | `GET /api/auth/me`, login/register responses | user | PARTIAL | HTTP: raw row minus password hash | F-AUTH-02 |

## 2. Household and collaboration

| Surface | Intended outcome | Entry point | Role | Impl. | Verification and result | Findings |
|---|---|---|---|---|---|---|
| Add member / invite | second adult joins | Settings → Members → Add Member → `POST /api/household/members` | owner/admin | MISSING on the UI path (server has `POST /invite`) | BROWSER: 404 HTML, JSON parse toast; invite lifecycle via API: verifier security-privacy | F-HH-01 |
| Members list | names and roles | `GET /api/household/members` | all | PARTIAL | BROWSER: "Unknown User" (field mismatch) | F-HH-03 |
| Role changes, remove, leave, transfer ownership | enforced server-side | household routes | owner/admin | PARTIAL | HTTP: self-transfer leaves no owner; second owner can demote the first; invite recipient unchecked | SEC-01, SEC-06/07 |
| Private accounts/transactions | invisible to other members on every read path | `isPrivate` | all | PARTIAL | HTTP: direct reads 404; leaks via goals, tags, recurring (verifier + skeptic) | PRIV-01..05 (P0) |
| view_only role | no writes | `requireRole` | view_only | PARTIAL | SRC: import execute, report exports/custom, recap writes lack `requireRole`; runtime: verifier | F-SEC-01 |
| Cross-household isolation | 404/403 on foreign IDs | all modules | outsider | PARTIAL | HTTP: every id-based endpoint denied except `GET /api/goals/:id/activity` (verifier + skeptic) | ISO-01 (P0) |
| Plan / shared views panel | — | Members page | — | placeholder | BROWSER: fake "Household Premium" copy | F-HH-02 |

## 3. Core ledger

| Surface | Intended outcome | Entry point | Role | Impl. | Verification and result | Findings |
|---|---|---|---|---|---|---|
| Account create/edit/archive/delete | balances tracked | Accounts → Add Account; `AccountDetail` | member+ | PRESENT | BROWSER+DB: create 201, balance/initial 1000.00; delete/archive via verifier budgets (not covered) → SRC only | F-ACC-01 (default filter hides owned), F-ACC-02 |
| Balance adjustment | correct a balance with audit | `POST /api/accounts/:id/adjust-balance` | member+ | PRESENT (API), no UI caller | SRC | F-CLIENT-02 |
| Add expense/income | ledger row, balance moves, audit | Transactions → Add Transaction | member+ | PARTIAL | BROWSER+DB: 201, balance 874.50, audit row; category picker empty; owner forced to creator | F-TXN-02, F-TXN-03 |
| Transfer | two paired legs, both balances | Add Transaction → Transfer | member+ | PRESENT | BROWSER+DB: paired legs, 674.50/700.00, step-up enforced | F-TXN-04 (display) |
| Edit / delete / bulk | persisted, audited | detail modal, bulk bar | member+ | PARTIAL | SRC: no single-delete control; bulk uses native confirm; runtime: verifier budgets/reports touched edits | F-CLIENT-02 |
| Transactions summary panel | month totals | `GET /api/transactions/summary` | all | PARTIAL | BROWSER+HTTP: 5-minute cache not invalidated on write; client UTC month range (the earlier "exclusive endDate" reading was withdrawn) | F-TXN-01, RC-06/08 |
| Split transactions | splits counted once everywhere | detail modal → split | member+ | PARTIAL | HTTP: counted once in budget progress (budgets verifier) but missing from budget comparison, transactions report, Sankey and CSV exports (reports verifier) | RC-05 |
| Attachments | file per transaction, authenticated download | detail modal | member+ | PRESENT | SRC: no upload limiter, no audit; runtime not exercised | server-surface F7 |
| Idempotency | duplicate POST does not double-post | `idempotencyKey` | — | PRESENT | SRC + TEST (`import.execute.realdb`, `create.ts` unique-index path); verifier import | — |

## 4. Organisation (categories, tags, merchants, rules, filter presets)

| Surface | Intended outcome | Entry point | Role | Impl. | Verification and result | Findings |
|---|---|---|---|---|---|---|
| Categories seed and CRUD | usable taxonomy | Settings → Organization → Categories | admin for seed | PRESENT | HTTP+DB: seed 201, 84 categories / 13 groups; CRUD: verifier import-receipts-organization | F-ONB-01 |
| Tags | attach, merge, archive | Organization → Tags | member+ | PRESENT | verifier; schema: no unique name per household | F-DATA-01 |
| Merchants | create, merge, undo, logos | Settings → Merchants | member+ | PARTIAL | SRC: client calls `/aliases`, `/logo`, `/analytics`, `/transactions` sub-routes the server lacks; runtime: verifier | F-CLIENT-01 |
| Rules | preview, dry-run, apply | Organization → Rules | member+ | PARTIAL | SRC: client `POST /rules/:id/test` has no server route; dry-run has no Zod; runtime 13 Oct: verifier (set_category dry-run pure); runtime 14 Oct: dry-run with add_tags and split_transaction actions writes tags, usage counts and split rows (ORG-004); rule actions accept ids from another household and apply them (ORG-003) | F-CLIENT-01, ORG-003, ORG-004 |
| Filter presets | save and reuse filters | `FilterPresetSelector` | all | PRESENT (API), create/delete UI unreachable | SRC; API: verifier settings | F-CLIENT-02 |

## 5. Planning (budgets, goals, recurring)

| Surface | Intended outcome | Entry point | Role | Impl. | Verification and result | Findings |
|---|---|---|---|---|---|---|
| Budget create / progress / move / recalc / rollover | spent vs planned per period | `/budget` | member+ | PARTIAL | HTTP+DB: single-currency spent/remaining exact incl. boundaries and splits, move and concurrency safe; USD counted as ZMW, rollover cannot be enabled, recalculate writes sums not averages | BGR-01 (P0), BGR-02/03 |
| Budget delete | remove a budget | `DELETE /api/budgets/:id` | member+ | PRESENT (API), no UI | SRC | F-CLIENT-02 |
| Goal create / assign / contribute / transfer / complete | progress from assigned balances | `/goals` wizard | member+ | PRESENT | BROWSER+DB: create 201 (5000.00); contributions/transfers/links: verifier | F-GOAL-UX-01 |
| Goal delete | — | API only | — | PRESENT (API), no UI | SRC | F-CLIENT-02 |
| Recurring create (UI) | rule saved | Recurring → Add Recurring | member+ | MISSING on the UI path | BROWSER: 400, `frequency`/`nextDueDate` not sent | F-REC-01 |
| Recurring materialisation | one transaction per due period, no duplicates | `POST /api/recurring/process`, `/api/cron/recurring` | member+ / scheduler | PRESENT (API) | verifier budgets-goals-recurring; production scheduling absent | F-OPS-01 |
| Skip / pause / resume / end | state changes | item menu | member+ | PRESENT | verifier | see domain report |

## 6. Imports, receipts, exports

| Surface | Intended outcome | Entry point | Role | Impl. | Verification and result | Findings |
|---|---|---|---|---|---|---|
| CSV import | rows become transactions, duplicates detected, overwrite replaces atomically | Transactions → Import wizard → `/api/import/parse`, `/execute` | member+ | PARTIAL | HTTP+DB: plain import and re-run correct; overwrite mode deletes rows and skips replacements (reproduced by verifier and skeptic); dedupe merges distinct same-day rows; invalid dates roll over | IMP-01 (P0), IMP-02/03 |
| Receipt upload / OCR / match / create | receipt stored, linked once | `/receipts` → Scan | member+ | PARTIAL | HTTP+DB: upload, idempotency, dedupe, match guards work; create-transaction repeatable (double charge) and accepts negative amounts | RCP-01/02, F-OPS-02 |
| Transaction CSV export (client) | file of visible rows | Transactions → Export | all | PRESENT (client-side only, unaudited) | SRC | — |
| Report exports | server CSV, audited | Reports/Cash Flow → Export; `/api/reports/exports` | all (no `requireRole`) | PRESENT | verifier reports-consistency | F-SEC-01 |
| Account exports (summary, transactions, balance history) | CSV | AccountDetail menu | all | PRESENT | SRC: summary and balance-history exports not audited in handler; runtime: verifier reports | server-surface F4 |
| Personal data export | DPA export | `POST /api/settings/account/export` | user | MISSING (stub) | SRC; runtime: verifier settings | F-SEC-02 |

## 7. Reading the money (dashboard, cash flow, reports)

| Surface | Intended outcome | Entry point | Role | Impl. | Verification and result | Findings |
|---|---|---|---|---|---|---|
| Dashboard widgets | agree with ledger | `/` | all | PARTIAL | BROWSER: net worth and recent transactions correct; budget widget shows K0.00 spent vs K125.50 spending | F-TXN-01 |
| Cash Flow | monthly income/expense/savings | `/cash-flow` | all | PRESENT | BROWSER: October correct; averages include future months | F-CF-01 |
| Reports (annual, spending, income, net worth, savings, merchants) | consistent read models | `/reports` | all | PARTIAL | BROWSER: totals correct, "InvalidDate" axis; cent-level reconciliation and FX fail-closed: verifier reports-consistency | F-REP-01 |
| Multi-currency / FX | every aggregate converts with the dated rate and fails closed when missing | reports repositories | — | PARTIAL | HTTP: category/cashflow reports convert correctly and fail closed; ratios/debt and budgets do not convert at all; rates are writable by any household | RC-01 (P0), RC-02, BGR-01 |
| Caching | fresh after writes | `withCache` | — | PARTIAL | SRC: in-memory; client `staleTime: Infinity` | F-UX-02 |

## 8. Investments and GRZ

| Surface | Intended outcome | Entry point | Role | Impl. | Verification and result | Findings |
|---|---|---|---|---|---|---|
| Holdings, securities, investment transactions | positions and cost basis | `/investments` | member+ | PARTIAL | HTTP+DB: FIFO lots and oversell guard work; cost basis never updated by buys, negative sells accepted, `amount_zmw` not computed | INV-01..04 |
| GRZ bonds / T-bills / coupons / sell | schedule, WHT, ledger postings consistent with the holdings-only decision | `/investments` → GRZ tab | member+ | PARTIAL; UI unreachable without an equity holding | HTTP+DB: schedule and coupon postings exact; principal booked as income; sold bonds still pay; sell computes no gain | GRZ-01/02 (P0), GRZ-03..06, F-INV-01 |
| Calculators, auctions, tax summary, ZRA export, pension, recurring investments | — | API and tabs | member+ | PRESENT (API) | verifier; pension/recurring writes unaudited per SRC | server-surface F4 |

## 9. Assistant, notifications, recap

| Surface | Intended outcome | Entry point | Role | Impl. | Verification and result | Findings |
|---|---|---|---|---|---|---|
| Thandi AI | consented, sanitised, honest failures | `/advice` | admin for consent | PARTIAL | BROWSER+DB: consent gate works; provider failure → empty 200 answer, quota consumed; unconfigured → `degraded:true`; sanitiser on all 12 tools read in source only | F-AI-01 |
| Notifications | relevant alerts | bell, `/api/notifications` | user | PRESENT | BROWSER: list/read; timestamps in the future; login noise; dedupe and budget alerts: verifier settings | F-DATE-01c |
| Weekly recap | insight widget, optional e-mail, honest on missing data | dashboard widget, `/api/weekly-recap` | all | PARTIAL | HTTP+sink: consent and e-mail toggle respected; missing FX or currency change yields zeros silently; wrong currency label in e-mail | RC-07, SET-05, SNA-REC-03 |
| Push | opt-in push | notification settings | user | PARTIAL (VAPID unset) | SRC; verifier settings | — |

## 10. Settings and account lifecycle

| Surface | Intended outcome | Entry point | Role | Impl. | Verification and result | Findings |
|---|---|---|---|---|---|---|
| Profile / display / notifications / preferences / household general / recap settings / report widgets | every offered field persists | Settings sections | user | PARTIAL | HTTP+DB: display, notifications, report widgets, investment notifications and fiscal year persist; profile drops 14 fields; preferences never persist; recap/widget settings overwrite each other | SET-01/02, SNA-REC-01 |
| Picture / banner upload | stored under household path, authenticated | Profile section | user | PRESENT | verifier settings; storage ephemeral | F-OPS-02 |
| Email change | verify new address | Security | user | PRESENT | verifier settings; fresh-session CSRF applies | F-AUTH-04 |
| Password change | re-auth, other sessions revoked | Security | user | PRESENT | verifier security/settings | — |
| MFA enable/disable | — | no UI | user | PARTIAL | SRC | F-SEC-05 |
| Account deletion / erasure | retention semantics honoured, sessions dead | `POST /api/settings/account/delete` (step-up) | user | PARTIAL (API), no UI | DB+SRC: rows erased but an express session survives and e-mail/IP remain in security audit logs | DEL-01/02 |

## 11. Operations and platform

| Surface | Intended outcome | Impl. | Verification and result | Findings |
|---|---|---|---|---|
| Versioned migrations from empty and from push-built | one schema | PRESENT | DB: identical schemas; 4.9 s from empty | F-DATA-02 (positive) |
| Health checks | truthful readiness | PARTIAL | SRC: `/healthz` shallow | F-OPS-03 |
| Scheduled jobs | recurring, rollover, snapshots, FX run daily | MISSING in the declared deployment | SRC: no trigger for `/api/cron/*` | F-OPS-01 |
| Uploads storage | durable | MISSING | SRC: local disk, no Render disk, files in git | F-OPS-02 |
| Logging / metrics / alerting | diagnosable incidents | PARTIAL | SRC: context fields dropped, no sinks | F-OPS-04 |
| Rate limiting | protects without blocking users | PARTIAL | BROWSER+HTTP: 429 during normal use; 5/min auth per IP; Redis store use read in source only | F-SEC-04b/c |
| TLS to DB, secrets, env validation | secure defaults | PARTIAL | SRC: cert verification off by default; env validated at boot | F-OPS-06 |
| Backup / restore / rollback | demonstrated | MISSING | SRC: no scripts, no drill | F-OPS-07 |
| Dependencies | no known critical advisories | PARTIAL | `npm audit --omit=dev` 1 critical, 4 high | F-DEP-01 |
| CI | gates on PR and main | PRESENT | SRC: ci.yml verify + e2e (chromium, 9 specs); e2e locally BLOCKED | F-E2E-01 |

## 12. Coverage accounting

- Surfaces enumerated: 11 groups, 78 rows above (plus 240+ endpoints in the server inventory, each mapped to a row group).
- Exercised in the browser by the lead: 21 journeys, 13 of them with a database read-back (EVIDENCE.md §4); the skeptic pass re-ran four P0 reproductions live.
- Exercised over HTTP with database read-back by the domain verifiers: see each `evidence/domain-*.md`; GAPS.md §0 states which verifier reports completed.
- Not exercised: receipt file upload through the browser UI, weekly recap wizard open, push subscription, real e-mail, external AI call, market-data fetch, deployed environment, backup restore, mobile on real devices, keyboard-only navigation beyond the forms used.
- No row is marked PRESENT solely because a unit test passes; where only source was read, the verification column says SRC.
