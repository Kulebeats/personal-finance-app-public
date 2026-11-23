# SIP forward calendar repair: bounded local evidence

## Source and contract

Canonical base eb29005b5b4fd0a4e85815c70e57d543b90b6af7 contains the accepted account/SIP composition. Test-only84689e699e394f834f62212a0b2399e5ce0fd3b9 adds two test-file changes. Product5cad0b3c28b2080706c9a0ac7386adcbb85808aa changes only server/services/investment/processDueInvestments.ts; those tests are unchanged. Author checkout: C:/Users/USER/.codex/worktrees/capital-sip-calendar-forward-nov09/personal-finance-app, branchcodex/sip-calendar-forward-nov09.

Independent Astra approved the contract, fixtures, exact product and operators. Separate Sol TypeScript review found no actionable introduced issue. The repair uses the current locked, validated authorization's initial date as an anchor day and advances from the stored due date using the existing UTC calendar helper. Daily/weekly/biweekly add1/7/14 days; monthly/quarterly/semiannual add1/3/6 months; annually/yearly add one year in the current due month. Custom and unknown frequencies refuse before the helper's default fallback. The original greater-than-today guard remains before purchase.

Only a stored due-today cursor executes. Eligibility, UTC today, authorization, quotes, financial dates, purchase/lot/proof/audit transaction boundaries and rollover behavior are unchanged. No migration or inferred legacy anchor was added. Existing drifted cursors are not historically rephased. Current-grant reconfirmation retains its initial terms; a new explicit grant after purge does not restore an erased historical anchor by inference. Full overdue catch-up, persisted schedule policy, durable occurrence fencing and rollover authority remain separate requirements.

## Exact evidence and reachability

Raw receipts are in the author checkout's .local directories below. Root serialized protected runtime, database and compiler commands on pinned Node24.22.0 and the approved PostgreSQL18.6 loopback55432 cluster. No shared/production database or external delivery was used.

| Receipt | Exact source and result | Qualification |
| --- | --- | --- |
| astra-sip-calendar-unit-red44a | Test-only846:6cases,0pass/6fail,no pending,exit1;4 hashes independently verified. | Four timezone cases prove actual offsets then reach18 soft calendar comparisons each;60 comparisons fail. Two new adapter-refusal expectations fail, but existing executor nonadvance guard already prevents custom execution. No import/fixture failure. |
| astra-sip-calendar-executor-red44b | Test-only846:26cases,22pass/4fail,no pending,exit1;20 hashes independently verified. OID1928369/29 migrations, READ COMMITTED, all6primary/9scope/7investment PRE/POSTzero. | Genuine purchases precede wrong next-date assertions (March3/March2/October1). Rollback witness and no-effect checks reach before retry's wrong date. Later chain reconfirmation/overlap/restoration are unreached in RED. All20 old cases and two new eligibility/custom controls pass. |
| astra-sip-calendar-unit-green44c | Product5cad:6/6, no pending,exit0;4 hashes independently verified. | All four timezone checks,72 literal calendar comparisons and both unsupported-frequency cases pass; these are6 tests, not74 tests. |
| astra-sip-calendar-callers-green44d | Product5cad:100/100 across exact6 suites,no pending,exit0;20 hashes independently verified. OID1931479/29 migrations, READ COMMITTED, all6primary/9scope/7investment PRE/POSTzero. | 26 executor +33 private-caller +14 sale +3 composition +22 legacy-FX +2 concurrency. All formerly blocked chains now reach and pass. |
| astra-sip-calendar-project44e | Product5cad:all9 project steps exit0 with fresh compiler cache and clean matching source. | Accepted:11 hashes and all9 actual package check steps verified; manifest69AA1DC9E2612DCF273039A7DF0BDCDF1E812998E082C20DF696DC7E3FFD40B5. Logs still report0/22 final-ready modules. |

RED44a manifestC03672EC7F25FD5E04AA274B2BB57A29A54ED24C6DF227E7863106636CCCB4D8; RED44b A358F151132467CF8268288816F9540A3607DAD137850F68FED0C035C2E5F5D9. GREEN44c manifest4A76F27DF500D51AF1B32E5DF779257B859F906DFAA136EB69BD5A2416546799; GREEN44d50C72E42B06EEA7A92E2306D9F3AA63D064506D7DED53A151157432B9FB6C974. Preserve these raw artifacts and synthetic targets.

The signed tests use real login/create/reconfirm and database grant/purchase timestamps. Only executor ticks use a scoped synthetic Date clock. GREEN reaches all three purchase ticks through short months, real reconfirmation between August/September ticks, immutable original terms, exact BUY/lot/proof/reservation/system-audit/log counts, unchanged cash, same-day retry and a success-log fault with a nontransactional sequence witness followed by successful retry. Concurrent invocations produce one winner, but no barrier forces both workers to discover the same stale candidate; do not claim a forced stale-read race. This is actual local executor/DB behavior, not a deployed scheduler or native-browser scheduling journey.

## Preserved diagnostics and integration boundary

Independent review caught an inherited18-suite list in held44b before execution; corrected final44b selects exactly one suite. The original unexecuted source06D7 is retained as .local/root-operators/run-sip-calendar-executor-red44b.held-suite-list.ps1. Snapshot checkout line endings were restored to reviewedLF bytes only after normalized equality, with no Git content diff. No failed baseline was repeated unchanged.

The Sol reviewer reported an incidental default Node22 runtime guard failure, followed by pinned24 runtime guard and non-emitting/nonincremental compiler exit0. Root waited for that existing compiler session85631/PID11468 to finish and verified its absence before starting protected44c/d/e. These reported diagnostics do not substitute for the sealed root project44e evidence. No concurrent test/compiler window was used.

This acceptance document and CAMPAIGN amendment are intended as documentation-only descendants of tested5cad. Final independent exact-document review and verified local fast-forward are required before reporting integration. No new build/browser evidence is claimed; prior43 build/browser results retain their original tested source. All101 master closure groups and full FIN-12/R13/R14 remain OPEN. Separate R08/C2/R09 ownership and all push/PR/main/shared-production/provider/message/deployment/release gates remain intact.

