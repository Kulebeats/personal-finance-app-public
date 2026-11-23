# R05 notification preference partial-update candidate

29 October 2026. Governing requirement: master R05.1 / NEW-26, omitted threshold
preservation, explicit null clearing and allowlisted notification type. Status:
implemented and independently reviewed in an isolated author checkout, pending
Astra final review and canonical integration. This is not all notification/settings acceptance.

Author: `C:\Users\USER\.codex\worktrees\capital-r05-notifications\personal-finance-app`,
branch `codex/r05-notification-patches`, base
`f965f5f7`. The parent created this checkout to avoid changing the frozen R18
profile candidate. Its ignored `node_modules` junction points to canonical's
existing dependency tree; no dependency install or lockfile edit occurred.
The protected test output identifies the new author root. Node is the pinned
Windows ARM64 24.22.0 runtime; installed Zod here is 3.25.76.

## Defect and change

The controller previously added `thresholdAmount: null` even when the incoming
patch omitted it. A toggle-only update therefore erased a stored threshold.
Its creation branch also treated numeric zero as absent, while the validation
schema accepted arbitrary notification-type strings.

The candidate changes only the notification branch of `settings.controller.ts`
and its schema in `settings.validation.ts`: omit undefined thresholds from the
writer payload, retain explicit null, stringify supplied values including zero,
and use the existing shared `NOTIFICATION_TYPES` allowlist through Zod's
`nativeEnum`. Existing notification integration coverage now uses canonical
`BUDGET_WARNING` instead of the unrecognized legacy `budget_alert` fixture.
No financial threshold policy, schema migration, delivery service, auth contract
or profile-field behavior is changed.

New test: `server/modules/settings/__tests__/completion-r05.notifications.realdb.integration.test.ts`.
It verifies authenticated HTTP writes and separate DB/GET readback for the
master's `250.50` example, explicit null, numeric/string zero creation, flags,
an untouched sibling preference and a second user's row. An invalid type in a
batch must fail before any preference or audit change. It does not establish
general batch atomicity after a valid request encounters a later database error.

## Executed evidence

Author `.local/r05-notifications/`:

- `red.log/.exit`: unchanged application, 3 failed / 2 passed, exit 1. Failures
  reproduce omitted-threshold loss, numeric-zero loss and unknown-type success.
- `green.log/.exit`: first attempted enum API was incompatible with installed
  Zod 3 and produced TypeError/500s. This failed implementation attempt is
  preserved despite the historical filename.
- `green-corrected.log/.exit`: corrected candidate, 5/5 passed, exit 0.
- `existing-notification.log/.exit`: existing notification integration case
  passed, five unrelated cases filtered out, exit 0.

Canonical `.local/r05-notifications-oct29/` records preflight/postflight marker
verification and smart shutdown. Target is the existing disposable
`127.0.0.1:55432/pfa_completion_identity_r01int15a1_test`, run `r01int15a1`, role
`pfa_campaign`. Preflight found zero fixture users/competing connections; final
readback found zero new/legacy settings fixture users and zero other target
connections. Only owned postmaster PID 27808 was started and stopped. Shared
PostgreSQL, production services and real-message delivery were untouched.

## Remaining work and integration boundary

Independent Sol Extra High general and TypeScript reviewers are assigned. The
full author repository check is running; do not infer its result from focused
tests. Astra final review remains unavailable from the earlier usage-limit
checkpoint; no new quota retry is counted as progress.

The client notification mutation currently replaces its cache with the touched
rows returned by PUT. A partial request could therefore hide untouched cached
preferences until refetch. That separate client follow-up remains open; this
server candidate does not claim to fix it. Frozen R18 profile changes also
touch controller/schema files in other sections. Integrate accepted changes
by reviewed hunks against current canonical, never by overwriting either
candidate's whole files. All canonical groups remain OPEN.

## Cross-route review correction

Both independent Sol Extra High reviewers found the original enum too narrow:
the investment-preferences route writes `maturity_reminder`, `coupon_payment`
and `auction_results` into the same preference table, but the general form
resubmits all returned rows. The initial enum would reject those valid rows
and prevent a general settings save. Three new real-route tests reproduced
that regression: `compatibility-red.log/.exit`, 3 failed, 5 filtered, exit 1.

The final six-file candidate adds a shared readonly
`INVESTMENT_NOTIFICATION_PREFERENCE_TYPES` tuple containing exactly the five
types previously accepted by the investment route. That route now consumes the
shared tuple; the general validator accepts its union with `NOTIFICATION_TYPES`.
No new investment type or preference value policy was introduced. Each new
case creates an investment preference via its actual HTTP endpoint, reads it
through general settings, resubmits the batch with a changed general toggle,
and verifies DB values remain intact. `compatibility-green.log/.exit` passes
8/8, exit 0. Both reviewers re-read the changes and report no remaining scoped
static finding; their reviews are not independent test executions.

Final source freeze: author `.local/r05-notifications/source-freeze.json`,
SHA-256 `97d3f7268e98dd31053f5af119e5b2b8d458887948e2c1c73b1fec5496066758`.
It pins all six files. They remain uncommitted and unintegrated pending Astra
final review. The earlier full check passed before this compatibility revision;
the new `check-compatibility.log/.exit` must be assessed separately.

The compatibility run used owned PostgreSQL PID28756 on the same verified
synthetic target. Final readback found zero fixture users/other connections;
the owned process was smart-stopped. Canonical `postflight-compatibility.log/.exit`
and `stop-compatibility.log/.exit` preserve that cleanup evidence.

Remaining related defects are explicit: the investment route's own threshold
writer still uses truthiness and may clear omitted thresholds or numeric zero;
its writer was not changed here. General client cache replacement and whole-map
submission also remain. Arbitrary historical types accepted by the former
unrestricted API are not granted new authority by this allowlist; their actual
prevalence has not been measured. A client changed-only save can avoid
resubmitting untouched unsupported legacy rows. Do not describe this candidate
as complete notification preference behavior until those paths are addressed.

The final compatibility revision's full `npm run check` passed under pinned
Node 24.22.0: author `check-compatibility.log/.exit`, exit 0. All six frozen
source hashes were rechecked after validation. No source drift was found.

Canonical consolidated receipt:
`.local/r05-notifications-oct29/receipt.json`, SHA-256
`179339acb4c3a88df933125eb3d04e039f0831dbe5929944aa1c785849281bb1`.
It pins all author source/test/check evidence and canonical target/cleanup
evidence, preserving failures separately from the final passing results.

## Investment threshold continuation — 30 October local time

Sol Extra High `notification_investment_patch` added a dedicated integration
test before changing the investment writer. Parent protected RED reproduced
three defects (3 failed, 1 passed): omitted threshold loss and numeric-zero
loss on both create and update. The worker then changed only that route's
threshold assignment and GET fallback. Omission now leaves the stored value
unchanged, explicit null clears it, and zero is stringified consistently.

Parent combined verification passed 12/12 across the investment and general
notification files: author `.local/r05-notifications/investment-and-general-green.log/.exit`.
The new test is
`server/modules/settings/__tests__/completion-r05.investment-notifications.realdb.integration.test.ts`;
RED is `investment-red.log/.exit`. Both routes were exercised with actual HTTP,
DB and GET readback. No delivery/provider call or financial policy was added.

The same persisted synthetic target marker was independently checked before
the run. Owned PostgreSQL PID12200 was smart-stopped after final readback
confirmed zero `r05i-`/`r05n-` fixture users and zero competing connections.
Canonical evidence is `.local/r05-investment-notifications-oct30/`, including
`postflight.log/.exit` and `stop.log/.exit`; author preflight is
`investment-preflight.log`.

Independent general review reports no scoped finding; TypeScript follow-up
is pending. The earlier six-file freeze and receipt describe the prior
candidate, not this route revision. A new combined freeze follows the separate
client work; pending client implementation and final review are not implied by
the server's 12-test result.

TypeScript follow-up also reports no scoped finding. Server source/test and
the 12-test/target evidence are pinned by canonical
`.local/r05-investment-notifications-oct30/receipt.json`, SHA-256
`29a3fca57feffeac6698df2710a3671afbc251be2816899ab1c6d045094c468f`.
This receipt is deliberately server-only and does not approve the concurrently
changing client candidate or replace the combined final check/Astra gate.

## Client partial-save continuation

Sol Extra High `notification_client_patch` owns four client files: notification
hook code in `use-settings.ts`, `NotificationsForm.tsx`, the new rendered
`NotificationsForm.partial.test.tsx`, and a narrow CSRF test response fixture.
The form now stores field-level drafts over fetched preferences, submits only
changed fields/rows, sends nothing for a no-op, maps an explicit clear to null,
and preserves zero. A completed save clears only matching submitted fields,
preserving newer pending edits, including a change back to the old fetched
value. Failed saves retain drafts for retry. Untouched unsupported historical
rows are not resubmitted. The hook merges returned preference rows into the
cache instead of discarding untouched rows and suppresses stale cache/toast
effects through the existing operation lifetime.

Existing session infrastructure supplies the pre-dispatch and remount guards:
`LifetimeQueryClient` checks its bound operation before the mutation function,
and `SessionBoundary` keys the provider by operation ID. Tests use the actual
protected client to prove a retired operation makes no API call before dispatch,
and a keyed provider remount to prove fresh identity draft state. No replacement
session architecture or extra identity wrapper was retained.

Author evidence under `.local/r05-notifications/`:

- `client-red.log/.exit`: original form/hook, 5/5 failed, exit1.
- `client-focused.log/.exit`: final nine rendered/hook cases plus the 38-case
  CSRF matrix, 47/47 passed, exit0. Earlier 45-test progress reports preceded
  the two real-boundary cases; this path holds the later 47-test result.
- `client-parent-final.log/.exit`: parent-added API-failure preservation suite,
  52/52 across three files, exit0.
- `check-final.log/.exit`: full check failed with TS2345 because the notification
  mutation wrapper's unannotated input inferred `void`. The Sol build resolver
  changed only that parameter to `UpdateNotificationPreferencesData`; independent
  TypeScript review confirmed the correction. Its runtime behavior is unchanged.

The CSRF matrix used a generic successful response with empty `data` for every
mutation. Only its notification response now supplies `preferences: []` to
match the actual endpoint. Request/CSRF assertions remain intact; production
code rejects a response without a preference array. Independent general and
TypeScript reviews report no remaining scoped client finding after correction.

Combined current freeze (11 files): author
`.local/r05-notifications/source-freeze-combined.json`, SHA-256
`7d6ee8ed55a37b4298b38410210ceacdcad8e59a86c410baa98713d787266402`.
Earlier six-file freezes remain historical. The final typed full check in
`check-final-typed.log/.exit` passed with exit0.
Astra final review, canonical integration, browser journeys and broader R05
requirements remain separate gates.

Final typed full check subsequently passed, exit0; all 11 frozen source hashes
still match. The 52 client tests preceded only the erased TypeScript parameter
annotation; the final compiler/LOC/tool/assessment checks verify that annotation.
The server bytes are those exercised by the combined 12-test protected run.

Canonical combined evidence receipt:
`.local/r05-investment-notifications-oct30/combined-receipt.json`, SHA-256
`9813e80684ce3c28ebf07c7ff02b6abef22c0a5e5f4526410093ffd4794248b9`.
It records the 11-file freeze, source recheck, exact evidence hashes, the
52-client/12-persistence results, full-check exit0, and pending final-review
and integration status. No source acceptance or browser/release proof is
inferred from this documentation checkpoint.

## Acknowledgement repair and final source clearance, 31 October 2026

The earlier pending-review and uncommitted labels above are historical. Preserved
candidate `fe7b7353` received Astra review, which found a MEDIUM client defect:
an empty/incomplete or contradictory notification save response could report
success and clear unsaved drafts. The original finding and its adjudication are
retained in NOTIFICATION-FINAL-REVIEW-2026-10-31.md.

Corrected author HEAD is `13efc5ad20897c4027369d156d9467f42efb8f27` on
`codex/r05-notification-patches`, clean after the explicit three-path commit.
The mutation now validates usable rows, unique requested-type coverage, expected
subject and every submitted field before cache/success effects. Exact decimal
comparison accepts persisted normalization; null, false and zero remain distinct.
The existing form therefore retains failed drafts and newer in-flight edits.
The CSRF success fixture now acknowledges a nonempty mutation realistically.
No server source, schema, identity infrastructure or production behavior outside
this notification response boundary changed.

New 28-case rendered tests exercise the actual form, mutation hook and protected
HTTP caller with controlled HTTP responses. Before production edits they recorded
22 failures and 6 passes. The same test bytes then passed with existing partial-
save/lifetime and CSRF callers: 75/75 across three files. Fresh `npm run check`
passed, including TypeScript and repository guards. These are client unit and
static checks, not a browser or persistence rerun. Historical server results
retain their original attribution.

Author packet `.local/r05-notification-ack-oct31a/` retains exact commands,
timestamps, original source pins, failed/passed logs and commit readback:

| Artifact | SHA256 |
| --- | --- |
| `red.log` | `162803f24ff7ac35a347d28010935fd7221ec97e5db030fb27178c4df3af568e` |
| `green.log` | `a0585699a4e56199df899b5ff240d37f52ff0e8a175a96ba3c49e4adb6ca0f8c` |
| `check.log` | `0d94f6de65f77b56b5682951b550884e305e07eebe5ba9cad1750cfbe6742bc2` |
| `source-freeze.json` | `6019384d9997cbbdcf6534958d10c64a1dbab66864ff2af9c30d120ec633f3c8` |

The freeze pins all 12 candidate files and ten execution artifacts. The fresh
check's textual output matches a historical check hash; its new command/result
timestamps identify this separate execution. All 12 source pins remained
unchanged across the commit. Independent Sol TypeScript review and Astra final
source/evidence review cleared the corrected scope; final review report SHA256
`b8f9563ced6f944adbf357311f8936fab89acc03bdfc21a434cc498642ba2e62`.

Canonical integration is still pending, with current personal-preference changes
to shared hooks/tests to preserve. Recap cross-writer serialization, integrated
persistence/browser acceptance and full R05 closure remain separate requirements.
No shared/production database, external delivery, push, PR or release occurred.
