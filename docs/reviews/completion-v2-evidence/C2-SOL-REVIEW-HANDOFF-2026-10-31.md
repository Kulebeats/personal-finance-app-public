# C2 independent Sol general and TypeScript reviews: corrective handoff

Reviewer: independent code-reviewer agent, gpt-6.1-sol Extra High, not the author.
Candidate: `454699120a0daf6b31cd49de39ae7980d7e4e440`, diff from `aa62784c`.
Author checkout: `C:\Users\USER\.codex\worktrees\c2-review-remediation`.
All36 changed paths and relevant actual callers were reviewed read-only. No
tests, database operations, network calls, source edits or commits were made by
the reviewer. The candidate stayed clean and pinned.

Disposition: two HIGH findings must be resolved before bounded source acceptance.
Two MEDIUM issues also need correction/adjudication. Independent Sol Extra High
code-reviewer and typescript-reviewer agents completed their respective reviews;
the language review corroborated both HIGH findings and added C2-SOL-04 below.
Domain/runtime evidence and Astra High final acceptance remain distinct gates.
No canonical application integration is authorized by
this record. The separate C2 chat retains implementation ownership.

## C2-SOL-01 — HIGH: credential rejection still withdraws real settings forms

client/src/lib/protected-fetch.ts:20 exempts INVALID_CREDENTIALS from transport
invalidation, but client/src/lib/queryClient.ts:98 still treats every401 except
STEP_UP_REQUIRED as lost authority. Actual useChangePassword/useChangeEmail
mutations use that data client. After correct step-up, wrong current credentials
reach MutationCache.onError, call the boundary withdrawal path and unmount the
form through SessionProvider. This is an incomplete repair of the original C2-03
behavior, not a new claim of full browser reproduction.

Repair the credential distinction at the query/mutation boundary as well. Preserve
genuine expired/revoked session invalidation. Add a test through the actual hook
and active lifetime/boundary callback, asserting that the fields remain after
credential rejection. Keep a genuine session401 withdrawal control. The prepared
browser test at e2e/completion-c2-credentials.spec.ts:61 should exercise the
wrong-current-password caller after successful step-up; it has not run.

## C2-SOL-02 — HIGH: late login failure suppresses required cross-tab retirement

client/src/pages/Login/useAuthHandlers.ts:89 assumes any HTTP failure below500,
other than SESSION_CONTEXT_CHANGED, did not change shared session authority.
The real server sequence contradicts that assumption: auth.session.service.ts
regenerates/revokes the old SID before calling registerSessionIdentity. A
concurrent password reset between regeneration and registration causes
server/services/session-identity.ts:46 to throw UNAUTHORIZED401 after retirement.
The new client predicate suppresses the broadcast, leaving another tab's old
financial UI/draft active until another refresh. This is a source-confirmed new
regression in the candidate; its race has not been executed here.

Suppress broadcasts only for outcomes explicitly guaranteed to precede mutation
of session authority. Distinguish rejected login credentials from failures after
rotation; status401 alone cannot distinguish them. Add a deterministic barrier
regression that changes the target credentials after regeneration and before
registration, then proves the other tab retires its old lifetime. Retain the
ordinary mistyped-password control that preserves the existing tab's draft.
The server path is server/modules/auth/auth.session.service.ts:42,132; it must be
considered together with the client transition contract, not mocked away.

## C2-SOL-03 — MEDIUM: redundant bulk-tag audit contradicts actual effects

server/services/transaction/tags.ts:57 now delegates to the writer's atomic
actual-effect audit, while server/modules/transactions/transactions.bulk.controller.ts:193
still appends an UPDATE audit per transaction using requested addedTagIds. A
duplicate retry records both an empty actual effect and a claim that the tags
were added. The requested-delta behavior pre-existed; adding the writer audit
introduces the duplicate records and exposes the contradiction.

Remove the redundant per-item controller audit and pass request IP to the writer,
or provide an explicit reviewed reason for separate events with truthful,
non-overlapping semantics. Test one operation audit per item and accurate empty
actual deltas on duplicate retry. Preserve rollback and usage-count integrity.

## C2-SOL-04 — MEDIUM: resend cooldown includes the row-lock wait

server/services/security-email.ts:72,99 creates the challenge before awaiting
the user-row lock. At76,104, cooldown logic reconstructs issuance time from that
earlier expiry, and78,105 persist it unchanged. The separately fresh updatedAt
is not used by resendDelay. A10-second lock wait leaves only50 seconds after
actual issuance; a wait of at least60 seconds permits immediate subsequent token
rotation. This is source-confirmed async behavior; the race was not executed.

Mint the challenge after acquiring the lock and passing cooldown admission. Add
a deferred-lock/controlled-clock regression for both public and authenticated
entrypoints: advance time while waiting, release the lock, then verify immediate
retry cannot rotate the newly issued token. Preserve generic public responses
and the existing rate-limiter boundary. Do not send real email in verification.

## Author return contract

1. Reconcile current C2 worktree status and pin before editing. Do not revert
   coordinator browser preparation or unrelated work. If the candidate changed,
   report its exact new base and retain the original review attribution.
2. Implement only the bounded corrections under existing C2 ownership, with
   old/new-caller regression coverage. Separate pre-rotation credential rejection
   from post-rotation failure explicitly; do not solve either HIGH finding by
   suppressing every401 or by invalidating on every login failure again.
3. Commit each finished correction locally and return exact commits, changed
   paths, executed commands/results and any unresolved finding. Preservation is
   not acceptance. Do not claim a browser or DB result from a unit mock.
4. Main schedules protected database/browser/broad-test windows. The owned
   database startup/bootstrap tooling rejection is still unresolved and must not
   be bypassed. No production/shared database or real external delivery.
5. Return to independent review on the final changed source, then Astra final
   review before local canonical integration. No push, PR, main merge or release.

## Scope and evidence limits

No additional actionable regression was established in the reviewed import
capability check, receipt counter path, APP_URL startup
validation, summary extraction or shortcut guards. This does not certify missing
concurrency, limiter, performance, startup or browser acceptance.

The earlier author81 server/67 client passes and parent89 protected real-DB passes
retain their original attribution. New browser journeys remain unrun. Open
C2-04/07/08/09/12/13/15/16, historical counter mismatches, other legacy tag producers
and inherited ledger defects remain separate. All canonical requirement statuses
are unchanged. The human owner explicitly authorized sending this review to the
separate remediation chat and requesting fixes on31 October2026. Both frozen
reviews have finished and the author may now act on this handoff; no further
messaging permission is needed for this handoff.

The TypeScript reviewer's attempted npm run check exited1 at the initial runtime
guard: `Node 24.22.0 is required; running 22.23.2`. TypeScript and later checks did
not run. This failed preflight is preserved as reviewer-reported evidence in
canonical .local/c2-sol-review-oct31a/reported-preflight.txt, not relabelled as a
candidate compile failure. It was not retried. The reviewer independently read
the coordinator's7bf99d17 check receipt/log hash and the current focused e2e tsc
receipt/spec/config hashes. ESLint was unavailable locally. No new test or browser
result follows from either source review.
