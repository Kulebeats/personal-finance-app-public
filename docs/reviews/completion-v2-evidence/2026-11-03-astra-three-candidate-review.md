# Independent Astra review of three local candidates — 3 November 2026

**Superseding scope clarification:** [Full SIP delta review and integration hold](2026-11-03-astra-sip-full-delta-addendum.md) identifies one unresolved HIGH issue in the historical SIP lineage: the signed caller accepts private-owner plans that the executor cannot perform. The local-composition approval below does not clear that issue or authorize canonical integration of the full SIP delta. R12/R08 may proceed separately after exact-candidate checks. Read the addendum before using this review's verdict.

The owner restored Astra review and orchestration in THIS chat. This assessment is the resulting independent in-session candidate review, not an adoption of prior Sol implementation-check verdicts. The three bounded candidates below are approved for local composition. Fresh combined verification is required before accepting the composed result. No canonical integration, push, main merge, deployment or release follows from this review.

## Authority and scope

The governing documents are the canonical `docs/plans/2026-10-15-master-completion-spec.md` and `docs/reviews/completion-v2-evidence/CAMPAIGN.md` in `C:/Users/USER/.codex/worktrees/capital-completion-v2/personal-finance-app`. The complete handoff reviewed was `docs/reviews/completion-v2-evidence/2026-11-03-sol-caller-repair-checkpoint.md` in this documentation worktree.

Review was read-only: Git identities and diffs, product and test source, acquisition and audit dependencies, raw passing/failing receipts and evidence hashes. No runtime or database commands were executed by this reviewer. This file and its explicit-path local documentation commit are separately authorized preservation work; canonical files remain untouched.

All candidate worktrees were clean at the requested pins when inspected. Paths below are relative to `C:/Users/USER/.codex/worktrees`.

| Candidate | Exact pin | Worktree | Disposition |
|---|---|---|---|
| R12 currency caller and fixture repairs | `242a35d12f5dbdde865127bec9f908ab40b8b030` | `capital-r12-caller-fixes-nov03/personal-finance-app` | Bounded local composition approved |
| SIP original foreign acquisition guard | `ab290d5811435fbc82d681313e19dba19414d2fd` | `capital-r13-sip-fx-protected-nov03/personal-finance-app` | Bounded local composition approved |
| R08 rule split allocation and mandatory audit | `63d7938d2b5ba2724396ce272f05f125bb6a7b0a` | `capital-r08-rule-audit-protected-nov03` | Bounded local composition approved |

No actionable defect above the requested confidence threshold was identified in these changes. Approval is bounded to the reviewed slices and evidence; it does not close any complete campaign packet.

## R12: source and evidence adjudication

Product changes carry the resolved display currency through holdings and portfolio hooks into row/header displays and withhold unavailable allocation summaries. The selector admits the two supported query spellings consistently and rejects malformed or conflicting selections. The corrected tail changes exactly three test files: supported role query options, actor-owned session/audit cleanup in the older investment DB suite, and captured-ID cleanup for deliberately detached holding-edit audit fixtures. The cleanup changes do not change product retention behavior or weaken the financial assertions.

Actual inspected receipts:

- `.local/sol-r12-callers-clean38n`: exact `242a35d1`, 374/374 cases across 15 complete server files, no pending/failed cases, command exit 0. Target OID `1789937`, exact `r12clean38n` marker, 28 migrations, all recorded primary six and scope nine counters zero.
- `.local/sol-r12-project-fixed38o`: exact-head full project check exit 0, matching clean head afterward.
- `.local/sol-r12-client-fixed38l`: 79/79 across nine client files at `c72ceba2`; later commits only change the two server fixtures, so this is source-equivalent client evidence rather than a new exact-head execution.

### Explicit older browser adjudication

The older `.local/sol-r12-browser38h` lives in `capital-r12-currency-caller-protected-nov03/personal-finance-app`. Its build and browser receipts pin `33ff13d6f44fa894ad61713ae3a4a5c5191e0228` and exit 0. Raw Playwright statistics record four expected passes, zero skipped, unexpected or flaky cases; the command uses zero retries.

Git confirms `33ff13d6 -> 242a35d1` changes only the three test files above. Application, browser, dependency and build inputs are unchanged. I accept these four journeys as older source-equivalent browser evidence for the corrected R12 candidate. This is NOT an exact-head browser run, a fresh reviewer-run browser result, or complete R12 acceptance.

The currency journey performs actual UI account/opening writes, checks the actual POST payloads and GET currency responses, uses fixed independent monetary expectations of 300 ZMW and 15 USD, and compares SQL financial snapshots across display changes. Its synthetic current FX quotes do not prove dated valuation or historical basis.

The browser postflight was NOT zero: it retained four synthetic households/users/accounts/holdings, four sessions, four tracking rows and 19 audits. The retained-row read-only follow-up documents these records, including four lots, five opening receipts, one deletion receipt and one disposal. The blanket-zero operator failure remains a failure, not a clean-boundary result.

Earlier R12 failures remain preserved: `.local/sol-r12-callers38f` retained five audits and two sessions, and `.local/sol-r12-project38g/check.json` records exit 2 at `33ff13d6`. The new server packet establishes its own clean boundary; it does not reinterpret or erase those failures.

## SIP: source and evidence adjudication

The guard executes before the existing holding UPDATE when a foreign holding has non-null stored base or acquisition rate, including zero. It reuses complete lot/disposal reconciliation, checks genuine original BUY/lot/CREATE-audit bindings and retains current source/audit locks through the purchase. A matching later or rebound economic row alone cannot certify the original declaration. The guard does not require an opening retry receipt, invent a creator, or emit a retained observation. The helper converts refusal diagnostics to a generic error.

Tests use actual signed acquisition endpoints, genuine emitted audits, deliberate SQL source damage, complete persisted effect snapshots and real PostgreSQL lock conflicts. Positive controls include both-null legacy history, a partly sold declared opening, genuine manual acquisition without an opening receipt or creator declaration, and a zero-value declared gift. Source-lock probes check actual concurrent UPDATE conflicts. Their corrected watchdog releases the captured holder once and drains execution; error-opacity assertions include original audit UUIDs.

- Corrected test-only baseline `7ed3c91e424427b91816112dc56769f97aec670d`, packet `.local/sol-sip-watchdog-red38u` in `capital-r13-sip-watchdog-red-nov03/personal-finance-app`: 18 failures, four positive passes, no pending cases, exit 1. Fifteen failures expose unintended successful execution where refusal is required; three expose absent `55P03` source-lock conflicts. OID `1804604`, exact marker, 28 migrations and recorded counters zero.
- Candidate `.local/sol-sip-source-green38v`: exact `ab290d58`, 86/86 across six complete files, no pending/failed cases, exit 0; OID `1807530`, exact marker, 28 migrations and recorded counters zero.
- `.local/sol-sip-project38w`: exact-head full project check exit 0 with clean source afterward.

Git comparison confirms the corrected RED and candidate use identical legacy-FX test source, and the candidate's two product files are unchanged from `05af16f1`. Earlier malformed-oracle and first source-probe failures remain historical evidence; their coverage is not silently upgraded by the corrected tests.

This accepts the bounded admission guard. It does not establish private mandates, overdue/backdating policy, complete FIFO/source privacy, every SIP lifecycle, or full FIN-11/R13 completion.

## R08: source and evidence adjudication

All six changed rule mutation paths pass their transaction into mandatory audit insertion. Create, update, delete, reorder and bulk enable/disable therefore roll back when required audit insertion fails. Bulk operations retain operation/batch metadata and canonicalize repeated or mixed-case UUIDs to unique effects. The repository keeps its existing standalone reorder behavior while accepting an outer transaction.

Allocation validation covers both authored and stored declarations, rejects competing units and overdeclared percentages, and applies deterministic cumulative cent rounding. Integration tests verify fixed over-allocation rolls back earlier tag effects and check actual persisted ten-cent allocation conservation. Disabled malformed actions remain quarantined.

The audit tests use signed HTTP requests and real PostgreSQL BEFORE INSERT failure triggers, including failure on the later batch audit, with persisted rule/audit snapshots. They also check successful audit action, actor, household, entity cardinality and batch metadata.

- Baseline `eb16ca184a9e0001b1a578cda97cf0674948fcda`, `.local/sol-rule-audit-fullred38q` in `capital-r08-rule-audit-batch-red-nov03`: 12 failures/four passes, no pending cases. Eight failures expose missing mandatory rollback; four expose missing metadata or duplicate-effect cardinality. OID `1795802`, exact marker, 28 migrations and recorded counters zero.
- Candidate `.local/sol-rule-audit-green38r`: exact `63d7938d`, 73/73 across five complete files, no pending/failed cases, exit 0; OID `1798741`, exact marker, 28 migrations and recorded counters zero.
- `.local/sol-rule-audit-project38s`: exact-head full project check exit 0 with clean source afterward.

Git comparison confirms baseline and candidate audit-test files are identical. The five-file run includes the older rule integration, rule-tag authoring and atomic rule-application callers. This is bounded rule allocation/audit evidence, not all R08 ledger writers or complete NEW-32 acceptance.

## Evidence integrity and next gate

All 116 entries in six inspected SHA-256 evidence manifests were recalculated without mismatch: R12 server 19 and browser 21; SIP corrected RED/GREEN 19 each; R08 RED/GREEN 19 each. Hash agreement establishes integrity against those retained manifests, not independent execution or proof of a deployed environment.

The passing/failing counts above were parsed from raw runner JSON, and execution pin/exit/boundary claims were checked against individual receipts. These are independently inspected historical execution and persistence receipts; this reviewer did not rerun them or query their databases live. Current runtime process ownership must be refreshed before any new protected execution window.

Compose only these approved slices in the authorized isolated destination, preserve all old evidence, and run fresh meaningful combined checks with matching candidate identity and protected target proofs. A changed composition is a new candidate. Full R08/R12/R13 closure, staging, restore/UAT, production persistence and release remain unproven. No push, main merge or deployment is approved here.

## Review Summary

| Severity | Count | Status |
|---|---|---|
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: APPROVE the three bounded candidates for local composition, with fresh combined verification required. No release approval.
