# Priority repairs

Updated 15 November 2026. States describe completion of each whole priority item, not earlier partial work. The full master specification remains in force. Tests shown here will be the tests for these repairs; previous campaign results remain in the evidence ledger. Existing candidates are preserved while priority repairs take the next ready test window.

| Item | State | Commit | Tests (passed / total) | Callers covered / not yet covered | Waiting on owner for |
| --- | --- | --- | --- | --- | --- |
| 1. AI assistant cache privacy | fixing | Local cache repair and fixture cleanup candidates | Focused signed cases 20 / 20, unit cases 94 / 94, project checks 9 / 9. Earlier full server run 6,078 / 6,095, with 10 failures and 7 setup skips | All nine cacheable tools and access guards covered. Fixture cleanup fixes are committed locally. The next run must reach the seven skipped assertions and verify cleanup before full acceptance. Separate uncached privacy gaps remain open | Protected test window release |
| 2. Shared security prices | fixing | Local candidates for metadata creation and scheduled purchase confirmation | Baseline 1 / 12, with 11 confirmed failures | Signed baseline covered shared price writes and recording without confirmation. The creation candidate rejects supplied prices. Household price update isolation still needs implementation. The confirmation flow and storage guards need verification | Protected test window release when the source is ready. Owner selected an explicit validity end date |
| 3. Older transactions | not started | None | Not run | Metadata edits, deletion and amount changes on old records not yet covered by this repair | Any recovery decision follows a justified inventory; no invented posting history |
| 4. Older holdings | not started | None | Not run | Old holdings buy and sell recovery not yet covered | Any recovery decision follows a justified inventory; no invented lots |
| 5. Report export permissions and audit | not started | None | Not run | Creation and download for every export type remain to be verified | Nothing currently |
| 6. Private investment performance and account visibility | not started | None | Not run | Performance readers and account updates remain to be verified | Nothing currently |
| 7. Rule dry runs | not started | None | Not run | Tag links, merchant aliases and splits remain to be verified | Nothing currently |
| 8. Budget currency | not started | None | Not run | Progress, alerts and inline edits remain to be verified | Nothing currently |
| 9. Bond and Treasury bill input | not started | None | Not run | Writers and existing invalid rows remain to be checked before constraints | Nothing currently |
| 10. Transfer and trade retries | not started | None | Not run | Client key lifetime and server replay remain to be verified together | Nothing currently |
| 11. Bond sale cash posting | not started | None | Not run | Exactly-once cash posting and cancellation of remaining payments remain to be verified | Cash posting is settled; only an unsettled late-coupon tax or fee rule may need a proposal |
| 12. Held and overdue schedules | not started | None | Not run | Held-rule display, honest job results and catch-up remain to be verified; earlier recurring repairs are preserved | Nothing currently |
