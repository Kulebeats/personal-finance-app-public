# Independent review protocol for the remediation

Role: Codex implements the packets of `docs/plans/2026-10-15-master-completion-spec.md` (the governing specification). Fable acts as the independent reviewer with no stake in completion: it verifies claims against code and runtime, never implements, never merges, never closes a row on the implementer's word. Agreed 15 October 2026.

## 1. Checkpoints

| When | Trigger | Depth |
|---|---|---|
| Packet review | A packet's PR is open or merged and `docs/reviews/completion-v2-evidence/Rxx/RESULT.md` exists | Full: §3 below |
| Gate review | The implementer declares G0–G5 met | Full packet review of every packet in the gate plus §4 |
| Spot check | The owner asks, or more than five working days pass without a packet closing | Light: register drift, hot-file ownership, suite health |
| Pre-release | Candidate SHA declared for G5 | §4 plus the complete J01–J16 catalogue re-run |

The owner starts a review by naming the packet or gate and the branch or SHA. Nothing is reviewed from a transcript or a PR description alone.

## 2. Inputs the reviewer expects

- Branch name and SHA; PR link if any.
- `evidence/Rxx/RESULT.md` with the target manifest (database name, host alias, mode, versions, schema), commands run, test counts and expected versus observed values.
- The register rows the implementer claims to move, with their new status.
- Any amendment proposed to the governing spec (decisions D01–D23, OI inputs).

Missing inputs are reported as gaps, not inferred.

## 3. Packet review checklist

Static:
1. Diff read in full. Every change traced to a register row or an explicitly recorded amendment; unrelated changes flagged.
2. CLAUDE.md rules: no float money in financial paths, no `as any`, LOC ratchet not raised, `withTransaction` plus `FOR UPDATE` on read-then-write, `BusinessAuditService` on financial writes, Zod at boundaries, envelope and error classes.
3. The governing contract for the packet (Part 2 of the master spec) honoured: capability matrix, visibility predicate, posting contract, idempotency outcomes, migration order (expand, validate, backfill, verify, constrain).
4. Migrations: additive, reversible or forward-only with a stated rollback, rehearsed on a populated copy where the spec requires it, no guessed backfill.
5. Tests: the regression exists, fails without the fix (checked by reverting the fix locally or by the mutation check), and asserts persistence over real HTTP where the row says HTTP or DB; no new skips; no vacuous assertions.

Runtime, on the reviewer's own disposable database built with `drizzle-kit migrate`, server in development mode with CSRF and limiters active:
6. `npm run check`, the packet's focused suite, then the full server and client suites; runner summary lines recorded, database named.
7. The historical probe that proved the defect re-run and shown to fail to reproduce: Fable verifier scripts under `.local/readiness-fable-2026-10-13/scratch-*/`, the 14 October probe commands, the Codex `runtime-probes.mjs`, or a new probe written for the row.
8. The packet's independent acceptance oracle re-derived by hand or by an independent script, never by the production helper.
9. Negative, race and retry cases exercised where the packet names them (two agents, a barrier, a replayed request, a killed job).
10. Regression obligations from the "what verifiably works" list spot-checked for the touched area (balances to the cent, paired legs, idempotent creates).

Outcome per claimed row: CONFIRMED (evidence reproduced independently), NOT CONFIRMED (with the exact failing step), or BLOCKED (environment, with what is needed). Only CONFIRMED rows may advance beyond IMPLEMENTED in the register.

## 4. Gate review additions

- Every packet in the gate CONFIRMED; no row of the gate left at IMPLEMENTED.
- Gate-specific oracles re-run end to end: G1 the privacy and role matrix across all roles and the unknown-role seam; G2 Golden fixture A and the Fable reports, budgets and import fixtures; G3 the investments hand values and two consecutive days of staging cron evidence; G4 the three Thandi scenarios with provenance and the ledger races; G5 J01–J16 on production-mode staging at the candidate SHA, restore and rollback timings, soak log.
- Register integrity: counts regenerated from the CSV, no silent severity change, no row removed without an owner-recorded scope change.
- Decisions: any deviation from D01–D23 or an OI default recorded as a versioned amendment with impact.

## 5. Reviewer outputs

- `docs/reviews/completion-v2-evidence/Rxx/REVIEW.md` per packet: rows reviewed with outcome, commands run and summary lines, reproduction results, defects found with file and line, required changes, residual risk.
- A gate report per gate.
- Findings reported plainly: what was checked, what held, what did not, with the failing step. No scores.

## 6. Reviewer boundaries

- Read-only on application code and on the implementer's branches; findings go to the owner and the implementer, fixes are the implementer's.
- Writes only under `docs/reviews/completion-v2-evidence/Rxx/REVIEW.md`, this directory, and `.local/` scratch.
- Disposable databases only; never the development database; no real e-mail, provider call, deploy or merge.
- A review that cannot run the suites or the probes says so and does not substitute a source read for runtime evidence.
