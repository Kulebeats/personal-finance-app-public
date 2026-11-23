# Comparison: 11 October (Codex) package vs 13 October (Fable) package

Written 14 October 2026 after the Fable package was closed. The Fable package was produced without reading the Codex package; this file is the first cross-read. Both assessed the same revision, `381e943`, on the same host. "Codex" below means `docs/reviews/2026-10-11-deep-readiness/`; "Fable" means this directory.

## 1. Headline (like for like, after the 14 October re-scope)

Both packages now carry the same brief: the complete application, nothing withheld, no fixed date. Both reach the same verdict, NO-GO for real household data, and price the same scope within a few days of each other. They agree on the shape of the problem (sound ledger core, broken layer around it) and, after the cross-read, on every specific defect either of them found: all 62 Codex rows now have a counterpart or an adopted row in the Fable register, and the roughly 25 Fable-only findings are acknowledged in the Codex team's own 14 October comparison. The remaining differences are evidence depth, packet shaping, and four product-contract questions listed in §9.

| | Codex (11 Oct) | Fable (13 Oct, re-scoped 14 Oct) |
|---|---|---|
| Brief | Full application, no deadline | Full application, no deadline (pilot plan withdrawn) |
| Verdict | NO-GO for real data in the current full app | NO-GO; 70.5–107.5 developer-days remain |
| Register | 62 grouped rows: 9 P0, 45 P1, 8 P2 | 11 P0 rows (clusters), about 55 P1, long P2/P3 lists, plus §1b adopting every Codex row without a counterpart |
| Evidence mix | 18 rows with runtime evidence, 44 source-only | Every P0 reproduced over HTTP with DB read-back except the scheduler (source); 3 Codex source-only rows reproduced live on 14 Oct; 13 adopted rows (14 IDs) still unverified at runtime by this package |
| Server mode | `NODE_ENV=test`: CSRF bypassed, rate limits relaxed, cookies relaxed | `NODE_ENV=development`: CSRF and rate limiters active, SMTP sink, AI key empty |
| Fixtures | 1 household, owner + member + view-only + outsider, 1 account | 5 households, 21 accounts, 89 transactions, hand-computed expected values per verifier |
| Suites | check, 1384 client, 2660 server, build, bundle green; coverage measured (client 53%, server 65% statements); Playwright 76 passed 1 skipped after installing the browser | Same suites green; no coverage run; Playwright blocked (browser build mismatch, download not approved); migrations from empty diffed against push-built schema: identical |
| Packets | 20 (P00–P19) | 21 (WP-01–WP-21) |
| Effort | 72–122 developer-days; 87–147 with 20% reserve | 70.5–107.5 developer-days; 81–124 with 15% reserve |
| Calendar | "four to seven months" for one developer, no dates | One developer: release candidate March to April 2027; two developers: late January to mid-March 2027 |
| Gates | G0–G6 | G0–G6 (same shape; adopted from the Codex plan on re-scope) |
| Acceptance catalogue | 16 journeys J01–J16 enumerated | WP-21 describes the catalogue, does not enumerate it; adopt J01–J16 |
| Specialists | 4 reports + coordinator + reviewers | 5 inventories, 6 Opus verifier reports, lead journeys, skeptic pass |
| Extra deliverable | Thandi provider spec (Claude primary, Gemini fallback, local degraded mode) | Enhancements backlog, decisions register with P0 acceptance checks, re-runnable verifier scripts |

## 2. Where the two agree (independently reproduced or traced)

These rows were found by both teams with no shared input. Treat them as settled.

| Defect | Codex | Fable | Notes |
|---|---|---|---|
| Private-account transactions readable by other members via goal links | FIN-01 P0, HTTP | PRIV-01 P0, HTTP+DB | Both reproduced the same endpoint. Fable adds `/goals/summary` and the root cause (create API never sets `transactions.is_private`) |
| Tag transaction lists ignore account privacy | ORG-002 P0, source | PRIV-02 P0, HTTP | |
| Recurring rules on private accounts visible to others | OPS-005 P0, source (recap path) | PRIV-05 P0, HTTP (`/recurring` path) | Same query, two consumers |
| Overwrite import re-run deletes rows and skips replacements | FIN-02 P0, HTTP+DB | IMP-01 P0, HTTP+DB | Identical pattern: deleted 1, imported 0 |
| Session revoke leaves the cookie valid | AH-01 P0, HTTP | SES-01 P1, HTTP+DB | Fable names the unused correct helper `session-revocation.ts` |
| Current-user and profile DTOs expose MFA codes, backup codes, token hash | AH-02 P1 | F-AUTH-02 P1 | |
| Verification e-mail links to an unrouted path | AH-03 P1, source | F-AUTH-01 P1, browser+DB | |
| Add Member posts to a missing route; no invite acceptance page; "Unknown User" | AH-05 P1, HTTP | F-HH-01, SEC-02, F-HH-03 P1, browser+HTTP | |
| Invite acceptance does not check the recipient | AH-06 P1, source | SEC-01 P1, HTTP+DB (joined as admin on an invite addressed to nobody@) | |
| Profile save drops offered fields and reports success | AH-07 P1, HTTP | SET-01 P1, HTTP+DB (14 of about 22 fields) | |
| Data export is a stub; erasure incomplete | AH-08 P1 | DATA-01, DEL-02 P1 | |
| Budget progress sums currencies without conversion | FIN-06 P1, source | BGR-01 P0, HTTP+DB | |
| "Historical averages" writes multi-month totals as monthly budgets | FIN-07 P1, source | BGR-03 P1, HTTP+DB (550.00 where 183.33 expected, 79 zero budgets) | |
| Buys never update cost basis | FIN-10 P1, source | INV-01 P1, HTTP+DB | |
| Automated buys create no tax lot, so later sells fail | FIN-11 P1, source | INV-03 P1, HTTP (409) | |
| Investment schedules miss overdue runs and drift at month end | FIN-12 P1 | INV-10, REC-02 P2 | |
| CSV accepts non-existent dates; ambiguous dates parsed silently | FIN-15 P1, executed parser | IMP-03 P1, HTTP+DB | |
| Transaction summary stale after writes | FIN-17 P1, browser+source | F-TXN-01, RC-06 P1, browser+HTTP | Codex found the client query-key mismatch; Fable found the UTC month range and the dated-rate miss. Both are needed |
| Monthly trends "Invalid Date" | FIN-18 P1 | F-REP-01 P2 | |
| Uploads on ephemeral disk | OPS-001 P1 | F-OPS-02 P1 | |
| No scheduler drives the cron endpoints | OPS-003 P1 | F-OPS-01 P0 | |
| Recap returns zeros on missing FX | OPS-006 P1 | RC-07 P1 | |
| Recap content preferences not applied | OPS-007 P2 | SNA-REC-01 P2 | |
| Unescaped names in e-mail HTML | OPS-009 P1 | VAL-01 P2 (invite HTML only) | |
| Health check does not probe Redis | OPS-002 P1 | F-OPS-03 P2 | |
| Logger drops context fields | OPS-014 P1 | F-OPS-04 P2 | |
| DB TLS verification off | OPS-015 P1 | F-OPS-06 P1 | |
| Merchant controls call missing routes | ORG-006 P1 | ORG-02, F-CLIENT-01 P1 | |
| Local browser suites can hit the dev DB | OPS-011 P1 | F-TEST-01 P2 | |
| Phone layout unusable | UX-02 P1 | F-MOB-01 P1 | |
| First-run error cascade | UX-01 P1 | F-UX-01 P3, F-ONB-01 P2 | |
| MFA has no enrolment UI | AH-11 P2 | F-SEC-05 P1 (public launch) | |
| Fake premium panel and dead controls | AH-13 P2 | F-HH-02 P2 | |
| AI returns a confident non-answer on provider failure | OPS-012 P1 | F-AI-01 P1 (hide) | |
| Nine production advisories incl. critical proxy-addr | DEP-01 P1 | F-DEP-01 P1 | Same list |
| Transaction audit not atomic / money writes without audit rows | FIN-16 P2 | RC-13, F4 P1 | |
| Unverified registration session can use the API | AH-04 P1, HTTP | F-AUTH-03 P2, DB+source | See §3 |

## 3. Same defect, different severity

| Row | Codex | Fable | Which reading to adopt |
|---|---|---|---|
| Session revoke ineffective | P0 | P1 | Fable's P1 assumed a pilot of trusted households. For any public audience Codex's P0 is right; it is in the pilot-blocking set either way |
| Budget currency summed unconverted | P1 | P0 | Fable reproduced the wrong number with DB read-back; a budget that shows K50 for 50 USD is money corruption, so P0 |
| No scheduler | P1 | P0 | Fable rates it P0 because recurring, rollover, snapshots and FX never run at all in the declared deployment; functionality blocker rather than a defect |
| Unverified session has API access | P1 | P2 | Depends on DEC-02. With Fable's F-AUTH-04 (verification impossible from another browser) the two together mean a verification policy cannot currently be enforced at all; adopt P1 until DEC-02 is decided |
| Health, logger, Invalid Date, first-run toasts, local e2e DB | P1 | P2/P3 | Codex's full-product brief makes these P1; for a pilot Fable's P2 holds. Not a disagreement about facts |
| Recurring schedule drift | P1 | P2 | Fable hides investments for the pilot; Codex ships them |
| MFA UI | P2 | P1 for public | Same position, different launch scope |

## 4. Found by Codex only

Rows with no Fable counterpart. Two were checked against source for this comparison.

| Codex row | Claim | Fable position after cross-read |
|---|---|---|
| ORG-001 P0 | `professional` role is absent from the `requireRole` hierarchy, so `undefined < n` is false and the guard passes | Confirmed in source at `server/middleware/validateEntity.ts:266-301` on 14 Oct. Reachable only if a professional membership exists (the invite controller rejects the role), so P1 fail-open bug rather than P0; add to WP-01 |
| FIN-03 P0 | Account-level overwrite soft-deletes transactions of one account only, so a transfer loses one leg | Confirmed in source at `server/services/ImportService.ts:279-352`: selects by `accountId`, adjusts one balance, no paired-leg path. Add to the IMP-01 cluster in WP-05 |
| ORG-003 P0 | Rule actions accept category, tag, owner and split-category ids from another household | Reproduced live on 14 Oct with DB read-back: an A5 member's rule wrote household A4's category and tag onto an A5 transaction. Adopted as P0 (GAPS.md §1b), WP-06 |
| OPS-008 P0 | Push subscribe stores any HTTPS endpoint and the server later connects to it | Fable's settings verifier observed the same accept-anything behaviour and did not rate it. Agree: SSRF-class, P0 once push is enabled; adopted into WP-17 |
| AH-09 P1 | View-only member can PUT household preferences | Reproduced live on 14 Oct: the view-only write landed in the household-level `household_preferences` row and the admin read it back. Fable's F-SEC-01 was wrong to call it per-user and returns to P1 |
| ORG-004 P1 | Rule dry-run writes tags, aliases and splits | Reproduced live on 14 Oct: an add_tags dry-run created a tag link and bumped the usage count; a split_transaction dry-run created two split rows; the responses reported neither. Fable's 13 Oct evidence covered a set_category action only, which is pure |
| FIN-04 P1 | Account-detail import imports zero rows (uuid type mismatch) | Not exercised by Fable (global import path only) |
| FIN-05 P1 | Import and recurring persist `currency = NULL` | Fable noted the same at P3 (X-01) and under-rated it; adopt P1 within WP-07 |
| FIN-08, FIN-09, FIN-13, FIN-14 P1 | Split-edit staleness; goal link lifecycle; account type and opening-balance edits; valuation errors swallowed into an understated net worth | Not exercised by Fable. FIN-14 is credible from the cited catch in `AccountReportingService.ts`; all four belong in the WP-07 property suite |
| AH-10 P1, AH-12 P2 | MFA code consumption not atomic; password change bypasses policy | Not exercised |
| OPS-004, OPS-010, OPS-013 P1 | OCR worker vs production CSP; notification status not per channel; scheduler locks without lease renewal | Not exercised; OPS-013 is consistent with Fable's inventory note on `allkeys-lru` |
| ORG-005, ORG-007, ORG-008 | Rule splits can exceed parent; merchant delete options and undo counts | Not exercised |
| DEP-02 P1 | Node 20 is end-of-life; CI and manifest still pin it | Fable recorded the pin as a parity caveat only. Adopt as part of WP-13 |
| QA-01 P1 | Several Playwright specs fill forms without submitting or assert nothing | Fable could not run Playwright and did not read the specs for vacuity. Adopt; it changes what "e2e green" means in the Fable launch checklist |

## 5. Found by Fable only

| Fable row | Claim | Why Codex did not see it |
|---|---|---|
| ISO-01 P0 | Outsider household reads `GET /api/goals/:id/activity` | Codex probed goal detail, which is scoped; the activity endpoint was not probed |
| RC-01 P0 | Ratios and debt analysis convert nothing, even with rates present | Endpoint not covered by Codex's financial review |
| GRZ-01, GRZ-02 P0 | Principal repayment booked as income; sold bonds keep paying coupons and principal | Codex treated GRZ as "record-only is a settled contract" and did not drive the payment endpoints |
| F-AUTH-04 P1 | Verification and e-mail-change verification are impossible from any browser other than the registering one (CSRF token bound to an unsaved anonymous session) | Invisible under `NODE_ENV=test`, which bypasses CSRF |
| F-SEC-04b/c P1 | Self-inflicted 429s within three page loads; 5-per-minute auth limiter blocks ordinary flows | Invisible under `NODE_ENV=test`, which relaxes limiters |
| F-TXN-02 P1 | Category picker shows only Uncategorized (client filters on a field the API never returns) | Codex's browser journey created an expense without choosing a category |
| F-REC-01 P1 | Recurring rules cannot be created from the UI (400) | UI path not driven |
| F-ACC-01 P1 | First account hidden by the default "shared" filter | Not observed; Codex's fixture may have used a different entry path |
| SEC-06, SEC-07 P1 | Transfer ownership to self leaves the household ownerless; a second owner can demote the first | Not probed |
| RC-02, INV-06 P1 | `fx_rates` and `securities` are global and writable by any member of any household | Not probed |
| RC-03, RC-04 P1 | Card purchases reduce the liability and leave expenses | Codex fixture had no liability account |
| RC-05 P1 | Splits missing from budget comparison, transactions report, Sankey and both CSV exports | Related to Codex FIN-08 but a different defect (readers drop split rows entirely) |
| BGR-02 P1 | Rollover is gated on a preference nothing can set | Not probed |
| RCP-01, RCP-02 P1 | Receipt create-transaction repeatable (double charge) and accepts negative amounts | Codex did not execute receipt flows |
| ORG-01 P1 | Tag merge returns 500 | Not probed |
| INV-04, INV-07, INV-08 | ZMW amounts never computed from posted FX; tax summary zero despite withholding; dividend counted in two tax years | Not probed |
| DEL-01 P1 | Deleted user's express session row survives | Not probed |
| SET-02 P1 | No route writes `user_preferences`; every save returns 200 | Codex AH-07 covers profile only |
| F-DATE family P2 | Naive timestamps written in two clocks (+2h skew, "accepted before created") | Host-specific; Codex ran with `timezone: UTC` users |
| GRZ-05, GRZ-06, GOAL-01, REC-03, REC-04, SET-05 | Validation and edge defects | Not probed |

## 6. Effort reconciliation (same scope)

| Area | Codex packets | Days | Fable packets | Days | Note |
|---|---|---|---|---|---|
| Environments, dependencies, runtime, operations | P00, P18 | 6–10 | WP-12, WP-13 | 6–9 | Agree |
| Sessions, DTOs, verification, MFA UI, credential policy | P01, P02, part of P05 | 5–9 plus | WP-02, WP-03, WP-16 | 4.5–7.5 | Agree |
| Household lifecycle and roles | P03 | 4–7 | WP-04 | 4–6 | Agree |
| Privacy and authorisation matrix | P04 | 3–5 | WP-01 | 3.5–6 | Agree |
| Settings, export, erasure, shared views | P05 (less MFA) | about 9–16 | WP-10, WP-11 | 5–7 | Largest gap: Codex prices profile schema, erasure states and shared-view entitlements as four deliverables; Fable prices export and deletion and leaves shared views to WP-04's removal of the fake panel. Reprice after DEC-10 |
| Ledger, currency, cache, reports, cash flow | P06, P13 | 7–11 | WP-07 | 9–13 | Fable higher: it adds ratios conversion, liability sign, global FX scoping and the property suite |
| Import and export | P07 | 3–5 | WP-05 | 4.5–6 | Fable higher: pair-aware overwrite and account path |
| Budgets, goals, recurring, jobs | P08, P09, P11 | 8–14 | WP-08, part of WP-12 | 4–6 | Codex higher: it prices goal lifecycle and job registry separately; Fable folds goal links into WP-07 and the registry into WP-12 |
| Investments and GRZ | P10 | 4–7 | WP-09 | 6–8 | Fable higher: bond state machine and principal convention Codex did not identify |
| Organisation and rules | P12 | 3–5 | WP-06 | 4–7 | Fable higher after adopting ORG-003/004/005 and the merchant endpoints |
| Receipts, OCR, durable storage | P14 | 2–4 | WP-18 | 2–4 | Agree |
| Notifications, push, recap | P15 | 3–5 | WP-17 | 3–5 | Agree |
| Thandi AI | P16 | 4–7 | WP-19 | 4–7 | Agree on size; contract differs (§9) |
| UX, accessibility, devices | P17 | 3–5 | WP-14, WP-20 | 4–7 | Agree |
| Acceptance, soak, drills, honest e2e | P19 | 5–8 | WP-15, WP-21 | 8–11 | Fable higher: e2e rewrite and 14-day soak priced explicitly |
| Total | | 72–122 | | 70.5–107.5 | Overlap 72–107.5; with reserves 87–147 vs 81–124 |

The two totals were produced independently, from different decompositions, and land within 2% at the low end and 12% at the high end. The packet-level differences cancel: where Codex is higher (settings, goals, jobs) Fable is lower, and where Fable is higher (money, import, investments, acceptance) Codex is lower. Neither was compressed to fit a date; the Codex team's own 14 October comparison reaches the same conclusion.

## 7. What each package should take from the other

Changes the Fable package made on 14 October after this cross-read (all applied; see GAPS.md §1b, COMPLETION_SPEC.md, LAUNCH_PLAN.md):

1. Adopted the owner's current brief: full application, nothing withheld, no fixed date. The pilot plan and the "Hide" dispositions are withdrawn; the full-product estimate is 70.5–107.5 developer-days, within the Codex band.
2. Added ORG-001 (role fall-through, confirmed in source) to WP-01 and FIN-03 (one-legged overwrite, confirmed in source) to WP-05.
3. Reproduced ORG-003, ORG-004 and AH-09 live with DB read-back and adopted them (P0, P1, P1); F-SEC-01 returned to P1.
4. Added OPS-008 (push endpoint SSRF) to a new notifications packet WP-17 as a precondition for enabling push.
5. Raised the null-currency row X-01 from P3 to P1 inside WP-07 and added FIN-08/09/13/14 to the WP-07 property suite; raised F-AUTH-03 to P1 alongside AH-04.
6. Added DEP-02 (Node 20 end-of-life) to WP-13, QA-01 and OPS-011 to WP-15, OPS-013 to WP-12, and new packets for receipts/OCR (WP-18), the Thandi provider layer (WP-19), accessibility (WP-20) and integrated acceptance (WP-21).

Changes the Codex package should make:

1. Add ISO-01, RC-01, GRZ-01 and GRZ-02 as P0; they are reproduced with DB read-back and GRZ-01/02 contradict the "record-only is safe" position.
2. Re-run its probes with `NODE_ENV=development` or production mode; F-AUTH-04 and F-SEC-04c are production-breaking and cannot be seen in test mode.
3. Drive the UI entry paths for categories, recurring rules and the accounts page; three of Fable's pilot-blocking P1s are client wiring that no API probe reveals.
4. Add liability-account and split fixtures to the financial dataset (RC-03/04/05).
5. Record the ownership-transfer and global FX-table findings (SEC-06/07, RC-02).

## 8. What still differs after the re-scope

These are the differences that remain once both packages describe the same product. Each needs an owner decision or a merge, not more assessment.

| Question | Codex position | Fable position | Resolution |
|---|---|---|---|
| Thandi contract | THANDI_PROVIDER_SPEC is the requirement: Claude primary, eligible Gemini fallback, clearly labelled local degraded mode, owner/admin household consent, atomic shared spend reservations, no erasing of possible external spend on failure | WP-19 adopts the provider spec only if DEC-11 confirms it, and proposes a 503 "unavailable" state with no quota consumed on failure; no local degraded mode | DEC-11. If the owner confirms the 11 October spec, WP-19 takes it as written and the 503 state becomes the last fallback after the local degraded mode; spend accounting follows the Codex rule |
| Professional role | Mandatory: an approved permission matrix and full support, because the UI already offers it | DEC-12 allows either implementing the matrix or removing the role from UI and enum | DEC-12. Removal is cheaper by 1–2 days and honest if nobody needs the role; implementation is required if the role is advertised at release |
| Settings and data-lifecycle sizing | P05 12–20 days as four deliverables | WP-10 plus WP-11 5–7 days | Reprice after DEC-10 (retention and field policy); expect the Fable figure to rise toward the Codex one if every offered profile field and the shared-view entitlements must work |
| GRZ conventions | Preserve record-only holding creation; coupon and maturity income separate; no silent assumed yield; no principal-as-income finding recorded | Record-only preserved; principal must not post income (GRZ-01); sold or matured bonds must not pay (GRZ-02); state machine and validation added | Compatible. Codex should add GRZ-01/02 (its own 14 October comparison already lists the bond payment lifecycle as a miss) |
| Acceptance catalogue | J01–J16 enumerated with role, money oracle, failure case and production-mode evidence | WP-21 describes the same catalogue without enumerating it | Adopt J01–J16 verbatim as the WP-21 catalogue and add the Fable verifier scripts and 14 Oct probes as oracles |
| Calendar | No dates, four to seven months | Projected release candidate March to April 2027 (one developer) | Not a conflict; Fable's projection sits inside the Codex range |
| Reserve | 20% | 15% | Use 20% until the first two gates have produced throughput data |
| Runtime mode for future verification | Test mode (CSRF and limiters off) | Development or production mode | Production-mode staging for everything after G0; both packages now say so |

## 9. Confidence summary

| Claim | Basis |
|---|---|
| Both packages are right that the app is NO-GO | 36 independently converging rows, 10 of them reproduced live by both |
| Fable's P0 list is more complete on money and isolation | 4 P0s (ISO-01, RC-01, GRZ-01, GRZ-02) absent from Codex, each with DB read-back |
| Codex's register is broader on operations and organization | 12 operations and 6 organization rows Fable did not exercise; 2 of its source-only P0s verified in source for this comparison |
| Codex's runtime evidence is thinner | 44 of 62 rows are source-only; Fable's P0s are all runtime except the scheduler |
| Codex's test-mode server hid two production P1s | CSRF and limiter findings require a non-test server |
| Effort estimates agree once scope is aligned | 50–83 vs 44–64 on the overlapping scope; after the 14 Oct re-scope to the full product, 72–122 (Codex) vs 70.5–107.5 (Fable) |
| Three Codex source-only claims the Fable package doubted were right | ORG-003, ORG-004 and AH-09 reproduced live on 14 Oct with DB read-back |
