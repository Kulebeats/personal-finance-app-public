# R18 offered balance-history copy control

Author: `C:\Users\USER\.codex\worktrees\capital-r18-balance-copy\personal-finance-app`,
branch `codex/r18-balance-copy`, base `9ff0f53fbd72843361766419f915aae8e2c1d279`.
Parent owns this bounded NEW-37/R18.2 repair while the assigned Sol agents remain
terminal on usage limits. No retry of unchanged quota errors and no substitute
review model. General/TypeScript and Astra final review remain required.

All 166 source paths from the preceding palette freeze were checked against their
recorded SHA256 before copying and again at destination. The inherited manifest is
`.local/r18-balance-copy/inherited-source.json`; its digest is
`54ea8f84a027609b2553874698750c9bf7c9030b01f483e5d8a0025b52976409`.
The preceding candidate is unchanged. No uploads, cookies or environment copied.

Confirmed source defect: AccountDetailHeader's Copy balance history item emits a
Feature moved toast instead of copying. The existing protected export API returns
the authorized CSV Blob. Reuse that API and exact CSV bytes as text; do not create
another financial export calculation, alter scope to a selected chart period, or
change the existing download action.

Owned files: AccountDetailHeader.tsx, adjacent useCopyBalanceHistory.ts and focused
component tests in detail/__tests__/AccountDetailHeader.copy.test.tsx. Verify real
header/menu interaction with mocked export and browser clipboard boundaries;
report success only after clipboard completion. Check denied/unavailable clipboard,
export failure and retry, pending duplicate action, account replacement/unmount,
and session retirement during export or text decoding. Never copy a stale result.
An already dispatched browser clipboard write is not cancellable; suppress late
notifications but do not claim to retract clipboard contents after dispatch.

No shared API, financial rules, database, native addon or provider work is assigned.
Full authenticated browser/clipboard permissions and persistence evidence remain
separate from component tests. Source stays isolated pending independent review;
all 101 closure groups and the campaign goal remain OPEN.

## Verified local checkpoint and next review

The real header/menu regression failed before implementation: 1 failed, clipboard
never called (`component-red.log`). Final focused component suite passes 10/10
(`component-first.log`, 3.55s). It checks exact CSV text, delayed success, both
export and write failures with retry, unavailable clipboard before fetch, pending
disable, account/unmount/session retirement, delayed Blob decoding and late write
notification suppression. Export and clipboard are mocked in this component suite.

The isolated browser fixture uses the actual header, copy hook, DropdownMenu and
operation lifetime, with synthetic export data and toast output. Clipboard APIs are
unmodified. Chromium 145.0.7632.6 gets explicit clipboard permissions on the owned
loopback origin. Three complete scenarios pass: exact native write/readback;
export failure preserving the sentinel followed by explicit retry; held export,
disabled action and session retirement preserving the sentinel/no success message.
No full-app authentication, server permission enforcement, database persistence,
clipboard permission prompting/denial in a real browser, Safari/Firefox, CSS/layout
or phone acceptance is claimed. This fixture deliberately has no application CSS.

First browser packet `ad451c4a-ba70-4732-ad6f-a816aac19445` failed dependency
scanning because the accounts barrel imported unrelated import modals with hooks
outside the inert fixture. The fixture now resolves that exact barrel to the real
TimeRangeSelector module used by the header; no production change or timeout
increase. The full passing packet is `8c1e870a-9280-48b0-88dc-da5c016f15fd`.
Both packets and command logs remain. The passing packet has no console/page
errors or forbidden requests; browser and Vite close successfully.

Full `npm run check` passed twice, including `check-final.log` after browser fixture
addition. No LOC baseline changes, new oversized files or grown debt. Production
header shrinks five lines. Final source parity and process checks pass; no owned
browser/Node process or relevant listener remains and no database was started.

Source freeze: 173 files, seven owned, all 166 inherited paths unchanged.
`.local/r18-balance-copy/source-freeze.json` SHA256:
`7a3b44ff9aaf7b9e0ed1376282f9e0fc4674cbe15d85e8a6185b0ffcbc02d4be`.
The freeze was written while final check ran; the later canonical receipt records
its observed exit 0. Canonical 18-file copy, each hash verified:
`.local/r18-balance-copy-oct30/receipt.json`, SHA256:
`1218e66025683830a9a052198282e93adc65695fea594783151fad5ff9a3349e`.
Final seven source snapshots are under `final-source/` in both evidence roots.

Reviewer reading order: this brief, NEW-37/R18 in master, the seven owned source
paths in the freeze, then raw RED/GREEN/browser/verification evidence. Review
the captured account/session lifecycle before export decoding and clipboard
dispatch, duplicate-action lock and cleanup, honest generic failure/retry,
unchanged authorized CSV/download semantics, and the browser fixture's boundaries.
Code and TypeScript review remain required; no author self-approval. All assigned
Sol agents remain terminal on usage limits, so no approval has been obtained for
these bytes. Astra final/canonical integration remain pending. Do not rerun passing
checks unchanged merely to wait for reviewer capacity.

Reproduce from the author using pinned Node 24.22.0 and protected unit launcher:
`node scripts/run-protected-tests.mjs unit vitest run --config client/vitest.config.ts client/src/features/accounts/components/detail/__tests__/AccountDetailHeader.copy.test.tsx`.
Browser command: `node scripts/run-protected-tests.mjs unit tsx client/src/features/accounts/components/detail/__tests__/browser-balance-copy/BalanceCopy.browser.mjs`;
set `PFA_COMPONENT_BROWSER_EXECUTABLE` to the exact executable recorded in the packet.
Parent retains execution scheduling. Address review findings before local source
integration; no production/shared DB, external delivery, paid service or release
authority is added by this candidate.

## Independent approval and canonical integration,30 October2026

This supersedes the earlier pending-review status for these seven owned paths.
Sol Extra High code/TypeScript reviewer r18_goal_review and independent general
reviewer r20_native_probe found no actionable defects. Astra High
r20_graph_final_review gave final exact-source approval after checking all source,
receipt and dependency hashes. No inherited166 paths are approved or copied.
An initially suggested CRLF fixture issue was retracted after inspecting actual
character codes; the existing source escapes represent real CRLF and were unchanged.

Parent copied only seven owned files onto canonical8467ec4a, preserving every
reviewed byte. Fresh protected component tests pass10/10 (31/31 combined with the
separate greeting port). Fresh native Chromium fixture passes all3 scenarios:
exact write/readback, export-error retry, and pending session retirement. Packet:
.local/r18-balance-copy/browser-1316e7c0-cac8-423e-bbc1-b7935dfb1cfd.
No forbidden requests or page/console errors; browser/server close successfully.
Recorded browser process IDs and owned listening port are absent afterward.
Pinned Node24.22.0 repository npm check passes including TypeScript/all guards.
All10 combined UI source hashes match postflight; no source changed after review.

Shared canonical21-file evidence receipt in
.local/r18-copy-greeting-integration-oct30/receipt.json has SHA256
4c300795db3c42e65bc231e755dbb4ce8be92f255d310ca274504d61fab20a7d.
These are new canonical runs, distinct from copied historical author logs.
Original failed/browser packets remain untouched. Clipboard permission prompts,
full authentication/authorization/persistence, other browsers and physical devices
remain outside this fixture; R18 and all101 groups remain OPEN.
