# Capital — consolidated completion specification and remediation plan

> **SUPERSEDED:** Use the single [Master Completion Specification](../../plans/2026-10-15-master-completion-spec.md) for all future completion work. This package is historical evidence/planning context; its old priorities, instructions and counts are not the governing version.

**Final planning package,15 October 2026. App remains NO-GO. No app code changed.**

Baseline: `381e9439afabe7c6cf829cb1cbded91d36da44ee`. This consolidates the Codex11 October assessment and Claude's13–15 October assessment/update, resolves their conflicting requirements, and gives a new agent a bounded execution contract. It supersedes their completion-plan recommendations where inconsistent; original evidence remains preserved.

## What remains

**101 grouped closure items, all OPEN, across22 implementation packets.** Priority distribution:17 P0,72 P1,12 P2. These are work/acceptance groups, not a claim that101 bugs were independently reproduced. The register distinguishes source, local HTTP/DB, browser and unverified operational evidence. No fixed item is being claimed.

The remaining work includes live session revocation; verification and membership; complete privacy/capabilities; settings/shared views/MFA/export/erasure; liability and ledger integrity; both import paths; rules/organization; budgets/goals/FX/report parity; full investment/GRZ/pension lifecycle; durable jobs/files/OCR; notifications/recap/push; Claude-first Thandi; mobile/accessibility; and exact-candidate staging/recovery/UAT proof.

## Reading order and deliverables

1. **[SPEC.md](SPEC.md)** — governing product, permissions, money, API, migration and operating contracts; resolved engineering decisions and external inputs.
2. **[Detailed remediation plan](../../plans/2026-10-15-full-application-remediation.md)** —22 ordered packets,66 implementation slices, verified existing file targets, proposed tests, commands, migration notes, oracles and closure evidence.
3. **[Remaining work](REMAINING_WORK.md)** — human-readable list of every closure item; **[CSV register](REMAINING_WORK.csv)** for agent tracking, source aliases and evidence states.
4. **[THANDI_SPEC.md](THANDI_SPEC.md)** — Claude primary -> eligible Gemini fallback -> labelled local mode; final consent, audit and durable spending contracts.
5. **[ACCEPTANCE.md](ACCEPTANCE.md)** — J01–J16, independent financial fixtures, failure/race/retry evidence and release gates.
6. **[AGENT_HANDOFF.md](AGENT_HANDOFF.md)** — start/resume protocol, copy/paste implementation prompt, target safety and ownership rules.
7. **[PACKET_INDEX.csv](PACKET_INDEX.csv)** — machine-readable dependencies, estimates, finding ownership, proposed tests and commands.
8. **[DECISIONS.md](DECISIONS.md)** — exact adjudication of assessment disagreements, evidence limits and optional enhancements.
9. **[SOURCE_COVERAGE.md](SOURCE_COVERAGE.md)** — 129 distinct Claude domain ID entries mapped by source report, including one positive finding retained as a regression check.
10. **[VALIDATION.md](VALIDATION.md)** — checks performed on this documentation package and the limits of those checks.

No new agent needs the chat history. Start with AGENT_HANDOFF once implementation is explicitly authorized. The current instruction remains documentation only.

## Key decisions now settled

- Full application with no November deadline; hidden/disabled advertised features do not count as complete.
- Claude is Thandi's primary provider; Gemini fallback is already selected. No repeated provider-choice approval.
- Professional stays, with least-privilege shared-data read access. Shared views remain functional but do not widen privacy.
- Private accounts/transactions are excluded from unauthorized related reads, counts, exports, reports, AI and messages.
- GRZ record-only acquisition stays; confirmed principal settlement converts asset to cash and is not ordinary income. No automatic duplicate purchase debit or blanket suppression of real receipts.
- Normal tests use isolated targets; release requires production-mode staging and real controlled integration/recovery evidence.

## Effort and schedule

**88–145 focused developer-days**, approximately 528–870 engineering hours before reserve. **106–174 days with 20% reserve**, roughly 22–35 five-day working weeks for one primary developer.14-day soak is elapsed time; integration monitoring effort is included in R21. Staffing, external inputs and migration discoveries affect calendar duration.

This is a new combined estimate, not the sum of the old estimates or a promise to launch on a date. It includes broader settings/shared-view delivery, newly confirmed failures, explicit AI admission persistence and real acceptance work. Reforecast after identity/privacy gate G1 and money gate G2.

Start R00, then R20 test-target protection and R19 environment foundations. Identity/session/verification/privacy (R01–R04), rule reference/purity and ledger invariants precede dependent integrations. The plan gives the full dependency graph and first ten-day allocation.

## Module coverage

| Existing module | Completion packets |
|---|---|
| Auth | R01/R02/R06/R20 |
| Household | R03/R04/R05 |
| Settings | R05/R06/R07/R18 |
| Accounts | R04/R08/R09/R12 |
| Transactions | R04/R08/R09/R11/R12 |
| Budgets | R10/R12/R14 |
| Goals | R04/R10/R14 |
| Investments including GRZ/pension | R04/R08/R12/R13/R14 |
| Recurring | R04/R08/R14 |
| Dashboard | R12/R18 |
| Reports | R04/R12 |
| Cashflow | R08/R12 |
| Categories | R04/R10/R11 |
| Tags | R04/R11 |
| Merchants | R11/R15 |
| Rules | R04/R08/R11 |
| Filter presets | R05/R11 |
| Receipts | R08/R15/R19 |
| Notifications | R16/R19 |
| Weekly recap | R04/R12/R14/R16 |
| AI assistant | R04/R05/R12/R17/R19 |
| Health | R00/R19/R20/R21 |

## Inputs still required before dependent real-world actions

See OI-01–06 in SPEC: actual hosting/provider access and secrets; numerical AI caps/model IDs; verified tax/WHT conventions; retention/privacy policy; named owners/capacity; deployment authorization. These are operational/external facts, not unresolved choices between the two assessments. Use synthetic fixtures and blocked paid defaults until supplied.

## Sources and limits

- [Codex assessment/evidence](../2026-10-11-deep-readiness/README.md), its register and specialist reports.
- [Claude revised assessment/evidence](../2026-10-13-independent-readiness-fable/README.md), GAPS, domain reports and14 October re-verification.
- [Updated comparison](../2026-10-15-assessment-comparison-update.md), documenting the disagreements resolved here.

Historical green suites and documented probes are not re-run results for this package. The consolidation checks document links, file targets, dependency graph, arithmetic and register coverage only. Actual implementation, migration and runtime verification remain future work.
