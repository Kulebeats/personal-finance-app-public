# G. Full-application delivery plan and release checklist

Revised 14 October 2026 for the owner's current brief: the complete existing application with every advertised feature working, no feature withheld, staging as a continuous proving environment, and no fixed launch date. The 13 October version of this file planned an invited pilot for 11 November with Investments, AI, receipts, push and recap withheld; that plan is withdrawn and kept only in git history.

Capacity baseline: one primary developer, about 20 working days a month, owner available for decisions within 48 hours. Dates below are projections from the packet arithmetic in COMPLETION_SPEC.md, not commitments; the plan is driven by gates.

## 1. Effort

| Scope | Packets | Developer-days |
|---|---|---|
| Full application: every P0 and P1 in GAPS.md incl. §1b, every advertised module working | WP-01 … WP-21 | 69.5–105.5 |
| With a 15% integration reserve | | 80–121 |
| Optional Phase B of WP-19 (Gemini failover and spend ledger) | | 2–4 more |

Cross-check: the 11 October package priced the same scope at 72–122 days (87–147 with its 20% reserve). The two estimates were produced independently and agree within their bands; the unbuffered overlap is 72–107.5 days and the buffered overlap 87–124 days. Neither was compressed to fit a date.

Projection for one developer starting Thursday 15 October 2026, allowing one week over Christmas and New Year:

| Milestone | Low estimate | High estimate |
|---|---|---|
| Build complete (all packets merged, WP-21 started) | Friday 12 February 2027 | Friday 9 April 2027 |
| Release candidate after UAT and 14-day soak | Friday 5 March 2027 | Friday 30 April 2027 |

Two developers (one BE-leaning, one FE-leaning) do not halve this: WP-01, WP-07 and WP-12 are shared dependencies. Realistic two-developer projection: build complete late December 2026 to mid-February 2027, release candidate late January to mid-March 2027.

## 2. Definition of finished

Every advertised feature has a complete user journey, correct and authorised API behaviour, persisted data that reconciles independently, useful failure and retry states, and production evidence on staging. All P0 and P1 rows close with a regression test and runtime evidence at the candidate SHA. P2 and P3 rows are fixed in the hardening phase or deferred only by a recorded owner decision. No module is declared ready from source inspection, a success toast or a green mock-only test.

## 3. Phases and gates

| Phase | Packets | Exit gate (all must hold) |
|---|---|---|
| 1. Foundations (weeks 1–2) | WP-13, WP-02, WP-03, WP-12 configuration, DEC-01…13 recorded | G0: staging provisioned from render.yaml with CRON_SECRET, SMTP, TLS CA, durable uploads; `/healthz` 200 with DB and Redis checks; CI green on the supported Node LTS; `npm audit --omit=dev` exit 0; verification works from a second browser |
| 2. Identity and tenant boundary (weeks 2–4) | WP-01, WP-04, WP-10, WP-16 | G1: role matrix test green for owner, admin, member, view_only, professional and an unknown value; two-browser invitation accepted; no private or cross-household row on any read, export or aggregate; DTO key-list test green; revoked cookies denied |
| 3. Financial core (weeks 4–8) | WP-05, WP-06, WP-07, WP-08 | G2: reports verifier fixture reproduces every hand value; property suite green including edits and deletes; overwrite import idempotent and pair-safe; dry-run writes nothing; summary agrees with list within one request; two consecutive days of cron evidence on staging |
| 4. Investments, data rights, outbound (weeks 8–12) | WP-09, WP-11, WP-17, WP-18 | G3: investments verifier hand values reproduced; sold bond cannot pay; tax summary agrees with postings; export file complete; deletion leaves no identifying row; push endpoint allow-list enforced; recap privacy test green; OCR works under production CSP |
| 5. AI, devices, accessibility (weeks 12–15) | WP-19, WP-14, WP-20 | G4: provider failure shows the unavailable state and writes no audit row; evaluation set green against a recorded provider; axe-core clean on the eight primary pages; phone layout spec green |
| 6. Acceptance and release (weeks 15–18) | WP-15, WP-21 | G5: every journey in the acceptance catalogue passed at the candidate SHA on production-mode staging; restore drill and rollback rehearsal recorded; 14-day soak without P0/P1; owner UAT signed; verifier scripts and 14 Oct probes green |
| 7. Controlled release | deploy, canary, first households | G6: post-deploy smoke green; first scheduled cron run observed in production; 72 hours without P1; expansion is an explicit owner decision |

Critical path: DEC-05/06 → staging (G0) → WP-01 (G1) → WP-07 (G2) → WP-09 and WP-17 (G3) → WP-15 soak (G5). A slip in staging provisioning moves every later gate by the same amount. Hardening of P2/P3 rows runs inside phases 4–6 as capacity allows.

## 4. First ten working days

| Days | Work | Output |
|---|---|---|
| 1–2 | Owner records DEC-01…13; provision staging; WP-13 limiter fix and `npm audit fix`; approve the Playwright browser download and run the smoke locally | Decision ledger, staging URL, CI audit green |
| 3–4 | WP-03 DTO and revocation; WP-02 link path and CSRF exemption | Two-cookie revocation test green; verification from a second browser |
| 5–7 | WP-01 isolation, privacy backfill, role guard | Privacy and role matrix tests green; 14 Oct AH-09 probe returns 403 |
| 8–10 | WP-06 rules reference validation and pure dry-run; WP-05 overwrite and pair-aware deletion | 14 Oct ORG-003/004 probes return 400 and unchanged snapshots; overwrite replay idempotent |

If a foundation takes longer, later work moves; acceptance is not weakened.

## 5. Readiness levels

| Level | Conditions | Status today |
|---|---|---|
| Continued local development | `npm run check`, server and client suites green; disposable test DBs | Met |
| Staging | G0 | Not met (nothing deployed) |
| Invited use with real data | G0–G3 plus WP-15 drills; no open P0 | Not met |
| Full product release | G0–G5 | Not met: 69.5–105.5 developer-days of work remain |

Go/no-go is binary on the gates; no score substitutes for them.

## 6. Launch-day checklist

1. Tag the release; CI green on the tag on the supported Node version; `npm audit --omit=dev` exit 0.
2. Backup taken and restore verified within the last 7 days; rollback rehearsal recorded.
3. Deploy; `/healthz` 200 with DB and Redis checks; `smoke:staging:health` green against production.
4. Canary household with a real mailbox: verification link opens and verifies; invite a second real address and accept it; create account, transaction, transfer, budget, recurring rule, goal, holding; scan a receipt; ask Thandi one question with consent.
5. Confirm the first scheduled runs (recurring, snapshots, FX, investment automation, receipt matching) in logs or DB within 24 hours.
6. Confirm rate-limit headers after a dashboard load show ample remaining budget; confirm push subscriptions from an unknown origin are refused.
7. Send invitations with the privacy notice and the "report a problem" channel.
8. First 72 hours: review 5xx and 429 counts, cron evidence, provider costs, delivery failures, support inbox; a P1 is fixed within 48 hours or the affected feature is contained and re-proved before the release is called complete.

## 7. Stopping rules

Stop release if any private or foreign data is readable or writable incorrectly, if money fails to reconcile, if a retry or concurrent run corrupts state, if accepted data can vanish on restart, if restore fails, or if identity, onboarding or exit is unusable. A small audience does not waive a production-protection blocker.

## 8. Sensitivity

- Each P0/P1 discovered on staging that is not in GAPS.md adds 1–3 days; 44 of the 62 rows in the 11 October register were source-only, and 13 rows covering 14 IDs adopted in GAPS.md §1b are still unverified at runtime, so expect some to reprice.
- If DEC-11 chooses a single provider instead of primary-plus-fallback, WP-19 shrinks by 1–2 days.
- If DEC-12 removes the Professional role from the UI instead of implementing it, WP-04 shrinks by 1–2 days.
- If DEC-08b keeps GRZ holdings-only and principal posts nothing, WP-09 shrinks by about half a day; if the owner wants cash-settled purchases, add 2–3 days.
