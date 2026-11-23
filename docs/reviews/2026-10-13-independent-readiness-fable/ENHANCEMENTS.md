# F. Enhancement backlog and full-product definition

Mandatory repairs live in GAPS.md and COMPLETION_SPEC.md; this file lists optional product additions and defines what "the full product" means. Revised 14 October: the brief is the complete application with nothing withheld (DECISIONS.md ASM-02). Section 1 as written on 13 October described a pilot with five features withheld; it is kept below, struck through in intent, because the enhancement table still refers to its job list. Where it says "withheld", read "delivered by the named packet".

## 1a. Full product (current brief)

Every feature the application advertises today is in scope and must reach the acceptance in its packet: authentication with verification from any device and MFA enrolment (WP-02, WP-16); household membership for every role including Professional (WP-04); accounts, transactions, transfers, categories, tags, merchants, rules and presets (WP-06, WP-07); budgets with rollover and recalculate (WP-08); goals (WP-07); recurring rules created from the UI and materialised by a real scheduler (WP-08, WP-12); CSV import on both paths without data loss (WP-05); reports and cash flow that agree with the ledger in every currency (WP-07); investments, GRZ instruments, tax summary and pension (WP-09); receipts with OCR under production CSP on durable storage (WP-18, WP-12); notifications, push and weekly recap (WP-17); Thandi AI with a real provider layer (WP-19); profile and preference settings that persist (WP-10); personal-data export and account deletion (WP-11); phone layout and accessibility (WP-14, WP-20). Temporary containment of a broken surface while its packet is built is allowed and must be removed before WP-21 acceptance.

Accepted limitations after release (not advertised today): single instance; no bank connections; CSV import only; English only; no offline mode.

## 1. Superseded: proposed launch product (13 October pilot brief, no longer the plan)

Who it serves: a Zambian household of one to three adults who want to track accounts, spending and savings in ZMW, with occasional USD, on laptop and phone.

Jobs users can complete reliably at launch (each must pass its acceptance check in DECISIONS.md §5 first):
1. Create an account, log in on a second device, recover a password.
2. Set up a household with named accounts and opening balances; invite a partner and see their activity.
3. Record income, spending and transfers quickly, with categories, and trust that balances, the month's totals, the dashboard and reports agree.
4. Keep a monthly budget per category and see spent/remaining for the current and previous month.
5. Save toward a goal and see progress from assigned accounts and contributions.
6. Schedule recurring bills and have them appear on the calendar and in the ledger when due.
7. Import a bank CSV without creating duplicates.
8. Export transactions and reports as CSV.

Features enabled at launch: authentication (email verification, password reset, sessions), household and invitations, accounts, transactions, transfers, categories/tags/merchants/rules, budgets, goals, recurring, CSV import, reports and cash flow, notifications (in-app), settings (profile, display, notifications, household, members, preferences, organisation, merchants).

Features deliberately withheld at launch and how the UI handles them:

| Feature | Why withheld | UI treatment | Safety note |
|---|---|---|---|
| Thandi AI assistant | provider path returns empty answers on failure (F-AI-01); PII egress needs a signed-off provider contract and consent text | hide the Advice nav item and route behind a server flag; `/api/ai/*` returns 404 when disabled | consent and audit code stays; no shared-infrastructure issue hidden |
| Investments and GRZ instruments | money math and tax rate need owner sign-off (DEC-08); UI gate blocks GRZ for bond-only households (F-INV-01) | hide the nav item; keep endpoints behind the same role guards | GRZ ledger postings are audited (per verifier); withholding none |
| Receipt scanning (OCR) | uploads on ephemeral disk (F-OPS-02) until storage is decided (DEC-06) | hide Receipts nav; keep attachment upload off until storage is durable | upload auth code stays |
| Weekly recap e-mail and push notifications | provider configuration and consent copy not ready; VAPID unset | in-app recap widget only; e-mail toggle hidden | none |
| Pension and recurring investments | unaudited writes (server-surface F4) | hidden with investments | none |

Accepted limitations for the pilot: single instance; manual backup drill before launch and weekly after; no bank connections; CSV import only; English only; no offline mode.

## 2. Enhancements (optional additions, ranked)

Effort: S = under 1 day, M = 1–3 days, L = 4–8 days. "Before" means before the pilot launch, "After" means in the first month after, "Defer" means not planned.

| ID | Area | User problem (evidence) | Proposed behaviour | Extends | Benefit / effort / risk | Acceptance or experiment | Recommendation |
|---|---|---|---|---|---|---|---|
| ENH-01 | Onboarding | A new household lands on an empty dashboard with no categories, no accounts and no guidance (R3, F-ONB-01); time to first useful result is long | First-run checklist after household creation: seed default categories automatically, prompt for the first account with opening balance, then the first transaction; show progress until the three steps are done | household creation, `POST /api/categories/seed` | High / M / low | New user reaches a non-zero dashboard in under 3 minutes without visiting Settings | Before |
| ENH-02 | Daily entry | Adding a transaction takes six controls and a merchant lookup; categories must be found in a long list | Quick-add bar on Dashboard and Transactions (amount, merchant, category with recent-first ordering, account defaulting to last used); remember last account per device | AddTransactionModal, merchant autocomplete | High / M / low | Median time to add an expense under 15 s in a hallway test with 5 users | After |
| ENH-03 | Understanding | Dashboard "This month" and Reports disagree today; uncategorised spend is silently excluded from category views | One "money this month" definition shared by dashboard, transactions summary and reports, with an explicit "Uncategorised" bucket everywhere | reports repositories, summary service | High / M / medium (touches several read models) | Property test: sum of category buckets including Uncategorised equals total expenses for any fixture | Before (ties to F-TXN-01) |
| ENH-04 | Collaboration | Members cannot tell who recorded what; owner filter defaults hide owned items (F-ACC-01, F-TXN-03) | Show "recorded by" avatar on transactions; default filters to "All" with a clear chip; make the Shared/Mine choice persist per user | owner filter, transaction DTO | Medium / S / low | Two-member household can attribute every transaction without opening it | Before (bundle with F-ACC-01) |
| ENH-05 | Automation | Recurring rules exist but nothing runs them in production (F-OPS-01); users get no reminder before a bill | Once scheduling is fixed: "due in 3 days" in-app notification and dashboard "Upcoming bills" fed by the same data | recurring upcoming, notifications | High / S after F-OPS-01 / low | Notification row created exactly once per due item | After |
| ENH-06 | Mobile | Sidebar covers content on phones (F-MOB-01); no bottom navigation | Collapsible drawer plus a 5-item bottom tab bar (Dashboard, Transactions, Add, Budget, More) | Layout, Sidebar | High / M / low | Lighthouse mobile usability pass; all pages render at 360 px without clipping | Before (the layout fix) / After (tab bar) |
| ENH-07 | Trust | Users cannot see what happened to their data: no activity view, exports audited only server-side | "Activity" page listing the household's audit log entries in plain language (created account, imported 42 rows, exported report) | `audit_logs` | Medium / M / low | Every write in the launch scope appears in Activity within one reload | After |
| ENH-08 | Import | CSV only; bank formats differ | Import profiles per bank (column mapping saved and reused), with a preview of the first 5 rows and duplicate count before execute | ImportWizard, ImportService | Medium / M / low | Second import from the same bank needs no mapping | After |
| ENH-09 | Budgets | Budget page lists ~80 categories with "-" and no suggested amounts | "Start from last month's spend" suggestion per category and a hide-unused toggle | budgets progress | Medium / S / low | New budget created in under 2 minutes using suggestions | After |
| ENH-10 | Goals | Goals do not move money; progress depends on manual contributions | Optional auto-contribution rule (fixed amount on salary day) implemented as a recurring transfer to the goal's assigned account | recurring + goal assignment | Medium / M / medium (money-moving) | Contribution posted once per period, idempotent, audited | Defer |
| ENH-11 | Accessibility | Native `confirm()` dialogs, unlabeled icon buttons in places, exact-match active nav | Replace native confirms with the app dialog; audit labels; highlight parent nav on detail routes | shared UI | Medium / S / low | axe-core shows no critical issues on the eight launch pages | Before (confirms) / After (rest) |
| ENH-12 | Reporting | Exports are CSV only; no period comparison in exports | Add period-over-period columns and a PDF summary for the monthly report | reports exports | Low / M / low | Export opens cleanly in Excel and Google Sheets with correct number formats | Defer |
| ENH-13 | Trust | "Household Premium" fake plan panel and dead "Mine/Joint" radios erode confidence (F-HH-02) | Remove placeholder commercial copy and dead controls until real | settings, TopBar | Medium / S / none | No control on a launch page is inert | Before |
| ENH-14 | Operations | No way for pilot users to report a problem | "Report a problem" link that opens a prefilled email or form with app version, page, and request id | Layout footer, X-Request-ID | Medium / S / low | Report arrives with request id matching server logs | Before |
| ENH-15 | Security | MFA exists server-side but cannot be enabled (F-SEC-05) | Security settings: enable MFA (email code), show backup codes once, disable with password | existing MFA endpoints | High for owners / M / low | Owner enables MFA, logs out, logs in with a code from the mailbox | After (pilot) / Before (public) |

## 3. Explicitly not launch requirements

Bank integrations, PWA/offline support, subscriptions or billing, a visual redesign, multi-language, and AI advice beyond read-only summaries are not required for the pilot and are not scheduled in LAUNCH_PLAN.md.
