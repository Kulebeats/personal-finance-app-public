# A. Executive readiness assessment and release verdict

Application: Capital (personal-finance-app), `main` @ `381e9439afabe7c6cf829cb1cbded91d36da44ee`.
Assessed: 13–14 October 2026, independently of the 2026-10-11 package (not read until the cross-read on 14 October, COMPARISON-vs-2026-10-11.md).
Assessor: Claude Fable 5.1 (lead, browser and HTTP journeys, synthesis) with six Opus 5.5 domain verifiers (HTTP and database read-back against a disposable database). Evidence and method: EVIDENCE.md.

Brief: the complete existing application, every advertised feature working, no feature withheld, no fixed date. The 13 October version of this package was written against an 11 November invited-pilot brief and withheld Investments, AI, receipts, push and recap; the verdict, plan and specification were rewritten on 14 October for the full brief. The findings did not change; the dispositions did.

## Verdict

NO-GO for real household data in the current application, and 69.5–105.5 developer-days of work remain before the full product is complete.

The ledger core is sound: balances, transfers, idempotency, concurrency and the money arithmetic held under adversarial probing to the cent. What fails is the layer around it. Three defects leak private or cross-household data, a member's rule can write another household's category and tag onto a transaction, a "dry run" writes splits and tags, one import mode silently deletes real rows, one report converts currencies at 1.0, two GRZ paths fabricate income, and a long list of reachable product paths do not work: the verification e-mail link, adding a household member, picking a category, creating a recurring rule, the first account appearing, the phone layout, and background jobs that nothing schedules in the declared deployment.

| Readiness level | Today |
|---|---|
| Continued local development | Ready |
| Staging | Not ready (nothing deployed; WP-12 and WP-13 first) |
| Invited use with real data | Not ready (gates G0–G3, see LAUNCH_PLAN.md) |
| Full product release | Not ready (69.5–105.5 developer-days; release candidate March to April 2027 for one developer, late January to mid-March 2027 for two) |

## The eight answers

1. What works today, and how was it verified?
Register, log in, lock out after five failures, password reset that revokes every other session; household and account creation; income, expense and transfer posting with step-up re-authentication; balances correct to the cent after each step; paired transfer legs; idempotent creates; goal creation and contributions; recurring materialisation exactly once per period; CSV import of valid rows; receipt upload with idempotency and image-hash dedupe; category and expense-classification reports exact; report FX conversion with the dated rate when a rate exists; private items hidden on direct reads; 33 of 37 probed view-only writes denied; outsider denied on every id-based endpoint but one; CSRF, admin guards and upload authentication; AI consent gate and honest audit rows; versioned migrations from an empty database; zero balance drift across all 21 audit accounts and 89 transactions in the skeptic's reconciliation. Verified by 21 browser journeys (13 with database read-back), six verifier reports with hand-computed expected values (EVIDENCE.md §4, `evidence/domain-*.md`), an adversarial skeptic pass that reproduced four of the P0s live, three further probes on 14 October (EVIDENCE.md §4b), and green suites (`npm run check`; 2660 server tests; 1384 client tests; build; bundle budget).

2. What is unfinished, broken, or unknown?
Broken on reachable paths: verification link (404) and verification from any other browser (CSRF); add-member (endpoint does not exist) and the invite link route; category picker (empty); recurring creation from the UI (400); first account hidden by the default filter; phone layout; self-inflicted 429s; profile and preferences forms that drop fields but say "saved"; tag merge (500); six merchant-detail endpoints (404); GRZ, tax and pension tabs unreachable; data export a stub; MFA has no enrolment UI; Thandi returns a confident non-answer on provider failure; push accepts any endpoint; OCR assets conflict with the production CSP. Wrong numbers: budgets and the ratios report add USD amounts into kwacha totals with no conversion; card purchases reduce debt and leave "expenses"; splits missing from budget comparison and exports; month summary served stale for five minutes and built from UTC dates; recap zeros on missing FX; imported and recurring rows stored with null currency. Unknown (blocked): behaviour on the deployed host, real e-mail delivery, real AI provider path, backup restore, real devices, Playwright smoke locally (browser build mismatch), and 13 rows (14 IDs) adopted from the 11 October package that this package has not exercised at runtime (GAPS.md §1b; the 11 October team reproduced FIN-04 itself). Full register: GAPS.md.

3. What prevents completion?
Eleven P0 rows (GAPS.md §1 and §1b): cross-household read of goal activity; private-account transactions visible to other members via goals, tags and recurring; a member's rule applying another household's category and tag (reproduced 14 Oct); CSV overwrite data loss, including one-legged transfer deletion on the account path; GRZ principal booked as income and sold bonds still paying; USD summed unconverted into kwacha in the ratios report and in budgets; no scheduler for recurring, rollover, snapshots and FX in the declared deployment; push subscriptions that make the server connect to any HTTPS host once push is enabled. Plus about 55 P1 rows, every one of which is in scope for the full product.

4. What must be implemented or operationally completed?
Twenty-one work packets in COMPLETION_SPEC.md with acceptance tests, 69.5–105.5 developer-days (WP-19 repriced on 15 October for free Claude access): isolation and role guard; verification; safe DTOs and revocation; membership including the Professional role; import integrity on both paths; rules engine reference validation and pure dry-run; one definition of money across every read model and writer; recurring and budgets; full investments and GRZ; settings; data rights; a deployment that runs the jobs with durable uploads, real health checks, TLS and lease-renewed locks; limits, dependencies and a supported Node; phone layout; honest e2e, soak and drills; MFA UI; notifications, push and recap; receipts and OCR in production; Thandi with a real provider layer; accessibility; integrated acceptance. Operationally: provision Render from render.yaml, set CRON_SECRET/SMTP/VAPID/TLS CA, prove cron evidence, demonstrate a restore, approve the Playwright download, write the privacy notice.

5. What enhancements are worth adding?
ENHANCEMENTS.md: first-run checklist with automatic category seeding (ENH-01); one shared "this month" definition with an explicit Uncategorised bucket (ENH-03, inside WP-07); attribution and sane default filters (ENH-04); remove placeholder commercial copy and dead controls (ENH-13, inside WP-04 and WP-20); a "report a problem" link carrying the request id (ENH-14); replace native confirm dialogs (ENH-11, inside WP-20). After release: quick-add bar, bill reminders, activity page, import profiles, budget suggestions.

6. What should wait until after release?
Nothing that is advertised today. Beyond the current product: bank integrations, PWA/offline, subscriptions or billing, PDF reports, goal auto-funding, import profiles, multi-language, any redesign.

7. Is a date realistic, and under what assumptions?
There is no fixed date. For one developer at 20 working days a month starting 15 October, the build completes between mid-February and early April 2027 and a release candidate follows two to three weeks later after UAT and a 14-day soak; for two developers, late January to mid-March 2027. Assumptions: owner decisions DEC-01…13 recorded in the first week, staging provisioned in the first two weeks, no more than a handful of new P0/P1 rows surfacing on staging, and the 13 still-unverified adopted rows (14 IDs) repricing within their bands. The 11 October package independently priced the same scope at 72–122 days; before reserves the two estimates overlap at 72–107.5 days, with their respective reserves at 87–124.

8. What are the first five concrete actions?
1. Owner records DEC-01…13 (DECISIONS.md §2), in particular the verification policy, scheduler, upload storage, the Thandi provider policy, the Professional role matrix and the GRZ principal convention.
2. Developer lands WP-13 (single limiter mount, auth limiter scoped, `npm audit fix`, Node LTS) and provisions staging from render.yaml (WP-12 configuration).
3. Developer lands WP-03 and WP-02 (safe DTO, real revocation, verification from any browser), then WP-01 (isolation, privacy backfill, role guard incl. `professional`, household-policy gate).
4. Developer lands WP-06 rules reference validation and pure dry-run and WP-05 overwrite integrity on both import paths, using the 14 October probe commands as the acceptance gate.
5. Approve the Playwright browser download, run the e2e smoke, and start the WP-15 rewrite of vacuous specs so that "e2e green" means something before G2.

## Package contents

| File | Purpose |
|---|---|
| README.md (this) | verdict and the eight answers |
| COVERAGE.md | surface, module and journey matrix with verification state |
| EVIDENCE.md | identity, environments, commands, results, 14 Oct re-verification, blocked checks, historical reconciliation |
| GAPS.md | prioritised register with stable IDs; §1b rows adopted after the cross-read |
| COMPLETION_SPEC.md | twenty-one work packets with acceptance criteria and effort (full application) |
| ENHANCEMENTS.md | enhancement backlog and the full-product definition |
| LAUNCH_PLAN.md | gate-driven full-application plan, projections, release checklist |
| DECISIONS.md | assumptions, owner decisions, blocked checks, next verification steps |
| PROGRESS.md | execution ledger (resumable) |
| COMPARISON-vs-2026-10-11.md | cross-read against the 11 October package |
| THANDI_SPEC_ASSESSMENT.md | assessment of the 11 October Thandi provider specification under free Claude access; Phase A/B split |
| evidence/ | five inventories, lead findings draft, six domain reports, skeptic pass, audit output, 14 Oct probes |

Separation of completion: the assessment is complete for everything reachable on this host. Runtime verification is complete for the local audit environment and incomplete for the deployed environment, real e-mail, real AI, real devices, the Playwright smoke, and the 13 adopted rows marked "not exercised" in GAPS.md §1b. No unexecuted journey is marked as passed.
