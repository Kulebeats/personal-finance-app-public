# SIP proof completion constraint — confirmed focused RED

Independent Astra review accepted the focused run at clean test-only `793c28baa6a852636cf24e77cbf88a74811c293c`, based on schema `502493f8`. **One case failed, one passed, 57 were filtered/skipped; only two ran.** All 19 evidence hashes match. Fresh marked target `pfa_completion_scope_sipguard39w_test`, OID **1852468**, 29 migrations, owned PostgreSQL18.6/loopback55432; six primary and nine scope counters were zero PRE/POST. Runtime was pinned Node24.22.0; source remained clean.

Raw evidence: `C:/Users/USER/.codex/worktrees/capital-sip-adverse-sql-nov03/personal-finance-app/.local/astra-sip-guard-red39w`.

## Confirmed HIGH invariant defect

The probe inserts an operational reservation while its purchase is absent, selectively forces the named deferred completion constraint, then inserts the actual BUY. The insertion seal is present, the BUY exists and proof is absent. The final `SET CONSTRAINTS ALL IMMEDIATE` succeeds instead of raising23514 because the completion event was already consumed. These prerequisite assertions executed successfully. The probe then rolls back; this is evidence of an admitted proof-free constraint state, not a claim of an actually committed unproven purchase. The complete-proof diagnostic control passes.

The original reservation TRUNCATE hypothesis is separate: native PostgreSQL pending-trigger admission blocks that sequence. Do not report absence of a reservation TRUNCATE trigger alone as the confirmed bypass.

## Repair and remaining evidence

Astra cleared the minimal invariant repair: completion requires proof while either the reservation or purchase survives. Genuine abandonment remains possible only after deleting the reservation with no purchase left. Sol owns this repair in the isolated adverse-SQL candidate, without changing the seven retained proof fields or introducing policy.

Frozen793c28b and raw39w remain unchanged. The old positive early-flush step is diagnostic baseline behavior, not a permanent requirement: the corrected test must expect immediate refusal there and retain normal complete-proof, savepoint and abandonment controls. New exact SQL must receive independent review before fresh/populated rehearsal and full guard checks. Existing39p evidence remains valid only for preservation at its original SQL hash; it does not clear this newly reproduced invariant defect or prove revised SQL behavior.

The separately reviewed API candidate `a766e85c` may proceed through bounded checks, but schema/full SIP acceptance remains held. No production/shared database or external action occurred.
