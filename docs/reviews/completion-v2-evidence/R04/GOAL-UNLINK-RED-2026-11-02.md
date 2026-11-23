# Goal unlink authorization: reproduced, repair pending

Status: test-only candidate, not accepted implementation. R04 remains OPEN.

The existing `codex/r04-goal-unlink` branch in
`C:/Users/USER/.codex/worktrees/capital-r04-goal-unlink/personal-finance-app`
preserves test commit `310e046af526b31d3213b6f89ec9f1771c22b21a`.
Only `server/modules/goals/__tests__/completion-r04.goal-links.realdb.integration.test.ts`
changed. The service and controller are identical to canonical `98c6b1f1`.

## Observed evidence

The protected signed-HTTP suite ran at that frozen test commit from
2026-11-01T22:01:09Z to 22:01:20Z (November 2 locally):

```text
node scripts/run-protected-tests.mjs database vitest --server run modules/goals/__tests__/completion-r04.goal-links.realdb.integration.test.ts --maxWorkers=1

FAIL admin cannot unlink another member's private-account transaction
FAIL member cannot unlink another member's private-account transaction
FAIL cannot unlink a private transaction merely because its account is shared
Error: expected 404 "Not Found", got 200 "OK"
Test Files 1 failed (1)
Tests 3 failed | 12 passed (15)
exitCode: 1
```

The twelve passing cases include existing read callers, view-only and Professional
write denial, a member's shared-transaction unlink and the owner's private-account
unlink. Positive unlink cases verify the removed link, changed goal progress,
one new activity and audit, and unchanged transactions and account balances.
Denied cases contain complete relevant goal/link/contribution/activity/audit and
transaction/account snapshots; the three RED cases stop at their failed HTTP
assertion, so their subsequent unchanged-state assertions were not reached.

Type checking (`tsc --noEmit --incremental false`) passed on the same commit.
No production repair, browser run or final independent test review is claimed.
The independent reviewer and implementer had exhausted their usage quota; no
unchanged retry or alternative reviewer was launched to bypass that limit.

The marked disposable target was
`pfa_completion_scope_goalunlinkred02a_test` on `127.0.0.1:55432`.
Postflight rechecked its persisted synthetic marker and found zero goals,
transaction-goal links, goal contributions, goal activity rows and other clients.
The owned test postmaster 39024 was matched by PID file, data directory, loopback
port and live start identity before successful smart shutdown. No shared or
production database was connected to or changed.

The first startup wrapper omitted explicit host/port arguments. PostgreSQL tried
its default localhost sockets, received permission denied, shut down and never
became ready. That failed log is retained. The diagnosed wrapper error was then
corrected with explicit `-h 127.0.0.1 -p 55432`; this owned server was independently
identified before any bootstrap or test command. No database configuration was
changed and no other process was stopped.

## Evidence locations

Candidate worktree:

- `.local/goal-unlink-goalunlinkred02a/server.log`, SHA256 `6FF6A71DDBA0598401846A17BD749A67DFB3D0259EE9EA04CAD627B73BC64688`
- `.local/goal-unlink-goalunlinkred02a/server.json`, SHA256 `AFEAE48DEAA809AEA02DA150DF5B1B502413A5002916E6A60E7974ADB46990D1`
- `.local/goal-unlink-goalunlinkred02a/target.json`, bootstrap receipts and `postflight.log`
- `.local/goal-unlink-prep/types.json`, SHA256 `E8344D7E7B2AF18C9CBCBAE3194013C748D077F8968B9086707D686CC69331B1`

Canonical worktree startup, identity and shutdown receipts:
`.local/r04-goal-unlink-red-nov02/`. Failed and corrected startup receipts have
separate filenames. This committed record preserves the sanitized observed
result; the regression fixture itself is committed on the candidate branch.

## Bounded next action

Resume this existing branch. The controller currently passes household/user IDs;
`TransactionGoalLinkService.unlinkTransaction` fetches the transaction with the
deprecated household-only getter before starting its write transaction. Apply
actor visibility and current write authorization at the mutation boundary, with
account/transaction privacy and references revalidated after any relevant lock
wait. Check lock ordering against existing goal/transaction writers before adding
locks. Retain trusted internal caller compatibility only where actually needed.
Run these RED tests plus existing link/unlink callers and meaningful concurrency
coverage, then obtain independent source/test and combined review before local
integration. Goal aggregate privacy and financial semantics remain separate open
obligations; this fixture does not settle them.
