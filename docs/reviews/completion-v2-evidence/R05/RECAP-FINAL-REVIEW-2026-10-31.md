# R05 recap/dashboard candidate: final source/evidence review

31 October 2026. Independent bounded review of original nine-file candidate
`53fcdf148a335737af23fd498e2405edf1b2a0e1`, base
`d57ce7d757ac8313940caa8c564313d4c617776c`, in
`C:\Users\USER\.codex\worktrees\capital-r05-recap-widgets\personal-finance-app`.
Canonical inspected at `b8f66f0de7bc64ef6d9ddf5d9f1d214e336c4b1d`; both trees
were clean at entry. Later `4bc66688820c301596e247330e07c9b9e8032e4a` was inspected
only for relevant inherited recap and shared-writer lineage, not its full 58-file
scope. Only this report was written. No tests, Node, database, browser or network
execution occurred.

**Disposition:** one MEDIUM client acknowledgement defect requires correction
before combined final clearance. No new actionable finding in the original
bounded recap/display transaction changes. Their existing shared-writer limits
and the preserved later repairs are distinguished below. This is not canonical
integration, fresh persistence, browser, full-R05 or release acceptance.

## [MEDIUM] Shape-valid PATCH response can discard an unacknowledged edit

File: `client/src/pages/settings/sections/WeeklyRecapSection.tsx:48-55,95-106`.
Test gap: `client/src/pages/settings/sections/__tests__/WeeklyRecapSection.persistence.test.tsx:20-26,152-164`.

`settingsFromResponse` correctly requires a successful envelope and all five
fields with valid types/day range. `updateWeeklyRecapSettings` does not compare
those values with the submitted patch. For baseline `emailEnabled: true`, a user
submits `{emailEnabled: false}`; a successful, otherwise valid response still
containing `emailEnabled: true` passes. `onSuccess` writes that old response to
cache, removes the matching submitted draft revision, and says the preferences
were saved. The toggle returns to true and the user's change cannot be retried
without re-entering it. A multi-field response acknowledging only some submitted
values similarly discards the others. Revision tracking protects *newer edits*,
but does not prove that the submitted revision was persisted.

The current invalid-response matrix covers envelope/shape failures, not this
fully shaped contradictory response. This is a source-established scenario;
no new failure was executed during review. The same component is inherited
unchanged by `4bc66688`, so the finding also needs propagation to the chosen
later integration lineage.

**Minimal repair:** after shape validation and before success/cache/draft effects,
require every explicitly submitted field to equal its returned value. Use exact
boolean/integer equality, including false and day zero. Compare only submitted
fields: valid changes to other returned fields must still be accepted. A mismatch
must reject and retain the draft/error/retry behavior. Keep the current revision,
transport and session-lifetime infrastructure; no new framework is needed.

**Required focused controls through the actual mutation/form:**

- Each of the five fields receives a valid old/contradictory value: no success
  message or cache change, draft remains, and retry sends the same edit.
- Multi-field patch receives only partial value acknowledgement: reject the
  whole acknowledgement without clearing any submitted draft.
- Valid complete acknowledgement, including false and day zero, clears only
  matching submitted revisions, accepts unrelated returned-field changes and
  preserves newer edits/pending reverts.
- Retain the existing malformed-response, load/retry, CSRF, retired-before-
  dispatch, delayed-CSRF and late identity-response controls.

The first repair is client-only and can use focused RED/GREEN controls without
rerunning unchanged database cases. Preserve the original candidate and failures;
return exact corrected pins and static evidence for final re-review.

## Source findings that support the bounded server design

`server/repositories/UserDisplayPreferences.ts:29-68,96-152` uses the existing user
row as an ordering anchor, then ensures/locks display state and locks the recap
preference before updating. This orders first creation as well as existing-row
changes. Recap notification and JSON changes share one database transaction.
Display layout writes merge only their widgets/version fields while preserving
recap/unknown siblings; recap preserves calendar/layout/channel/threshold data.
Recap day defaults independently to Sunday and controller validation rejects
fractional/out-of-range values. GET's shared user lock gives consistent paired
reads among writers honoring that anchor.

Relevant callers were traced: display GET initialization and PUT delegate via
`UserRepository`; registration creates display settings after the user insert;
the original report-widget route still performs a pre-lock merge. This review
does not mistake the latter inherited limitation for an atomic report writer.
Display audit occurs after the helper commit and recap audit remains the existing
non-blocking behavior; the candidate does not prove late audit-failure rollback.

The 22 new persistence cases independently read SQL and fresh HTTP, exercise
actual blocked writers using `pg_blocking_pids`, cover first creation and
disjoint writes, and inject PostgreSQL failures into either settings table.
Their cleanup is fixture-scoped. The tests establish the bounded two-table
contract, not arbitrary producer or audit atomicity.

## Frozen evidence verification

All **nine source files** and **41 receipt artifacts** were independently hashed
and size-checked against the manifests: zero mismatches.

| Artifact | SHA-256 / recorded result |
| --- | --- |
| Author `.local/r05-recap-widgets/source-freeze.json` | `c916fc2429ea7850655afd754afda7d12f725acb07f9b391a1c54eebd0b00916` |
| Canonical `.local/r05-recap-widgets-oct30/receipt.json` | `d1af19eaf642364e043622f06de3181fdf8807c7af28f94eb36726755ce96557` |
| Author `client-green.log` | `edfcedf8cde69984e4128bd5a14b4a1151f19dc8ee3b15501b7286323bcd2c26`; 40 passed / 3 files, exit 0 |
| Author `server-green-day.log` | `572da866b26dc607e72437c486622558965156188e6fd4323b426dd5886cbde3`; 47 passed / 2 files, exit 0 |
| Author `check-final-day.log` | `05fcd5c5614b1c9bb68b85a6aa392df2d834ba7aa7fa71e02651701cbf615d53`; full check exit 0 |

These are historical executions. Client coverage comprises 25 rendered recap,
eight CSRF and seven lifetime cases per the handoff; aggregate logs do not supply
new independent execution evidence. Server coverage is 22 new plus 25 existing
cases. Original RED, malformed-response RED, fractional-day RED and intermediate
failed runs remain preserved. Manifest base-head/uncommitted labels predate the
preservation commit; current source matches those frozen bytes.

Recorded target readback identifies marked disposable `r01int15a1` on loopback
55432, zero fixture users/competing connections; cleanup records zero legacy
recap users/households and failure triggers/functions. Both owned database
windows were stopped. No current service state or new database result is inferred.

## Later lineage and integration boundaries

At `4bc66688`, Git comparison confirms the original `WeeklyRecapSection.tsx`,
recap controller and `UserRepository.ts` are unchanged. The later
`UserDisplayPreferences.ts` preserves the original recap functions while adding
locked report merge/reset entrypoints. Its new
`server/repositories/UserNotificationPreferences.ts:26-65` locks the same user row
before reading/updating/creating notification rows; general settings delegates
to it. Associated preserved tests cover general/recap first creation in both
orders. A repair for the original general-notification/recap race exists in this
later isolated lineage, with its own review/integration gates. This inspection
is not final approval of that
entire later candidate or its execution evidence.

The coordinator must select and pin a coherent bounded port that retains those
reviewed writer contracts, existing canonical personal-preference changes and
the corrected notification acknowledgement work. Preserve profile/notification/
C2 ownership; do not merge either the original nine files or the later 58 files
blindly. Re-review the client correction, then conduct separately owned
integration checks and applicable fresh acceptance. Browser journeys and broader
R05/settings/delivery requirements remain open.

## Review Summary

| Severity | Count | Status |
| --- | --- | --- |
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 1 | repair requested |
| LOW | 0 | pass |

Verdict: WARNING — repair value acknowledgement before combined final clearance.
No new actionable server finding within the original bounded candidate; later
writer lineage and integration acceptance remain separate. Frozen source is
released to its existing owner for the scoped correction.

## Follow-up: submitted-value acknowledgement repair — 31 October 2026

**Updated disposition: original MEDIUM resolved; bounded corrected source and
evidence cleared.** No new actionable finding. This supersedes the earlier
repair-pending disposition for the exact pins below, preserving the original
finding and failed evidence. Author HEAD remains `53fcdf148a335737af23fd498e2405edf1b2a0e1`
with only these two uncommitted paths; coordinator must commit them and confirm
unchanged pins before a later port. This reviewer performed no application edits
or runtime execution.

| Corrected author path | SHA-256 |
| --- | --- |
| `client/src/pages/settings/sections/WeeklyRecapSection.tsx` | `3fb821d512acf471b805c0eef93e161a85dd3fbd6b806fcbbf8cc4b2b738413c` |
| `client/src/pages/settings/sections/__tests__/WeeklyRecapSection.persistence.test.tsx` | `94a3d809e50ea32a66b058608e93727b9a8911ae6b64a8eeb2ac8dc29867916c` |

`updateWeeklyRecapSettings` now validates shape, then compares each defined
submitted field with the returned value before resolving to success callbacks.
Exact boolean/integer comparison includes false and day zero. Undefined optional
properties omitted by JSON are not treated as submitted, and valid changes to
unsent fields remain accepted. Contradictory or partially acknowledged responses
throw the existing error before cache replacement, draft removal or success
messages. The revisioned draft and identity-lifetime paths are unchanged.

The same test bytes ran RED against the original production component and GREEN
against this repair. Added controls exercise all five contradictory values and
multi-field partial acknowledgement through the actual rendered form/mutation,
assert unchanged cache, retained drafts and exact retry. Positive controls cover
false, day 0/6, changed unsent values and undefined request properties. Existing
pending-edit/revert, malformed-response, CSRF and retired-identity controls remain.

Author evidence packet: `.local/r05-recap-ack-oct31a/`.

- `source-freeze.json` SHA-256
  `d169116487ab93ff7a1dbbb33cfd0fa63b4de1aea8cd0b51d7c7baf68f42ffdd`:
  independently rehashed all nine current candidate files and 11 evidence entries
  with sizes; zero mismatches. Seven unchanged paths, including all server files,
  retain their original pins.
- RED command pins original component `22f9dec8...` and the corrected test hash:
  **6 failed / 28 passed**, exit 1. Raw log SHA-256
  `4a58a9b0c596d8e73238ec76f8e442c69a027255d7f39f5c0c5a299004a6b5c7`.
- GREEN command explicitly names the three test files: **49/49 passed**, exit 0,
  comprising 34 recap cases, seven settings-section CSRF cases and eight operation-
  lifetime cases. Raw log SHA-256
  `21e9f31099faa319679e11b677f6897481cf85a1671094e59452ec0de328a2ce`.
  These are client UNIT controls with controlled HTTP, not database/browser tests.
- `green-prelaunch-refusal.json` preserves the coordinator's missing-filename
  guard refusal before Node/test launch. The path was discovered with `rg`, then
  the corrected explicit GREEN command ran; no failed test run is hidden there.
- Fresh full check ran 15:46:06–15:46:47 UTC, exit 0; command/result records and log
  were inspected. Log SHA-256
  `05fcd5c5614b1c9bb68b85a6aa392df2d834ba7aa7fa71e02651701cbf615d53`
  matches historical textual output, but the fresh command/result establish this
  execution. TypeScript, LOC and other repository guards passed.
- Coordinator reports independent Sol TypeScript re-review cleared both exact
  pins without actionable TypeScript/async findings; that reviewer ran no tests.
  This review independently inspected source, controls and raw evidence above.

No fresh server persistence or browser behavior is claimed. Existing server
evidence remains historical for unchanged bytes. The corrected component/test
must supersede inherited versions in any future port. The coordinator's
`R05/SETTINGS-INTEGRATION-MAP-2026-10-31.md` identifies a proposed coherent 22-path
recap/notification batch followed by 40 report paths; this clearance does not
allocate or approve either port, the full later writer snapshot, or its broader
requirements. Current-base reconciliation, fresh applicable integration checks,
browser acceptance and whole-R05/release gates remain separate.

### Follow-up Review Summary

| Severity | Remaining scoped findings | Status |
| --- | --- | --- |
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | original finding resolved |
| LOW | 0 | pass |

Verdict: APPROVE — exact corrected recap source/evidence within the bounded
candidate. Commit/pin confirmation and subsequent integration/acceptance remain
separate gates.
