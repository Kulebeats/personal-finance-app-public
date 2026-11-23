# R12 composed-run DELETE fixture repair — UNVERIFIED candidate

Prepared 3 November 2026 under the owner's Sol implementation/tests-only
resumption. This is a repair within the existing R12 candidate. Independent
review, acceptance, canonical integration and all runtime checks remain pending.

Author worktree:
`C:/Users/USER/.codex/worktrees/capital-r12-session-fixture-nov03/personal-finance-app`

Branch: `codex/r12-session-fixture-nov03`

Base: `62186d4a335fa6dd091788ee280d3560287f3731`, the frozen R12 stage at
`C:/Users/USER/.codex/worktrees/capital-r12-currency-protected-nov03/personal-finance-app`.
Canonical was inspected at `0a9ca999c56b025622ed722e1cdc57fc11d2cce9`.
Neither checkout was edited by this repair.

## Preserved evidence and limits

The frozen stage's `.local/r13-resume-r12servercomposed37x/server.log` is 41,400
bytes, SHA-256
`76cd27d4d88c60925a57f4808a7d24a654c4bd91e846cd952d0121324c7b8ad6`.
Its bootstrap and manifest receipts identify base `62186d4a` and the disposable
target `pfa_completion_scope_r12servercomposed37x_test`. The old packet remains
unchanged. There is no `server.json`, final Vitest failure stack or postflight.
It cannot establish a completed run, exact failure cause or clean target state.

Observed console evidence:

- Lines 6–16: the late-custody case's initial DELETE returns 204, then its retry
  returns the expected 404 at `2026-11-03T01:40:56.625Z`.
- Lines 25–72: six sequential login completions follow. The first five complete
  by `01:41:22.858Z`; the sixth completes at `01:41:28.184Z`, under the next
  selected-SID case's log heading. This spans 31.559 seconds after the expected
  custody refusal. The configured hook timeout remains 30 seconds.
- Lines 78–82: the selected-SID case's initial DELETE returns 404. Its source
  requires 204 before installing the withdrawal gate.
- Lines 226–228: the DELETE file reports 58 cases, two failed, named late
  custody withdrawal and late selected-SID withdrawal. The following remaining
  basis and opening files report all 14 and 22 cases skipped respectively.

A cleanup overrun continuing into the next case is a hypothesis consistent
with that timeline and the source. The incomplete packet does not prove a hook
timeout, prove why the next holding was missing, establish the downstream setup
failure reasons, or diagnose the eventual interruption. There is no product
root-cause or verified-fix claim.

## Bounded source repair and restoration trace

Only `server/routes/__tests__/completion-r13.holding-delete.realdb.integration.test.ts`
changes executable code. Its old boolean caused both session stores to be
cleared and all six actors to sign in again after every marked scenario,
including grant-only and custody-only withdrawals.

The replacement tracks actor roles and refreshes only their session records.
The second-device login helper registers its actor before its first awaited
operation. Both late-revocation gates register the owner immediately before the
awaited revocation transaction. Thus a failed later assertion still leaves the
affected actor registered for cleanup. Cleanup deletes that actor's persisted
`session` rows and `userSessions` tracking rows, then uses the real login route
to obtain a current-generation cookie. Registrations clear only after successful
replacement; `beforeEach` no longer discards a pending registration.

All unconditional restoration remains: `vi.restoreAllMocks()`, every actor's
`erasedAt: null` and `emailVerified: true`, all five original household roles,
and the existing holding/history/security cleanup. The detached-creator case's
temporary admin erasure is covered by the same unconditional user restoration.
`reset()` still recreates the original account custody before the next case.

Why verification/temporary-erasure restoration does not need replacement login:
`server/auth.ts` resolves current user state and returns a refusal without
destroying the session; `server/config/session-store.ts` filters erased users
on reads and declines invalid saves/touches without deleting their stored row.
The fixture changes only `emailVerified` or `erasedAt`, then restores those
fields. By contrast, `server/services/session-revocation.ts` really deletes both
stores, and revoke-all also increments `securityGeneration`. That generation is
preserved; the replacement login binds to its current value. Selected-SID
revocation markers remain intact until the owning synthetic user is removed.

All existing test cases, gates, authorization/privacy checks, response and
persistence assertions remain. The original 68 assertion-bearing source lines
are unchanged. There is no timeout increase, product/helper,
schema, dependency or migration change. Initial six-actor `start()` remains
unchanged; this candidate does not repair a possible slow `beforeAll` elsewhere.

## Checks actually performed

- Read-only source/log comparison and mutation/cleanup trace.
- `git diff --check`: passed before commit.
- Static comparison of assertion-bearing source lines: baseline 68, candidate
  68, zero changed lines. This is source preservation, not test execution.

No test, login, database command, application startup, browser/native check,
build or typecheck was run. No cluster/service was started or stopped. The
candidate has no runtime receipt or pass count, and independent review is
pending on the other account.

## Fresh verification instructions for the coordinator

First independently review this diff against the base and the guard/store
trace above. The coordinator owns the serialized runtime window, dependency
and Node identity, cluster identity/start decision and newly marked target.
Do not reuse or overwrite `37x`. No command below was executed by the author.

After that window is explicitly granted and the protected environment is bound
to a fresh migrated disposable target, use the candidate worktree and record
its exact clean HEAD. The complete signed DELETE file must run, including
real second-device login, selected-SID and generation revocation, grant,
custody, verification and erasure refusals, late replay withdrawals, exact
gate-execution witnesses, unchanged financial state, rollback and races:

```powershell
node scripts/run-protected-tests.mjs database vitest --server run routes/__tests__/completion-r13.holding-delete.realdb.integration.test.ts --maxWorkers=1
```

Then reproduce the affected composed boundary on the same immutable candidate
with the R12 selector tests and both formerly setup-skipped caller files:

```powershell
node scripts/run-protected-tests.mjs database vitest --server run routes/__tests__/completion-r12.holdings-currency.realdb.integration.test.ts routes/__tests__/completion-r13.holding-delete.realdb.integration.test.ts routes/__tests__/completion-r13.holding-remaining-basis.realdb.integration.test.ts routes/__tests__/completion-r13.opening-holding.realdb.integration.test.ts --maxWorkers=1
```

Use the coordinator's normal wrapper to preserve full output, final Vitest
failure stacks if any, exit/SHA/timing receipts and matching protected
postflight counters. Confirm the custody-only cases no longer trigger six
replacement logins, selected-SID's initial 204 and delegated gate both run,
and the following complete files execute rather than skip during setup. A
new failure requires diagnosis from its actual completed report. This bounded
run cannot replace the remaining R12 composed/server/client/project/browser
gates or independent acceptance, and closes no canonical requirement.
