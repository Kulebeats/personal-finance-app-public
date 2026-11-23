# C2 SOL corrective handoff

31 October 2026. All four requested source corrections are implemented locally;
independent review, persistence/browser verification and canonical integration
remain with main. This is not campaign acceptance or release clearance.

Resume from `C:\Users\USER\.codex\worktrees\c2-review-remediation`, branch
`codex/c2-review-remediation`. Reviewed starting head:
`454699120a0daf6b31cd49de39ae7980d7e4e440`. Final source/test head:
`9e49023745fd3b7d95049e442fa8c229a3bf0475`. Main's browser preparation in
45469912 is preserved. The following documentation commit changes no source.

Read this correction record first, then main's
`C2-SOL-REVIEW-HANDOFF-2026-10-31.md` (canonical review-document commit
`b97a4f31799d328e7950c304de63d52922ea4531`), then the relevant diffs and tests.
`C2-REMEDIATION.md` and `C2-HANDOFF.md` retain the original history and remaining
broader proposals. Their broad rejected-auth suppression and duplicate-controller
audit descriptions are superseded by this record.

## Changes and evidence

| Finding | Local commits | Result |
| --- | --- | --- |
| SOL-01 | fd95280b | MutationCache exempts INVALID_CREDENTIALS just as protectedFetch does. Actual useChangePassword/useChangeEmail regressions preserve active lifetime and form draft; genuine UNAUTHORIZED still withdraws. |
| SOL-02 | 5814d22c | Wrong-password and unknown-address login return the same explicit INVALID_CREDENTIALS 401 before SID rotation. Only that login rejection suppresses broadcast. Unknown failures, including UNAUTHORIZED after rotation and unsuccessful unclassified envelopes, refresh peers. |
| SOL-03 | 57d94e8e, 9e490237 | Bulk tags no longer emit a second requested-ID audit. IP flows through the actual legacy facade and helper to the existing atomic writer. Unit coverage preserves per-item results, duplicate/no-change delegation and failure reporting. |
| SOL-04 | 4df8ebc7 | Public/authenticated resend mint the challenge after lock and cooldown admission. Email-change issuance also mints after locked validation. Both resend entrypoints retain a full 60-second cooldown after a simulated 61-second lock wait. |

SOL-02's deterministic test executes actual authService.login,
authSessionService.finalizeLogin/regenerateSession and registerSessionIdentity.
It pauses findSessions after old-SID revocation/regeneration, changes the
synthetic persisted password/generation, then resumes real identity validation.
The result is UNAUTHORIZED, no new tracking insert, no authenticated request
identity, and an emitted signal that retires a simulated peer lifetime/draft.
Known/unknown-address wrong-password controls never rotate/revoke and preserve
the peer draft. Database operations and the session store are adapters; storage
signals are replayed into a simulated peer after origin completion. This is not
real PostgreSQL or a two-browser proof.

Conservative behavior is intentional: registration, MFA and reset currently
lack an explicit failure guarantee that session authority stayed unchanged, so
their failures broadcast. The old blanket assertion that every rejected auth
attempt preserves peer drafts is withdrawn. Login lockout/verification denial
also broadcasts; only the proven pre-rotation credential code suppresses it.

SOL-03 keeps the existing TagWriteRepository actual-effect audit inside its
transaction, including an empty delta for a duplicate retry. The focused unit
test uses the actual controller, legacy facade and helper, with a mocked atomic
writer; it does not prove database rollback. Added unrun database cases in
`server/modules/tags/__tests__/completion-c2.cross-writers.realdb.integration.test.ts`
assert one audit per bulk item, empty retry delta, IP presence, unchanged physical
counts, reconciliation refusal, and rollback after an actual audit insertion
followed by a synthetic failure. Existing R04 single-tag rollback/counter tests
remain unchanged and required.

## Verification commands and results

All commands ran serially in the owned checkout through the protected UNIT
runner, with `--maxWorkers=1`, pinned Node v24.22.0 and NODE_OPTIONS/NODE_PATH
cleared. Prepend this directory to PATH (the older C2-HANDOFF path is stale):

```text
C:\Users\USER\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\capital-r00-runtime\node-v24.22.0-win-arm64
```

Final client command: 5 files / 41 tests passed (`.local/c2-sol/client-final.log`).

```text
node scripts/run-protected-tests.mjs unit vitest run --config client/vitest.config.ts client/src/pages/Login/__tests__/completion-c2.login-rotation.test.ts client/src/pages/Login/__tests__/auth-transition-races.test.ts client/src/hooks/__tests__/completion-c2.settings-credential-boundary.test.tsx client/src/lib/__tests__/queryClient.authExpiry.test.ts client/src/lib/__tests__/session-context-preconditions.test.ts --maxWorkers=1
```

Final server command: 3 files / 19 tests passed (`.local/c2-sol/server-final.log`).

```text
node scripts/run-protected-tests.mjs unit vitest --server run services/__tests__/completion-c2.bulk-tags.test.ts services/__tests__/completion-c2.email-resend.test.ts modules/auth/__tests__/auth.login-verification.test.ts --maxWorkers=1
```

Existing caller check: 2 files / 40 tests passed (`.local/c2-sol/old-callers.log`).
Despite its filename, tags.integration uses mocked persistence in this UNIT run.

```text
node scripts/run-protected-tests.mjs unit vitest --server run services/__tests__/completion-c2.credentials.test.ts modules/tags/__tests__/tags.integration.test.ts --maxWorkers=1
```

These three non-overlapping selections total 100 passing tests. Client-final and
server-final ran on the exact source subsequently committed as 9e490237;
old-callers ran at that commit. No later source/test edits were made.

Preserved RED evidence under `.local/c2-sol/`: SOL-01 `01-red2.log` (2 failed,
1 passed); SOL-02 `02-red.log` (7 failed, 4 passed); SOL-03 `03-red.log` (1 failed,
8 passed); SOL-04 `04-red.log` (2 failed, 4 passed). Original `01-red.log` remains
as an earlier test-wait attempt. Bounded green logs also remain. They are ignored
local evidence and must be read from this worktree, not expected in a Git clone.
`git diff --check` passed before commits.

## Outstanding verification and authority

Main should independently review the exact final candidate, including TypeScript
and final Astra review as allocated. No new agent/team was created here. No local
typecheck/build/broad suite, database, browser or native check was run. The
coordinator's policy-rejected PostgreSQL startup/bootstrap was not retried or
bypassed. Prepared database/browser tests remain unexecuted on this candidate.

Original author results (81 server / 67 client) and main's separately reported
89 real-DB passes retain their original attribution and candidate scope. They
are not new verification of these corrective commits. The reviewer Node22
preflight failure did not run TypeScript and is not evidence of a source defect.

Main owns any permitted disposable-target allocation, subsequent runtime proof
and canonical integration. No canonical/primary edits, package/lock changes,
push, PR, merge, deployment, provider request or external message was performed.
Only the user-authorized coordinator handoff is sent. Broader C2 findings and
proposals in the original handoff are not closed by these four corrections.
