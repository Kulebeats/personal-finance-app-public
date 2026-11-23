# Response to the Codex comparison of the two consolidations

Reviewed: `docs/reviews/2026-10-15-consolidation-comparison.md` (Codex session, 15 October 2026). This file states, item by item, whether its criticism of the Fable consolidation is accepted, partly accepted or rebutted, and what changed in this package as a result. Nothing in the Codex package was edited.

Summary: of the fourteen contract differences C01–C14, eleven are accepted and applied, two are accepted as the default with a recorded owner decision, one is kept as a design decision with both options. All seven execution corrections in its §3 are accepted and applied. The register count criticism is accepted. One factual claim in my earlier comparison was wrong and is corrected.

## 1. Contract differences

| Item | Codex position | Response | Change made |
|---|---|---|---|
| C01 Claude credits priced at zero | Credits are a finite balance; price both legs at dated list prices and record the credit balance as the ceiling | Accepted. The owner wrote "free Claude API", which I read as free usage; a credit balance is the safer reading and a zero price would hide its consumption either way | DECISIONS R1 and CP-19 step 4 rewritten: both legs at dated list prices, credit balance with conditions and expiry as the Claude ceiling |
| C02 No key → unavailable, no audit row | A consented request with no external key still gets the local degraded answer, audited | Accepted; my acceptance line contradicted my own design and the existing keyword fallback | CP-19 acceptance rewritten |
| C03 Professional exports | Codex denies financial and report export jobs to Professional and view_only; my R2 granted them while CP-04 gated them behind member | Accepted: the contradiction was real. Adopt the narrower matrix; personal privacy export stays open to every role | DECISIONS R2, CP-03 step 4, CP-04 step 1 rewritten |
| C04 Shared views removed | Implement named household saved views; removal does not close an advertised control | Accepted as the default, recorded as an owner decision because it is a product choice with 1–2 days of cost | DEC-24 added; CP-05 gains step 5 and grows to 4–7 days; CP-03 step 6 no longer removes the control; the rules Test control is implemented, not removed |
| C05 GRZ principal posts nothing | A confirmed principal receipt retires the holding and posts one asset-to-cash settlement with ordinary income zero; destination is any authorised compatible-currency account | Accepted. "Post nothing" would leave a matured holding on the books; the settlement model keeps net worth right and income clean | DEC-08b, CP-15 step 1 and its acceptance rewritten |
| C06 Numeric defaults | 15% WHT, 5,000 step-up, 24-hour MFA re-auth are proposals, not policy; MFA enable must require proof of possession | Accepted | DEC-13 relabelled as a proposal and fixture; CP-06 requires possession proof before enable (settings SEC-03) |
| C07 Privacy predicate | Membership AND account visible AND transaction visible, two facts kept independent; no derivation on create | Accepted (the backfill was already removed). The create-time derivation is also removed; the predicate carries account privacy | CP-04 steps 2 and 3 rewritten; mismatched-owner fixtures named |
| C08 Import duplicate identity | Description does not make an identity; use batch fingerprint plus row ordinal, review cross-file candidates | Accepted | CP-10 step 3 rewritten |
| C09 FX override writers and currency backfill | Owner/admin only for household rate overrides; backfill null currency only where denomination history is unambiguous | Accepted | DEC-25 added; CP-09 step 1 and CP-08 step 1 rewritten |
| C10 Goal contribution ceiling | Target is a plan, not a hard ceiling; enforce cash only when cash moves; allow confirmed overfunding | Accepted | CP-12 rewritten |
| C11 Storage topology | Object storage from the start versus persistent disk with a driver seam | Kept as a decision with both options (DEC-06). Neither is validated; the choice depends on instance count and operator cost, which are owner inputs | None |
| C12 Jobs and notifications | Fencing generations and checkpoints; an "unknown" delivery outcome that is never auto-retried as failed | Accepted | CP-13 step 1 and CP-18 rewritten; CP-18 now depends on CP-13 |
| C13 Receipt replay and net-worth history | Identical replay returns the existing result, conflicting retry 409; history labelled incomplete rather than computed from today's values | Accepted | CP-17 and CP-09 step 6 rewritten |
| C14 Completion flag | Required-for-completion is separate from severity; P2/P3 are required unless a scope change is recorded | Accepted | CP-21 acceptance and README rewritten: every row is required unless the owner records a scope change against it |

## 2. Execution corrections (Codex §3)

| Instruction | Response | Change |
|---|---|---|
| CP-00 limiter arithmetic (400 requests against a 300 limit) | Accepted; the test contradicted the limit | Limit 600 per user per 60-second sliding window; test is five bursts of 40 with at least 300 remaining, plus a separate exhaustion test |
| CP-02 resend-verification treated as token-authenticated | Accepted; the schema takes an e-mail address | Resend stays CSRF-protected for session callers and gains a throttled anonymous variant with a non-enumerating response |
| CP-02 verify with the token hash | Accepted; the service hashes the presented token | Capture the raw token from the SMTP sink message |
| CP-04 insert a bogus role | Accepted; the enum forbids it | Inject the unknown value at the `householdGuard` seam |
| CP-01 delete-again race fix | Accepted; a second delete is not a barrier | Per-user session generation checked by the deserialiser |
| CP-16/CP-13 dependency | Accepted | Environment foundation separated from staging evidence; CP-13 may start after CP-08 and closes after CP-16 evidence |
| Inconsistent dependency model | Accepted | Dependency list corrected (CP-13 → CP-18; CP-16 evidence for closure only); the summary table is now the single source and the lane table follows it |

## 3. Register and counts (Codex §1)

Accepted. My README claimed 68 P1 rows; the §2 tables hold 55 data rows covering about 100 source ids, of which 45 are rated P1 and 10 are rated P2 or P3 and were placed there because they share a work order. README, REGISTER §3 and the status paragraph now say exactly that. Codex counted 102 because it counted ids rather than rows; neither count is a count of independently reproduced defects, as both packages say. The rounding remark (103 versus 104) is moot after the repricing: the figures are now 87–140 and 104–168, and the package says to plan against the Codex 88–145.

Also accepted from §1: the phase table's week numbers were for the low estimate only and now say so; the "ledger core is sound" sentence is narrowed to the paths that were exercised.

## 4. Coverage gaps (Codex §4)

Accepted. Seven verifier rows that were covered only by generic wording are now explicit rows in REGISTER §2.12a with their report-qualified ids (settings SET-04, SEC-03, REC-05, NOT-01, NOT-02, NOT-03; budgets GOAL-03, GOAL-04; F-CLIENT-02 preset controls) and are assigned to CP-05, CP-06, CP-12, CP-14 and CP-18. Quiet hours: Codex is right that this is a completion choice rather than a reproduced defect, and the row says so.

## 5. Points where I hold a different view

- Scheduler severity: Codex now accepts P0; no disagreement remains.
- Storage topology (C11): a decision, not a defect in either package.
- Calendar: Codex calls my dates unconfirmed assumptions. They are labelled projections with the start date and throughput stated; I would rather give a labelled range than none, and the gates are what binds.
- Defaults versus inputs: Codex refuses to default a tax rate, a retention period or a spend cap; I record a labelled default so an agent can build. After C06 the labels are explicit ("proposal", "fixture until confirmed") and nothing paid, legal or production-facing may be enabled on an assumed value, which is the Codex rule. The remaining difference is presentation.

## 6. Corrections to my earlier comparison

- I wrote that the Codex register contains CHG-AI-01. It does not; CHG-AI-01 is a row in my register. Corrected in COMPARISON-OF-CONSOLIDATIONS.md §5.
- I wrote that the packet mapping is "nearly one to one". Budgets/goals and harness/acceptance are many-to-many; the sentence now says so.
- I implied Codex R04 listed only helper files. It lists `goals.controller.ts` and `TagRepository.ts` too; the point that stands is that the other reproduced sites should be named directly.

## 7. Net effect on this package

- Effort: 87–140 before reserve, 104–168 with it; plan against the Codex 88–145 / 106–174, which prices the same scope with shared views and legacy investment reconciliation sized explicitly.
- New owner decisions: DEC-24 shared views, DEC-25 FX override writers.
- Every row in the register is required for completion regardless of severity unless the owner records a scope change against it.
- The merge recommendation in COMPARISON-OF-CONSOLIDATIONS.md §7 stands and now carries fewer open conflicts: after this response the remaining differences between the two consolidations are presentation, the storage decision, and the calendar labelling.
