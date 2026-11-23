# R05 current-base recap/notification settings port review

31 October 2026. Independent Astra final source review of the uncommitted port
in `C:\Users\USER\.codex\worktrees\capital-r05-settings-port\personal-finance-app`,
based on `f96905c95faa671cef6ceb86a395dc96e62a5306`.

**Source disposition: no actionable findings in the exact 22-path port.** This
is a current-base interaction review, not reuse of the old candidates' clearance.
The evidence and remaining gates below qualify the disposition. No application
files were edited and no tests, Node/application runtime, database, browser,
network operations or child agents were started by this reviewer.

## Reviewed bytes and scope

The worktree has 13 modified tracked paths and nine new files: eight client paths
and 14 server/shared paths, exactly the first batch in
`SETTINGS-INTEGRATION-MAP-2026-10-31.md`. No report-helper, report route, dashboard
page, migration, schema, manifest, configuration or authentication implementation
was added to the port. Staged changes were empty.

All 22 actual SHA-256 values and byte lengths match
`.local/r05-settings-port-oct31a/source-freeze.json`, SHA-256
`1f7ee732776544f7ea71a32d063fc53452d20a6729901e12b79396c6945aef11`.
That manifest is the exhaustive path/pin catalogue for this disposition.

Twenty files match their selected author source byte for byte. The two manual
merges are:

| Path | SHA-256 |
| --- | --- |
| `client/src/hooks/use-settings.ts` | `437a26031a46046abc73dcb722c8f244f718fb5d6fda61a32ed518f5815033fa` |
| `client/src/hooks/__tests__/use-settings.csrf.test.tsx` | `d5556d62e794e0de01acdcc322979c027e28c03f4b2fe9e5116c8a2613380e96` |

The corrected recap component/test match `86e8ba38`; notification source/tests
retain the correction preserved at `13efc5ad`. The settings controller matches
the reviewed writer version (`dfd07b5b2a20e652acc98541deda05f42b350c890ecb2f86c517b8a8d95e7787`),
while its actual current-base diff contains only the intended notification and
display handlers. The display repository is the recap-only version
(`f42a638fb06789dc66635024be82e7e81050baf0f59285b8b885e8cbc2bcee1c`),
without the later report-helper extension.

## Current-base interaction adjudication

- **Personal preferences survive the merge.** The hook's diff against canonical
  adds only the notification implementation and Decimal import. The existing
  personal-preference DTO aliases, schemas, `/settings/user-preferences` endpoint,
  subject validation, submitted-field acknowledgement, serialized mutation scope,
  cancellation and operation-lifetime guards are unchanged. The CSRF fixture
  continues to exercise that personal endpoint with its valid response; its
  notification fixture now acknowledges a real nonempty submission. Household
  `/preferences` remains a separate guarded route and schema.
- **Notification acknowledgements are checked before effects.** The merged hook
  validates row shape, duplicate types, subject, every requested type/channel and
  decimal-equivalent threshold before cache merge or success handling. It retains
  untouched cache rows. Zero, explicit null and omission keep distinct meanings.
  The form retains failed and newer drafts. Current `apiCall`, protected fetch,
  keyed data provider and lifetime-bound query-client interfaces remain compatible
  with both notification guards and recap callbacks.
- **Recap correction survives.** All five defined submitted fields must be
  acknowledged after response-shape validation. Revision-based draft retirement
  preserves edits and reverts made during a save. The current-base query client
  still fences mutation callbacks from retired identity lifetimes. Recap's day is
  stored independently of the user's first-day-of-week preference.
- **The server batch is coherent.** General, investment and recap preference
  writers acquire the same existing user row before reading or creating a
  notification row. Display operations use that same ordering. Full general
  batches validate before writing and execute in one transaction; audits remain
  after commit under the existing best-effort policy. Existing-row omissions,
  explicit false/null/zero and each route's creation defaults are preserved.
  Current authenticated route mounting continues to derive the subject from the
  session/resolved user rather than request payloads; personal settings do not
  newly require household membership. Existing profile DTO and household-policy
  guards are unchanged by the controller reconciliation.
- **Existing callers remain compatible.** Registration's display creation remains
  valid before its user session is exposed. Current report-widget PATCH passes
  the separate `reportWidgetPreferences` column through `UserRepository`; the
  recap helper's `dashboardWidgets` sibling-preservation rule does not discard
  that column. No later report behavior is implicitly imported or approved.
  Legacy facade definitions were distinguished from live callers. The port does
  not claim to repair report concurrency, historical duplicate notification rows,
  or arbitrary direct database writers.

This review inspected the actual current-base diffs, selected author comparisons,
merged hook/fixture, form behavior, repositories, schemas and relevant live
routes/callers. Matching old bytes establishes provenance; checking their current
callers establishes the bounded compatibility conclusion.

## Current-port evidence

The coordinator's retained command identifies the pinned Node 24.22.0 executable,
this port cwd and all eight client files. Its result records exit 0; the verbose
raw log identifies **143 passed across eight files**. These include the real
notification hook/form acknowledgement and partial-save tests, corrected recap
form tests, both canonical personal-preference suites, existing lifetime controls
and both CSRF suites. These are client tests, not server/database or browser
acceptance.

Packet: `.local/r05-settings-port-oct31a/{client-command.json,client-result.json,client.log}`.
Verified raw log SHA-256:
`c3ae4a1c8326bf00bb3a9f4462f73ee085d8943198d09241787ac55ae44dc2ae`.
The exact source freeze was independently rehashed after that run; all 22 entries
matched. Earlier source-candidate database results remain historical and are not
attributed to this port.

The coordinator's full static check subsequently completed with exit 0, including
TypeScript, LOC, no-storage, Node-tool syntax, metadata/status and W9/W10 guards.
The command, result and raw log were inspected; `check.log` SHA-256 is
`dac2a7a5455673e7d20d73462b4a5df279831c3c3243cd28c0b329110d68f0c8`.
An additional current-port personal-preference DTO unit run passed **13/13**;
its command/result/raw log were inspected, with `dto.log` SHA-256
`2e73ab02ff9e9127d9235e4e602d5f900eb90bf864f98c86e1dda13afdb52abd`.
The `--server` test selector in that command does not turn these pure contract
unit cases into HTTP/database evidence.

Verified `.local/r05-settings-port-oct31a/verification.json` SHA-256:
`14e5beba828d225dbbad9e6e7db614cf9c87971a645fc9f34c1ac648c08d30e7`.
All 14 evidence hashes/lengths and all 22 source hashes/lengths matched on final
inspection. The earlier 53-test baseline is not added to the current 143+13 total.

The separate TypeScript reviewer initially failed because network permission
was revoked. The coordinator subsequently reported a successful read-only retry
with no actionable issue in the eight client paths, verifying the exact merged
pins and six copied files. Preserve the initial terminal failure as well as that
successful retry. This is a reported independent-review disposition, distinct
from this reviewer's direct inspection and verification of the static/unit logs;
approval is not inferred from the failed attempt or older candidate reviews.

## Remaining gates

The frozen source is suitable for preservation as the bounded current-base
candidate. Keep all 22 files together and preserve the newer client corrections.
Any subsequent source change requires corresponding review/pin reconciliation.
The coordinator retains commit/integration ownership. This report grants no
database startup, alternate executor, browser run or runtime exception while the
existing database authorization question remains unanswered. Fresh protected
server/database and browser acceptance, whole-R05 closure and release approval
remain separate from source clearance and client/static checks.

## Review Summary

| Severity | Count | Status |
| --- | --- | --- |
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: APPROVE the exact bounded current-base source port and the current
client/DTO unit and static evidence described above for WIP preservation. Fresh
server/database/browser acceptance and canonical integration remain outside this
review; no whole-R05 or release approval is given.
