# Consolidated completion specification and remediation plan (Fable consolidation)

> **SUPERSEDED:** Use the single [Master Completion Specification](../../plans/2026-10-15-master-completion-spec.md) for all future completion work. Corrected work-order detail and adjudicated decisions are incorporated there; this package remains historical evidence/planning context.

Application: Capital (personal-finance-app), `main` @ `381e9439afabe7c6cf829cb1cbded91d36da44ee`.
Consolidated: 15 October 2026 from two independent readiness assessments of the same revision:

- `docs/reviews/2026-10-11-deep-readiness/` (the "Codex" package: 62-row register, 20 packets, Thandi provider specification, four specialist reports), including its 14 and 15 October comparison updates in `docs/reviews/2026-10-14-assessment-comparison.md` and `docs/reviews/2026-10-15-assessment-comparison-update.md`.
- `docs/reviews/2026-10-13-independent-readiness-fable/` (the "Fable" package: six domain verifier reports with HTTP and database read-back, skeptic pass, 21 packets, cross-read and Thandi assessment).

Brief: the complete existing application with every advertised feature working, no feature withheld, no fixed date. Thandi keeps Claude as primary provider and Gemini as fallback, as the owner decided. No application code, dependency, configuration or database was changed to produce this package; it is the instruction set for the implementation that follows.

Location note: this package was first written to `docs/reviews/2026-10-15-consolidated-completion/`. A parallel session was writing its own consolidation (SPEC.md, REMAINING_WORK.md, THANDI_SPEC.md, ACCEPTANCE.md, AGENT_HANDOFF.md and a plan under `docs/plans/`) into the same directory at the same time and overwrote this package's README.md and DECISIONS.md there. The four untouched files were moved here and the two overwritten files re-created. The two consolidations have not been merged with each other; the owner chooses which governs or asks for a merge. Nothing in the other directory was edited by this session.

## Status in one paragraph

The application is NO-GO for real household data. Creation and transfer arithmetic, idempotency, locking and Money arithmetic held on every path the assessments exercised; overwrite import, liability sign, split and edit paths and the layer around the ledger did not. The union of both registers, after deduplication and the 14 October live re-verification of three disputed rows, is 12 P0 clusters and 55 further rows covering about 100 source ids (45 rated P1, 10 rated P2 or P3), every one of them open and every one required for completion. Consolidated effort is 87–140 developer-days before reserve (104–168 with the agreed 20% reserve; the Codex consolidation's 88–145 is the figure to plan against), organised as 22 work orders CP-00 to CP-21. Projection for one developer starting 19 October 2026: release candidate between mid-March and mid-July 2027 depending on the estimate and the reserve; for two developers, between early February and late April 2027. The spread is the uncertainty, not a choice.

## Files

| File | What it is | Who reads it |
|---|---|---|
| README.md | This page | Everyone first |
| DECISIONS.md | Every difference between the two assessments and how it was resolved, the defaults an agent must assume, and the decisions only the owner can make | Everyone before starting a work order |
| REGISTER.md | The unified remaining-work register: every finding from both packages, deduplicated, with consolidated severity, verification state, status and the work order that closes it | Agents claiming or closing rows; the owner tracking progress |
| COMPLETION_SPEC.md | The 22 work orders. Each one is self-contained: goal, rows closed, preconditions, files and line references, implementation steps, data changes, tests to write, acceptance criteria with numbers, runtime evidence to record, definition of done, effort, rollback | The agent executing that work order |
| REMEDIATION_PLAN.md | Operating protocol for any agent (environment, safety rules, branch and PR conventions, verification commands, evidence recording, known traps), phases and gates, dependency graph, parallel lanes, calendar projections, risk register | Every agent before the first commit; the owner for sequencing |
| ACCEPTANCE_CATALOGUE.md | The sixteen end-to-end journeys J01–J16 with independent expected values and the oracles (verifier scripts, fixtures, hand-computed numbers) that close them | Agents writing tests; whoever signs off a gate |
| RESPONSE-TO-CODEX-COMPARISON.md | Item-by-item response to the Codex session's review of this consolidation: what was accepted and changed, what was rebutted | The owner judging which corrections landed |
| COMPARISON-OF-CONSOLIDATIONS.md | How this package differs from the Codex consolidation written the same evening, the five substantive disagreements, and a merge recommendation | The owner choosing between or merging the two |

Source evidence stays where it was written and is referenced by path, never copied: Codex specialist reports and JSON evidence under `2026-10-11-deep-readiness/`, Fable verifier reports, skeptic pass and probe log under `2026-10-13-independent-readiness-fable/evidence/`, reusable scripts under `.local/readiness-fable-2026-10-13/` (git-ignored, on the assessment host).

## How to pick up work

1. Read DECISIONS.md once. If a decision you need is still marked OWNER and unanswered, apply the stated default and record that you did so in your PR.
2. Open COMPLETION_SPEC.md at your work order. Check its preconditions (earlier work orders, gates) in REGISTER.md and REMEDIATION_PLAN.md §3.
3. Follow REMEDIATION_PLAN.md §1 for environment and safety, §2 for branch, commit, verification and PR conventions.
4. Close rows only as REMEDIATION_PLAN.md §2.6 describes: failing test first, fix, passing test, runtime evidence, register row updated with commit SHA and evidence path. A success toast, a green mock, or a source read never closes a row.

## Headline numbers

| Item | Value |
|---|---|
| P0 clusters open | 12 (REGISTER.md §1) |
| Further rows open | 55 rows covering about 100 source ids: 45 rated P1, 10 rated P2 or P3; all required for completion (REGISTER.md §2) |
| Work orders | 22 (CP-00 to CP-21) |
| Effort before reserve | 87–140 developer-days (Codex consolidation: 88–145) |
| Effort with 20% reserve | 104–168 developer-days |
| Gates | G0 staging, G1 identity and tenancy, G2 financial core, G3 planning and investments, G4 integrations and AI, G5 release candidate, G6 controlled release |
| Owner decisions still open | 9 (DECISIONS.md §3), each with a default an agent may assume |

Why the consolidated estimate is higher than either source (72–122 and 69.5–105.5): it prices the union of both registers (about 25 Fable-only and 19 Codex-only findings beyond the shared core), takes the higher of the two estimates wherever the packets overlap, and includes the three rows re-verified live on 14 October that neither original estimate had as confirmed defects. The 15 October Codex update correctly observed that equal totals did not make the two AI contracts equivalent; the same applies package-wide, which is why no number here was averaged.
