# R05 notification candidate: final source/evidence review

31 October 2026. Independent bounded review of author
`fe7b73539101d87bd883998a1c6c158b409d4844` against
`f965f5f77f158d32f08d1d2909fcfcc727b22d56`, with integration comparison to
canonical `d77c0413bccedf04627e6337223cd8159f489b72`. Author checkout:
`C:\Users\USER\.codex\worktrees\capital-r05-notifications\personal-finance-app`.
Both checkouts were clean at review entry. Only this report was written; no
application edits, tests, Node, database/browser processes or external sends.

**Disposition:** one MEDIUM client finding remains. Correct it in the existing
author candidate before combined final clearance/integration. No new actionable
finding in the bounded server threshold/allowlist changes. This is not whole-R05,
fresh integrated persistence, browser or release acceptance.

## Finding

### [MEDIUM] An unacknowledged response clears the notification draft

Author paths:

- `client/src/hooks/use-settings.ts:326-331,349-361`
- `client/src/pages/settings/sections/NotificationsSection/NotificationsForm.tsx:60-75`
- `client/src/hooks/__tests__/use-settings.csrf.test.tsx:390-392`

The new response guard checks only `Array.isArray`. For a nonempty request such
as `{notificationType: "large_transaction", emailEnabled: true}`, a response
`{data: {preferences: []}}` passes. The success handler leaves the old cache
unchanged and displays success; the form then removes the submitted draft.
The toggle returns to its old value and the user's edit is lost. A response
containing the requested type with the old field value has the same outcome;
a subset of a multi-row acknowledgement drops the unacknowledged drafts too.
Malformed row objects can also enter the cache. The adjusted CSRF fixture
currently treats an empty array as a successful acknowledgement of its nonempty
request, so that passing case does not protect this boundary.

This is a deterministic source finding, not a newly executed reproduction.
The real controller normally returns one persisted row per input; that does not
make an unchecked/missing acknowledgement safe or establish the claimed invalid-
response draft preservation.

**Required repair:** validate the successful response before any cache or success
effect. Require usable preference rows, unique requested-type coverage, matching
current subject where the operation provides it, and acknowledgement of every
submitted field. Preserve numeric equivalence for normalized decimal thresholds
(for example request `"0"` and persisted `"0.00"`), explicit null, false and zero.
Reject malformed/incomplete/contradictory acknowledgements and retain drafts for
retry. Do not replace the existing identity infrastructure or expand into C2.

**Minimum controls through the real hook/form:**

1. Nonempty request receives empty array, missing requested row, malformed row,
   duplicate/conflicting type, wrong subject, or unchanged submitted value:
   no success toast/cache poisoning/draft clearing; retry still sends the edit.
2. Two requested types receive only one valid acknowledgement: preserve the
   full pending request; do not silently report the batch saved.
3. Valid complete acknowledgement preserves untouched cached rows, clears only
   matching submitted fields and retains newer in-flight edits. Include decimal
   normalization (`"0"` -> `"0.00"`, `"250.5"` -> `"250.50"`) and explicit null.
4. Retain existing retired-before-dispatch and late retired-response controls;
   make the CSRF success fixture return a real acknowledgement for its request.

The initial correction requires focused client RED/GREEN evidence, not a new
database run. Any later integrated/server change has its own applicable gates.

## Evidence independently checked

| Artifact | SHA-256 / result |
| --- | --- |
| Author `.local/r05-notifications/source-freeze-combined.json` | `7d6ee8ed55a37b4298b38410210ceacdcad8e59a86c410baa98713d787266402`; all 11 file hashes and sizes match frozen/current committed source |
| Canonical `.local/r05-investment-notifications-oct30/combined-receipt.json` | `9813e80684ce3c28ebf07c7ff02b6abef22c0a5e5f4526410093ffd4794248b9`; all 14 referenced evidence hashes/sizes match |
| Nested `receipt.json` in that packet | `29a3fca57feffeac6698df2710a3671afbc251be2816899ab1c6d045094c468f`; all 10 execution/target artifacts match |
| `client-parent-final.log` | `4af2b0086f0b6f301af30e06c9b087191f9a2c9ee5cf322b5000a1a062b43a31`; historical 3 files / 52 passes, paired exit 0 |
| `investment-and-general-green.log` | `94a499e5d010b0306fbee15d566f245a5c588d5ef9611a26ac180131966fa010`; historical 2 files / 12 passes, paired exit 0 |
| `check-final-typed.log` | `0d94f6de65f77b56b5682951b550884e305e07eebe5ba9cad1750cfbe6742bc2`; historical full check, paired exit 0 |

The freeze/receipt's base-head and uncommitted-era status labels are historical;
the preserved committed candidate now matches their bytes. Failed original,
enum-API, investment and TypeScript attempts remain preserved. The 52-client
run preceded only the erased input type annotation; the final typed check
includes that annotation. No historical result is represented as a new run.

The 52-pass aggregate log does not name its three files or retain their command
in that log. Frozen notification coverage is nine rendered/hook cases plus the
38-case CSRF matrix. The identified additional five-case suite,
`client/src/pages/settings/__tests__/apiFailureStatePreservation.property.test.tsx`,
hash `247597553e3be2af12483ab72fa48a258e1c416cdecbc4ce21991301e008f7f8`,
uses `useProfileForm`, not notifications. Its bytes and five cases were checked;
do not call those five notification malformed-response controls or infer exact
execution selection solely from the aggregate count.

Server tests exercise real authenticated HTTP with separate SQL/GET readback:
omission preserves 250.50 and unrelated rows; explicit null clears; numeric/string
zero survives; invalid types reject before the batch writes; investment-created
types survive a general-settings save. Historical target readback records the
synthetic `r01int15a1` database with zero fixture users/other connections and owned
postmaster shutdown. This proves neither general late-error batch atomicity nor
real-browser CSRF/session behavior.

## Current callers, overlap and remaining gates

- Existing lifetime protection is real: `LifetimeQueryClient` checks the bound
  operation before mutation dispatch; `SessionBoundary` keys the provider by
  operation ID. The candidate checks late success/error effects. No replacement
  session wrapper is needed; C2-owned authentication work remains separate.
- Canonical changes since the author base touch `use-settings.ts` and its CSRF
  test for personal preferences. Preserve those response/serialization guards
  and reconcile the already-present operation-lifetime import. Integrate hunks,
  never replace these whole author files. R18 profile and recap/widget candidates
  also share files and remain separately owned/reviewed.
- Recap semantic overlap remains open: canonical
  `server/modules/weekly-recap/weekly-recap.controller.ts:285-335` reads then writes
  the same weekly-recap preference; general notifications still use
  `UserRepository.ts:140-165` update-then-create without the pending recap
  candidate's user-row serialization anchor. Initial creation and cross-route
  ordering therefore need the already-documented shared-writer follow-up.
  The new partial updates improve preservation but do not solve that inherited
  race. It is not a newly introduced finding or silently accepted by this review.
- Broad threshold validation/policy, late database/audit failure atomicity,
  scheduled delivery, complete field inventory and browser acceptance are outside
  this bounded repair. After the client correction, pin and independently review
  the new bytes, then obtain fresh integration checks and applicable acceptance
  evidence. Existing 52/12 passes cannot certify a changed or integrated tree.

## Review Summary

| Severity | Count | Status |
| --- | --- | --- |
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 1 | repair requested |
| LOW | 0 | pass |

Verdict: WARNING — repair acknowledgement handling before combined final
clearance. Server subset has bounded source clearance; integration and broader
acceptance remain pending. Frozen author source is released back to its owner
for that correction; no implementation was performed during this review.

## Follow-up: acknowledgement repair reviewed — 31 October 2026

**Updated disposition: original MEDIUM resolved; bounded corrected source and
evidence cleared.** No new actionable finding. This supersedes the earlier
repair-pending disposition only for the exact frozen bytes below. Original
finding, failures and evidence remain above. Author HEAD is still
`fe7b73539101d87bd883998a1c6c158b409d4844` with three uncommitted changed/new paths;
coordinator must preserve them in a commit and confirm identical pins before
integration. No application edits or runtime were performed by this reviewer.

**Correction to the original review's CSRF wording:** the old CSRF case submitted
`preferences: []`, not a nonempty request, so its empty acknowledgement was valid
for that specific test. It supplied no nonempty-save acknowledgement coverage.
The deterministic form failure and original MEDIUM remain valid; the correction
now makes the CSRF case a nonempty request with a matching persisted row.

| Corrected author path | SHA-256 |
| --- | --- |
| `client/src/hooks/use-settings.ts` | `94b8d588c32959e7353144dc9f47ec3c9ba23d895e8e6c04da4dac3e68d8a371` |
| `client/src/hooks/__tests__/use-settings.csrf.test.tsx` | `c52787bf545ed7f29e51f8a59f4934c12fbac48a4c005641399236b5ef150d1b` |
| `client/src/pages/settings/sections/NotificationsSection/__tests__/NotificationsForm.acknowledgement.test.tsx` | `344ef3f37cd0b66b6f096a444b8aef358e9e765fad0b45616a4a1af99e2e5a67` |

The hook's new `notificationThresholdDecimal`, `isNotificationPreference` and
`validateNotificationAcknowledgement` (`use-settings.ts:308-357`) validate the
whole response before cache/success effects. Required row fields/channels and
decimal/null shape, unique types, bound subject, complete requested coverage and
every submitted field are checked. Decimal construction/equality avoids binary
floating point and accepts equivalent persisted scales without treating null
as zero. Empty/incomplete/malformed/contradictory responses reject while the
unchanged form retains drafts. Well-formed extra rows for the same subject are
permitted; untouched cache rows survive. The lifetime assertion still precedes
validation, and the original late-response, pre-dispatch and provider-remount
guards remain. No threshold business policy or server writer was changed.

The new 28-case suite renders the actual form and uses the actual mutation hook,
protected query client and API caller, controlling HTTP through `fetch` rather
than replacing these implementations. It covers invalid rows/subjects/coverage,
multiple fields and types, exact retry drafts, null/zero/normalized decimals,
reordered valid rows and preservation of newer pending edits. Existing partial-
save/lifetime tests and the CSRF matrix remain in the combined run.

Evidence is in the **author** `.local/r05-notification-ack-oct31a/`:

- `source-freeze.json` SHA-256
  `6019384d9997cbbdcf6534958d10c64a1dbab66864ff2af9c30d120ec633f3c8`:
  independently rehashed all 12 current candidate files and all 10 evidence
  entries, including sizes; zero mismatches. The original nine unchanged paths,
  including all server files and the form, retain their previous pins.
- RED command/result pin the same new test bytes against the original hook:
  **22 failed / 6 passed**, exit 1; `red.log` SHA-256
  `162803f24ff7ac35a347d28010935fd7221ec97e5db030fb27178c4df3af568e`.
- GREEN command explicitly names acknowledgement, partial-save and CSRF files:
  **75/75 passed**, exit 0; `green.log` SHA-256
  `a0585699a4e56199df899b5ff240d37f52ff0e8a175a96ba3c49e4adb6ca0f8c`.
  These are client UNIT controls with controlled HTTP, not browser/DB execution.
- Fresh full check ran 15:33:27–15:34:38 UTC, exit 0, with command/result retained.
  Log SHA-256 `0d94f6de65f77b56b5682951b550884e305e07eebe5ba9cad1750cfbe6742bc2`
  happens to match the historical textual output; the new command/result times
  distinguish this execution. Static/LOC/tool/assessment checks passed.
- Coordinator reports the independent Sol TypeScript re-review found no
  actionable issue at these exact pins; this reviewer independently inspected
  the implementation and raw evidence above rather than adopting that label.

Existing server persistence evidence remains historical for unchanged server
bytes; no fresh database or browser result is claimed. Canonical hunk integration
must still preserve personal-preference changes and separate recap/profile/C2
ownership. The previously disclosed recap shared-writer/initial-creation race,
broader R05 acceptance and release gates remain open. No unchanged database
rerun is required merely to close this client response finding.

### Follow-up Review Summary

| Severity | Remaining scoped findings | Status |
| --- | --- | --- |
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | original finding resolved |
| LOW | 0 | pass |

Verdict: APPROVE — exact corrected source/evidence within the bounded notification
candidate. Commit/pin confirmation, canonical integration checks and broader
acceptance are separate; no whole-R05 or release approval.
