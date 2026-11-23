# Comparison of the two consolidations (15 October 2026)

Two consolidations of the same two assessments were written on the same evening from the same brief (full application, nothing withheld, Claude primary and Gemini fallback, no code changes):

- Codex: `docs/reviews/2026-10-15-consolidated-completion/` (README, SPEC, DECISIONS, REMAINING_WORK.md and .csv, PACKET_INDEX.csv, THANDI_SPEC, ACCEPTANCE, AGENT_HANDOFF, SOURCE_COVERAGE, VALIDATION) plus `docs/plans/2026-10-15-full-application-remediation.md` (about 9,200 words, 22 packets R00–R21 in 66 slices).
- Fable: `docs/reviews/2026-10-15-consolidated-completion-fable/` (README, DECISIONS, REGISTER, COMPLETION_SPEC with 22 work orders CP-00–CP-21, REMEDIATION_PLAN, ACCEPTANCE_CATALOGUE).

This file compares them so the owner can pick one or ask for a merge. Section 7 is the merge recommendation.

## 1. Where they agree

| Topic | Both say |
|---|---|
| Scope | Full existing product; temporary containment allowed, never counted as completion; same list of excluded enhancements (bank feeds, PWA, auto-funding, PDF, subscriptions, languages, redesign, write-capable AI) |
| Thandi | Claude primary, eligible Gemini fallback, labelled local degraded mode, consent naming both processors, owner/admin consent authority, durable admission ledger, at most three paid calls, one exchange and one quota unit per logical request, provenance per stage, no empty success message |
| Professional role | Keep and implement as read-only shared access with no private-data override |
| GRZ | Record-only acquisition preserved; principal is never ordinary income; sold or matured instruments cannot pay; state machine |
| Privacy | Private accounts and private transactions excluded from every alternate path, count, export, report, AI context and job |
| Verification | Test mode is not release evidence; production-mode staging for gates; independent oracles, not the production helper |
| Structure | 22 packets, gates G0–G6, J01–J16, 20% reserve once, every row OPEN, no row closed by consolidation |
| Effort | Codex 88–145 (106–174 with reserve); Fable 86–138 (103–166). Written independently from the same inputs and within 2–5% of each other |
| Live re-verification | Both credit the 14 October reproductions of ORG-003, ORG-004 and AH-09 and keep FIN-03 and push egress as source-only |
| Corrections to the Fable package | Both record that the "12 unexercised rows" count was 13 rows covering 14 IDs and that the overlap figure had mixed reserve bases |

Packet mapping is mostly one to one, and many-to-many for budgets/goals and for harness/acceptance: CP-00 = R00 plus the guard half of R20; CP-01 = R01; CP-02 = R02; CP-03 = R03; CP-04 = R04; CP-05 = R05; CP-06 = R06; CP-07 = R07; CP-08 = R08; CP-09 and CP-11 together = R12 and R10; CP-10 = R09; CP-12 = goals half of R10; CP-13 = R14; CP-14 = R11; CP-15 = R13; CP-16 = R19; CP-17 = R15; CP-18 = R16; CP-19 = R17; CP-20 = R18; CP-21 = R21 plus the e2e half of R20.

## 2. Register and severities

| | Codex | Fable |
|---|---|---|
| Rows | 101 grouped closure items: 17 P0, 72 P1, 12 P2 | 12 P0 clusters, 68 P1 rows, P2/P3 tail listed by domain |
| Identifiers | Original 62 Codex ids kept; Fable findings regrouped as NEW-01 to NEW-39; SOURCE_COVERAGE maps 129 Fable domain ids and all 48 lead entries | Both original id sets kept side by side in each row; no third id scheme |
| Format | Markdown plus CSV with status, owner, implementation SHA, runtime evidence columns | Markdown tables grouped by work order with a Status cell |
| Status lifecycle | OPEN, IMPLEMENTED, LOCALLY_VERIFIED, STAGING_VERIFIED, CLOSED, REFUTED | OPEN or CLOSED with SHA, test and evidence path |

P0 sets differ by clustering and by five severity calls:

- Codex promotes four rows the Fable register holds at P1: card purchase reduces debt (NEW-05 / RC-03), ownership operations can orphan a household or create two owners (NEW-12 / SEC-06, SEC-07), global FX and securities writable across households (NEW-13 / RC-02, INV-06), receipt conversion duplicates or reverses a ledger effect (NEW-18 / RCP-01, RCP-02). All four are money or tenancy integrity on reachable paths; the promotions are justified and the Fable register should adopt them.
- Fable holds the missing scheduler at P0 (nothing runs recurring, rollover, snapshots or FX in the declared deployment); Codex keeps OPS-003 at P1 under R14. The Fable rating should stand: it is a functionality blocker for four advertised features, not a defect in one.
- The remaining difference is clustering only: Fable folds PRIV-01 to PRIV-05 into one row, GRZ-01, 02 and 04 into one, FIN-02 and FIN-03 into one. After adopting the four promotions the two P0 sets describe the same defects.

## 3. Specification depth and style

| Aspect | Codex | Fable |
|---|---|---|
| Governing contracts | SPEC.md: a capability matrix (named capabilities per role, not an ordinal comparison), a written visibility predicate, monetary and mutation invariants, migration and API contracts, OI-01 to OI-06 operational inputs | Spread across DECISIONS.md defaults and the work orders; no single capability matrix |
| Work-order detail | Per packet: files to modify "as needed" without line numbers (deliberately, "never assume old line numbers"), three ordered slices, one oracle sentence, one focused test command, an evidence path `evidence/Rxx/RESULT.md`, a suggested commit subject | Per work order: files with line numbers verified at `381e943`, numbered steps, named tests with what they assert, acceptance criteria with the fixture numbers, runtime evidence to record, rollback |
| Thandi | THANDI_SPEC adds a concrete persistence contract (ai_requests, ai_attempts, ai_budget_reservations, ai_budget_accounts, ai_consent), an app-quota and local-mode policy, a file map, and USD budget units | CP-19 adopts the 11 October spec, names the same request and attempt tables, adds the free-allowance adaptation (Claude leg at price zero) and the code facts from the Fable Thandi assessment (consent version not enforced, no idempotency, empty evaluation pack, conversations implemented) |
| Agent protocol | AGENT_HANDOFF: copy-and-paste task prompt, resume template, ownership and worktree rules, status lifecycle, stop rules; plan has a shared eight-step loop per slice | REMEDIATION_PLAN §1–2: host-specific environment recipe (audit database, SMTP sink, launch entry), safety rules, branch and PR conventions, a single closure rule, eleven known traps on this codebase and host |
| Acceptance | ACCEPTANCE.md: a new combined Golden fixture A with running net worth after each step (1000 and 0 cash, 500 card, 200 income, 125.50 expense, 100 transfer, 45.50 card purchase, USD 10 at 20, 100 split 60/40), separate FX, goal, budget and investment fixtures, an evidence template per packet | ACCEPTANCE_CATALOGUE: J01–J16 with the Codex fixtures and the Fable hand-computed values and the re-runnable verifier scripts as oracles |
| Calendar | Weeks only (22–35 five-day weeks); explicit refusal to halve for two developers | Date projections for one and two developers, lanes, risk register, first ten days |
| Decisions | 13 resolved conflicts; external facts (tax rate, retention, monetary caps, hosting) are inputs that block dependent actions and are not defaulted | 15 resolved conflicts, 20 defaults an agent may assume and must declare, 9 owner decisions |

## 4. Substantive disagreements

1. Privacy backfill. Fable CP-04 step 4 backfilled `transactions.is_private = true` from the account's privacy. Codex SPEC §3 says account privacy and transaction privacy are distinct facts and must not be backfilled into each other, because the visibility predicate already checks both and the backfill destroys provenance irreversibly. Codex is right; the Fable work order has been corrected to predicate-only with no backfill.
2. Scheduler severity. Fable P0, Codex P1. Fable's rating stands (see §2).
3. Defaults versus inputs. Codex refuses to invent a withholding rate, a retention period or a monetary cap and blocks the dependent action until the owner supplies it. Fable records a default (15% labelled pending, retention for the life of the account, a 5,000 step-up threshold, Render disk, Render cron) and lets the agent build against it while declaring it. Both are defensible; the merge should keep the Fable defaults as "assumed pending OI-xx" so agents can build, with Codex's rule that nothing paid, legal or production-facing is enabled on an assumed value.
4. Where the e2e rewrite lives. Codex gives it its own packet R20 (3–5 days) early, so the harness guard and honest specs exist before the money work. Fable puts the guard in CP-00 and the rewrite in CP-21 at the end. Codex's placement is better: vacuous specs should be fixed before they are relied on at G2.
5. Status model. Codex's five-state lifecycle records partial progress; Fable's binary rule is stricter but hides "implemented, not yet staged". Adopt Codex's lifecycle with Fable's closure rule as the definition of CLOSED.

## 5. Mistakes each should fix

Fable: the backfill (fixed); adopt the four P0 promotions; add a machine-readable register; add the capability matrix as a single table instead of prose scattered across work orders; adopt the evidence-file-per-packet convention.

Codex: R04 "Existing file targets" lists `server/services/GoalActivityLogService.ts` and `server/repositories/RecurringQueryRepository.ts` while the reproduced leak sites are `goals.controller.ts:359-369`, `goals.extra.controller.ts:105-119`, `TransactionGoalLinkService.ts:364-388`, `TagRepository.ts:240-245` and `RecurringRepository.ts:133-161`; an agent should start from the reproduced sites. The R17 packet lists one primary row (OPS-012) for the provider, consent-version, idempotency and budget work; sub-requirement ids or a checklist would stop partial closure. (CHG-AI-01 is a Fable register id, not a Codex one; an earlier draft of this sentence said otherwise.) Codex also carries the scheduler at P1 (see §2).

## 6. Effort reconciliation

| Packet pair | Codex | Fable | Note |
|---|---|---|---|
| R00 + R20 vs CP-00 + e2e half of CP-21 | 5–9 | 3–5 plus about 3 | agree |
| R05 vs CP-05 | 4–7 | 3–5 | Codex includes shared-view persistence |
| R08 vs CP-08 | 6–9 | 5–7 | agree within a day |
| R13 vs CP-15 | 7–11 | 6–9 | Codex includes legacy reconciliation of positions without invented costs |
| R17 vs CP-19 | 5–8 | 4–7 | Codex includes the persistence contract explicitly |
| R18 vs CP-20 | 4–6 | 5–8 | Fable includes the phone layout packet |
| R21 vs CP-21 | 5–8 | 8–12 | Fable includes the e2e rewrite and soak monitoring here |
| Total | 88–145 | 86–138 | overlap 88–138; with reserve 106–166 |

Use 88–145 before reserve and 106–174 with it: the higher figure prices the shared-view persistence and legacy investment reconciliation that Fable's packets mention but do not separately size.

## 7. Merge recommendation

Keep one directory. Take from Codex: SPEC.md as the governing contract (capability matrix, visibility predicate, invariants, OI list), THANDI_SPEC.md with its persistence contract, the CSV register with the five-state lifecycle, AGENT_HANDOFF with the resume template, the per-packet `evidence/Rxx/RESULT.md` convention, R20 as an early packet, and Golden fixture A. Take from Fable: the line-referenced steps, named tests and numeric acceptance in each work order (paste them under the matching R packet), REMEDIATION_PLAN §1–2 (host recipe and the eleven traps), the defaults table relabelled "assumed pending OI", the calendar projections and lanes, and the verifier scripts as oracles in ACCEPTANCE. Apply the five reconciliations in §4. Re-number nothing else: the R and CP ids map one to one and a crosswalk line in each packet is enough.

Effort to produce the merged package: about one day of documentation work. It should be done once, by one session, in a directory neither session is currently writing to.
