# R08 export parameter regression — 4 November 2026

Root reproduced the parameter-growth defect and verified the bounded fix using isolated, detached checkouts and the existing protected unit runner, pinned Node 24.22.0, scrubbed credential environment, and one worker. These are real Drizzle query-compilation tests with synthetic driver results, not PostgreSQL execution or large-download browser evidence.

- RED: `d79e2efc8ee31f6566c31e7cd5fc53ef0c90d71e`, `C:/Users/USER/.codex/worktrees/capital-r08-export-red-nov04`, `.local/export-parameters-red`: 2 failed, exit 1. The 65,536-ID case actually generated 65,536 bindings; the single-ID case bound a scalar instead of an array. Tracked checkout remained clean.
- GREEN: `6e1fd84cdcf2cfe883887b92274d31a3a45ae382`, `C:/Users/USER/.codex/worktrees/capital-r08-export-green-nov04`, `.local/export-parameters-green`: 2 passed, exit 0. One bound UUID array, ANY predicate, sorted FOR SHARE, repeatable-read option, source recheck and single audit assertions passed. Tracked checkout remained clean.
- Earlier author-tree `.local/r08-export-parameters-red-nov04` passed during a concurrent source edit. Its CLASSIFICATION.txt explicitly marks it mutable-worktree diagnostic only; it is neither RED nor exact-commit GREEN. Preserve it.

Independent Astra source review is pending. Full project checks and protected real-database account/audit callers remain pending. No canonical product integration or R08/full campaign acceptance is established. No database or external delivery was performed in these runs.

## Follow-up caller checks and review

Independent Astra cleared the exact 6e1fd84c parameter fix and inspected isolated RED/GREEN receipts. No actionable source finding; no database acceptance.

Existing accountService/shared-owner unit callers first returned 31 passing and 2 failing: the first dynamic import exceeded the default 5-second timeout, followed by a mock-call assertion failure. Preserve `.local/account-caller-unit-nov04` in the isolated GREEN tree. A diagnostic run changing only `--testTimeout=30000` passed all33 in `.local/account-caller-unit-timeout-diagnostic-nov04`; this is consistent with import-time interference, not conclusive proof of its cause. No assertion or product source was changed.

Full project check is executing serially in root session85925, with output at `.local/project-check-nov04`; it has not yet completed. Prepared, unexecuted DB wrapper `.local/root-operators/run-account-callers40g.ps1` targets only fresh accountcallers40g on approved55432 and is awaiting independent review. No DB test window has begun.

Independent Astra separately cleared SIP fa7a637f populated-fixture/operator40f preparation (operator SHA82a396c608728e8d1cf83343db4d9e498c3b0fba10d1e93b48185a0358c3abb6), with all46manifest/38intent hashes matching. It remains unexecuted and requires fresh28-migration bootstrap, actualOID sealing and concrete wrapper review before seed/upgrade/verify. This does not accept migration runtime behavior.
