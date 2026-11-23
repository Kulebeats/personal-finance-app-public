# Start here: agent execution and resume contract

> **SUPERSEDED:** Start with the single [Master Completion Specification, section 8](../../plans/2026-10-15-master-completion-spec.md#handoff). The previous reading list below is historical; no agent needs to reconcile these old packages again.

This package is the consolidated plan for Capital/personal-finance-app. **Current request is docs only.** Do not implement, install, deploy, provision providers, use credits or modify real data unless the user subsequently authorizes that work.

## Reading order

1. README.md: current state, scope, precedence and estimates.
2. SPEC.md: resolved behavior/capability/data contracts and outstanding operational inputs.
3. REMAINING_WORK.csv or REMAINING_WORK.md: exact closure items; all initially OPEN.
4. ../../plans/2026-10-15-full-application-remediation.md: choose one dependency-ready R packet.
5. ACCEPTANCE.md: applicable J journeys and independent data oracles.
6. THANDI_SPEC.md for R17; then historical specialist evidence named in that row.

Historical package paths are siblings: ../2026-10-11-deep-readiness/ and ../2026-10-13-independent-readiness-fable/. Old Pxx and WP-xx IDs are not the new Rxx packets. Preserve finding IDs and consult PACKET_INDEX.csv for new ownership. Do not execute a historical pilot/defer branch or change Claude/Gemini order.

## Copy/paste task for a future implementation agent

> Implement packet Rxx from docs/plans/2026-10-15-full-application-remediation.md under the user's separate implementation authorization. Read docs/reviews/2026-10-15-consolidated-completion/README.md, SPEC.md, the Rxx register rows and ACCEPTANCE.md first. Confirm dependencies and current SHA, claim exact file ownership, and preserve other agents' changes. Write meaningful failing regressions, implement the smallest coherent fix and migration, run focused checks plus protected runtime evidence, obtain code review appropriate to changed languages, and update evidence/Rxx/RESULT.md and the register honestly. Do not silently cut features, invent external policy or credentials, use real finance_app for tests, mark source-only work runtime-verified, or deploy without authorization. End with completed rows, actual tests/evidence, unresolved blockers and the next safe packet.

Rxx is a placeholder, not an instruction to run every packet at once. Named ownership and implementation authorization must be concrete before code work.

## Initial state and queue

- App baseline:381e9439afabe7c6cf829cb1cbded91d36da44ee.
- All 101 grouped closure items OPEN. No packet implemented by consolidation.
- Begin R00; R20 harness and R19 environment foundations follow. R01/R02/R04 identity/privacy are first application fixes. R11 purity/reference regression slices can be prepared alongside privacy; R08 establishes the financial mutation contract before import/report rewrites.
- File targets in the plan existed at authoring; new test/admission/schema names are proposals. Recheck paths at current SHA and document renames; never assume old line numbers.
- Re-read repository AGENTS.md if present and applicable current guidance. Historical CLAUDE.md completion statements have known stale assertions: verify source, do not follow them as readiness proof.

## Worktree and collaboration

Use an existing suitable isolated worktree when authorized implementation needs it; inspect attached artifacts first. The assessments are untracked at authoring and will not automatically appear in a new Git worktree: explicitly preserve/copy only this documentation package and its referenced source evidence into the worktree or commit the docs under authorization before creating it. Do not copy .env, audit cookies or raw logs. Verify copied document checksums.

One agent owns each active packet. Shared/schema.ts, package manifests, common money/visibility utilities and deployment configuration require coordination and a single active editor. Do not revert another agent's work. A schema change needs dependency acknowledgement before integration. Delegation is permitted only if the task context authorizes it; this document does not itself send messages or spawn agents.

## Safety and status rules

- Database mutation targets must be explicit disposable fixtures or separately authorized staging; never finance_app. Refuse unknown hosts/DBs before writes. Root and browser test entrypoints need the same protection.
- Use existing environment secrets securely; never paste keys in chat or reports. Ordinary tests use mocks/local SMTP sinks; paid/provider smoke is separate and bounded by OI-02.
- No blanket production backfill, deletion, db:push, blind dependency major upgrade or feature hiding to obtain green checks.
- OPEN = specified/unfixed; IMPLEMENTED = code exists; LOCALLY_VERIFIED = observed isolated results; STAGING_VERIFIED = deployed candidate proof; CLOSED = primary and supporting packet acceptance reviewed. REFUTED needs exact counter-evidence and register disposition.
- A proposed test file or completed source review is not a passing test. A merged commit is not deployment. Provider configured is not provider verified.
- Stop only the dependent action for a missing OI input or unsafe ambiguity and continue independent authorized work. Do not re-ask settled full-product/provider decisions.

## Resume note template

```text
Packet / assigned agent / reviewer:
User implementation authorization reference:
Branch / SHA / worktree / dirty-file ownership:
Source findings and dependencies:
Changed files / migrations:
Last completed slice:
Commands actually run and result:
Runtime target/mode/fixture and evidence paths:
Register status changes:
Unresolved input or failure:
Next exact command or bounded task:
```

At closeout use explicit path staging if commits are authorized; link tests and runtime results, retain uncertain outcomes, and hand off a bounded next packet. Do not restart the full audit or substitute a generic plan for the already specified work.
