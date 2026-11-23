# Full application readiness assessment

Assessment: **11 October 2026**. Application: Capital / personal-finance-app. Examined revision: **381e9439afabe7c6cf829cb1cbded91d36da44ee**, local `main` and GitHub `main` matched during the assessment.

**Decision: NO-GO for real household financial data in the current full application.** The app has a substantial working foundation, but completion requires repairs to authentication, household access, financial integrity, several disconnected UI/API flows, and production operations. This is not a case of merely deploying an already finished app.

**Latest instruction governs this package:** the owner withdrew the November deadline and requested a fully functional application. The plan therefore covers the entire existing product, including integrations and advanced financial features. Feature hiding is a temporary containment option during implementation, not evidence that the full app is complete. No application code was changed by this assessment.

## Read this package

| Deliverable | Purpose |
|---|---|
| [Completion specification](COMPLETION_SPEC.md) | Required behavior, implementation packets, dependencies, acceptance cases, and enhancements |
| [Thandi provider specification](THANDI_PROVIDER_SPEC.md) | New approved requirement: Claude primary, Gemini fallback, local degraded mode; specification only |
| [Full delivery and launch plan](LAUNCH_PLAN.md) | Sequencing, effort, ownership, checkpoints, and launch decision; no fixed November deadline |
| [Evidence and verification limits](EVIDENCE.md) | Current tests, browser/database proof, safety boundaries, historical reconciliation, and unverified areas |
| [Remaining-work register](remaining-work.csv) | One row per grouped finding, priority, evidence level, packet, and current status |
| [Authentication and household review](auth-household-review.md) | Login through recovery, invitations, settings, sessions, MFA, export and account exit |
| [Financial integrity review](financial-integrity-review.md) | Accounts, transactions, transfers, imports, budgets, goals, investments, automation and reports |
| [Operations and integrations review](operations-integrations-review.md) | Storage, health, jobs, notifications, recap, OCR, AI and deployment |
| [Organization review](organization-review.md) | Categories, tags, merchants, rules and saved filters |

The specialist reports contain precise source locations, causal paths, reproductions and acceptance criteria. The completion specification and register consolidate their work; they do not add the same defect's effort twice merely because it appears in multiple modules.

## What is already real

- A modular React/Express/PostgreSQL application, versioned migrations, broad automated suites, decimal-based financial arithmetic, many row locks and atomic financial writes.
- A clean synthetic browser user completed registration, household creation, account creation and a manual expense. PostgreSQL read-back confirmed opening balance **1,000.00 ZMW**, expense **125.50 ZMW**, and remaining balance **874.50 ZMW**. Reports and cash-flow headline totals agreed with that fixture.
- Ordinary private-transaction reads denied another member, cross-household goal access denied an outsider, and a view-only member's transaction write was denied. These positive controls also helped expose alternate routes that bypass the same protections.
- Current checks, build, client tests, server tests and the executed Chromium suite passed. Passing tests demonstrate the tested behavior; they do not negate the reproduced failures below.

## The most consequential remaining work

| Current behavior | Required outcome | Evidence / finding |
|---|---|---|
| A device is reported revoked, but its cookie remains authorized | Revoke the real session as well as its tracking record, including bulk revoke and erasure | Local two-cookie reproduction; AH-01 |
| New registration can use financial APIs before verification; registration emails point at the wrong page | One consistent pending-verification policy and working email-to-browser journey | Runtime/source; AH-03/04 |
| Add Member calls a missing endpoint; invitations have no acceptance page; recipient/concurrency checks are incomplete | Complete invited household lifecycle, correct role/member DTOs, safe acceptance and removal | Runtime/source; AH-05/06 |
| Private data is protected on a direct read but leaks through related goals, exports, investments, tags or recurring recaps | One viewer-aware policy applied to every direct, related, aggregate and export path | Goal leak reproduced; FIN-01 and organization/OPS-005 source findings |
| Repeating an overwrite import deletes the original imported row and skips its replacement | Retry-safe import identity, atomic replacement and exact balance reconciliation | HTTP + database reproduction; FIN-02 |
| Import overwrite can remove only one leg of a transfer; account-detail import silently skips valid rows | Pair-preserving transfer semantics and one correct import/export contract | Source and account-import runtime; FIN-03/04 |
| Currency, split totals, goal progress, budget averages and investment basis diverge across writes/read models | Enforced money invariants and independent reconciliation fixtures across all writers | FIN-05 through FIN-14; organization rules findings |
| A new transaction appears in the list while the summary stays at zero, even after reload | Immediate agreement among list, summary, account, dashboard and reports after commit | Browser/source; FIN-17 |
| Reports show “Invalid Date” in Monthly Trends | Canonical period DTO and correct monthly/quarterly chart values | Browser/source; FIN-18 |
| Several settings claim success but do not save the offered fields; full export returns a synthetic ID | Truthful persisted forms and complete export/exit workflows | Runtime/source; AH-07/08 |
| A rules dry run can write data; role handling and split/foreign-ID validation are incomplete | A side-effect-free preview and fail-closed, household-scoped writes | Organization source review |
| Jobs, durable uploads, provider delivery, strict TLS, recovery and real staging behavior lack completed proof | Working production services plus recorded restart, outage, restore and end-to-end evidence | OPS findings and operational evidence gaps |

The profile response exposes authentication **hashes** that should be omitted from public DTOs. This is credential-material disclosure; the exposed email-verification hash is **not** a raw token that can directly be redeemed. Push has a source-confirmed outbound-destination validation gap when enabled; no attack against external/internal infrastructure was attempted.

## Coverage across all 22 indexed modules

**Built** means reachable implementation was traced. **Partial** means a confirmed defect or disconnected workflow prevents full completion. **Unverified** identifies missing runtime/production proof, not proof of absence. No module is declared fully ready from source inspection alone.

| Module | Present foundation | Exact remaining completion area | Packet |
|---|---|---|---|
| Auth | Password hashing, session rotation, reset/token services, login UI | Live revocation, safe DTOs, verification, atomic MFA, consistent credential policy, production cookies/CSRF | P01–P03, P05, P19 |
| Household | Atomic creation, memberships, role-guarded core routes | Invite UI/API/recipient binding/concurrency, member shape, supported roles, leave/transfer, boundary proof | P03–P05 |
| Settings | Profile/display/security/notification/household surfaces | Offered field persistence, shared-setting authorization, MFA management, genuine export/erasure, unsupported controls | P05, P17 |
| Accounts | Creation, balance adjustment, ordinary visibility | Unsafe denomination/type/opening edits, import/export parity, private transaction export, full lifecycle proof | P04, P06, P07 |
| Transactions | Decimal writes, locks, direct privacy, transfers, filters | Split and goal-linked edit/delete integrity, cache invalidation, audit atomicity, all write/read paths | P04, P06, P09 |
| Budgets | CRUD, category/group/flex spending and rollover code | Currency conversion, actual averages, pending/refund/private policy, month-end job proof | P08, P11 |
| Goals | Goal/contribution/assignment/link services and UI | Relationship privacy, bounded currency-aware allocation, edit/delete/unlink reversibility, complete browser journey | P04, P09 |
| Investments | Holdings, FIFO sale logic, GRZ records and race tests | Private ownership, basis/lot parity, automated purchases, overdue/calendar behavior, full lifecycle reconciliation | P04, P10, P11 |
| Recurring | Due-rule locking and deterministic occurrence writes | Currency and viewer scope, catch-up/end-date policy, deployed scheduling, missed/failure states | P04, P06, P11 |
| Dashboard | Widgets and onboarding state | Suppress expected first-run error cascade, fresh values, privacy-safe aggregates, missing-value states | P04, P06, P13, P17 |
| Reports | Multiple report families and exports | Canonical chart periods, numerical parity, incomplete FX states, uncategorized coverage explanation, full export assertions | P04, P13 |
| Cashflow | Headline totals and monthly table rendered correctly for simple fixture | Multi-currency/refund/pending/privacy reconciliation, chart/table/export parity, clear uncategorized breakdown | P08, P13 |
| Categories | Category/group CRUD and budget integration | Fail-closed roles, rule references, destructive-operation dependencies and read-back coverage | P04, P08, P12 |
| Tags | CRUD/merge and transaction filtering | Private-account visibility in tagged transactions, scope/role checks, merge/delete integrity | P04, P12 |
| Merchants | CRUD/search/merge UI and server services | Missing analytics/transactions/alias/logo routes, end-to-end merge/undo/read-back and storage | P12, P14 |
| Rules | Conditions, actions and rule editing | Non-mutating dry run, household-scoped references, exact splits, bounded/reversible application and audit | P04, P06, P12 |
| Filter presets | Saved query API and UI hooks | Role/scope consistency, allowed-field contract and actual save/reload/apply/delete proof | P04, P12 |
| Receipts | Intake, OCR client, matching services and authorized uploads | Production worker/CSP assets, durable files, retry wiring, review-to-ledger integrity and mobile behavior | P06, P11, P14 |
| Notifications | In-app records, email/push services and preferences | Safe destinations/templates, real per-channel status/retry/dedupe, quiet-hour policy and provider proof | P15, P18 |
| Weekly recap | Generation/history/email/preferences surfaces | Private recurring reads, no false zeros, currency context, respected preferences, reliable scheduling | P04, P11, P15 |
| AI assistant | Tool sanitization, consent/guardrail code and provider wrapper | Supported model, truthful typed-query disclosure, real cancellation/usage budgets, context privacy and evaluation | P04, P16 |
| Health | Liveness/readiness/deploy checks exist | Bounded real dependency probes, deployed identity, strict TLS, monitors, backup/restore and outage tests | P00, P18, P19 |

## Fresh verification results

| Check | Result at examined revision |
|---|---|
| TypeScript and repository guards | PASS; 22 indexed modules, 44 release-gate entries, **0/22 final-ready** in existing metadata |
| Client tests, including coverage run | **164 files / 1,384 tests passed**; statement coverage 53.31%, branches 45.78% |
| Server tests with isolated PostgreSQL | **201 files / 2,660 tests passed**; statement coverage 64.92%, branches 50.27% |
| Full Chromium suite | **76 passed, 1 skipped**; skipped investment tabs require holdings absent in its fixture |
| Production build / static deploy verification / bundle budget | PASS; initial client gzip 185.78 kB against 300 kB budget |
| Fresh production dependency audit | **9 affected packages: 1 critical, 4 high, 4 moderate**; remediation/applicability review remains |
| Browser + selected HTTP/database probes | Core manual ledger positive; multiple reproducible auth/privacy/import/UI failures |
| Real staging, production-mode auth, SMTP, Redis failover, recovery/load/mobile certification | **NOT VERIFIED** |

Existing E2E coverage is materially weaker than its names imply. For example, “should create expense transaction” fills fields but does not submit or assert a saved transaction. Several tests conditionally do nothing when a control is absent. The independent manual expense and database read-back in this assessment are stronger evidence for that one journey; they do not establish all transaction behavior.

## What “finished” will mean

Every advertised feature has a complete user journey, correct and authorized API behavior, persisted data that reconciles independently, useful failure/retry states, and production evidence. All P0/P1 findings affecting the full scope close with regression proof. All other accepted functionality is completed or formally redesigned with the owner; merely hiding an unfinished feature does not satisfy the requested full-app goal.

The register contains **62 grouped findings and evidence gaps: 9 P0, 45 P1 and 8 P2**, mapped to 20 completion packets. This is a prioritized register, not a claim that there are only 62 individual tasks or nine demonstrated exploits. Some grouped findings contain several affected routes.

The revised delivery estimate is **72–122 developer days of scoped work**, plus integration uncertainty and provider/owner waiting time; see the packet arithmetic and sequencing in the plan. This includes the owner's subsequent Claude-primary/Gemini-fallback requirement (+2–3 days within P16); the original assessment estimate was70–119 days. This is a planning range, not a fixed bid. Re-estimate after the first environment, import and privacy work exposes the actual repair complexity. Staging begins early and remains a continuous proving environment; it is not postponed to the end.

The assessment is complete as a source-and-local-evidence review with a completion specification. **The application is not complete, and unexecuted production checks are explicitly remaining work.**
