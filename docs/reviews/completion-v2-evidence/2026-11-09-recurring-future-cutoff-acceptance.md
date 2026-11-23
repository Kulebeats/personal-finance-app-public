# Recurring HTTP future-cutoff guard

Bounded local R14 acceptance under the master specification's future-asOfDate prohibition (lines 222 and 1339). All 101 master closure groups remain OPEN.

## Source and contract

Canonical base: `50a1feb10a475328483c993703fff640f8fd5b06`. Tests-only RED: `60338128f5ff78020fd88ffc2080153a4aee5980`. Tested product: `571ccdcc3e950f8d1c857f40c41782b586a65780`.

Author checkout: `C:/Users/USER/.codex/worktrees/capital-recurring-cutoff-nov09/personal-finance-app`, branch `codex/recurring-cutoff-nov09`.

The sole product change is `processRecurring` in `server/modules/recurring/recurring.controller.ts`. After strict calendar-date validation, it captures UTC today once. A supplied future date receives HTTP 400 `VALIDATION_ERROR`, field `asOfDate`, before the service or batch audit runs. The effective cutoff is reused for processing and its batch audit. This applies to owner, admin and member, including dry runs. Past, today and bodyless requests remain supported. Trusted service/cron entry points, financial posting dates, cursor logic, schema and role capabilities are unchanged. Existing operational UTC is preserved; broader household-timezone and catch-up contracts are not settled by this repair.

Tests add the signed suite `server/modules/recurring/__tests__/completion-r14.recurring-cutoff.realdb.integration.test.ts` and one midnight case to existing `server/modules/recurring/__tests__/recurring.integration.test.ts`. Original controller cases remain unchanged. The signed fixture creates valid rules and signs in genuine verified actors. Existing posted-pending cash behavior is explicit: an admitted expense of 7.25 changes 988.89 to 981.64.

## Protected evidence

Raw paths are beneath the author checkout's `.local/`. Artifact counts exclude their manifest. Root and independent Astra rehashed every recorded artifact successfully.

| Packet | Source | Result | Artifacts | Manifest SHA256 |
| --- | --- | --- | --- | --- |
| `astra-recurring-cutoff-unit-red45a` | 60338128 | 74 pass, 1 expected failure of 75 | 4 | `339FA78ADCA04F223C0FB6AD85D83250A94B1A86CA6422513E3784123991D804` |
| `astra-recurring-cutoff-db-red45b` | 60338128 | 6 pass, 6 expected failures of 12 | 20 | `CD1DB7B5D82AF1E6BAEFA2C5B3F4DD3485A2903053500DCEB6779920D75608B1` |
| `astra-recurring-cutoff-unit-green45c` | 571ccdcc | 75/75 pass | 4 | `A5279142D5C212C6BEEB578BB80AE3A8D2ABB03CFB82E929B27B4443F59C366F` |
| `astra-recurring-cutoff-callers-green45d` | 571ccdcc | 17/17 pass across three files | 20 | `C0EC7E995C5A693337292726E5B8548AA89E64FB3AFAA93FC800D8D9652AE316` |
| `astra-recurring-cutoff-project45e` | 571ccdcc | All nine project steps exit 0 | 11 | `09035D2A85792F7F69936BEFFA0BF622E76DDFE3BBEEDBA6D68D9A268CCC88CB` |

45a reached both mocked-controller failures: the service received undefined rather than February 28, and the audit recorded March 1 after the awaited call crossed midnight. This is a synthetic boundary test, not a naturally occurring midnight HTTP request.

45b reached six signed role/mode failures. All three writer roles received 200 for a future cutoff. Each non-dry request persisted an early transaction, changed balance and advanced its cursor. The three future dry runs stayed read-only but were incorrectly admitted. All six positive/control cases passed. Marked target `pfa_completion_scope_recurringcutoffred45b_test`, OID 1934598, had 29 migrations, READ COMMITTED and all six primary, nine scope and three recurring counters zero before and after.

Before the actual 45b run, the operator refused a CRLF snapshot hash before any database action. Preserve `.local/astra-recurring-cutoff-db-red45b-source-refusal` and its two hashed refusal/repair records. Restoring LF produced reviewed snapshot SHA256 `8F4A7434158400F35C19B5F5572C6D87E82C6618A3F474EA50F273E61A8F39F0`, with normalized content unchanged and no Git content diff. That refused attempt is not a test baseline.

45c reaches the corrected single-cutoff assertions. 45d reaches all six future rejections with no financial, cursor, history, link or audit effects; permitted past/today/bodyless requests, read-only dry run, malformed-date and nonwriter controls, and the trusted explicit service caller pass. The unchanged existing suites are `services/recurring/__tests__/processRecurring.materialization.realdb.integration.test.ts` (three cases) and `services/recurring/__tests__/processRecurring.atomicity.test.ts` (two), covering overlap, idempotency, audit, injected rollback and retry. These five cases are real database service calls, not signed HTTP requests.

GREEN target `pfa_completion_scope_recurringcutoffgreen45d_test`, OID 1937697, had 29 migrations and READ COMMITTED. All six primary, nine scope and five recurring/category counters were zero before and after, including other database clients. Source PRE/POST stayed clean at 571ccdcc. Both targets and every failed packet are preserved.

45e used pinned Node 24.22.0 and a fresh compiler cache. Runtime guard, TypeScript, storage-import guard, LOC, Node-tool syntax, assessment metadata/status, W9 and W10 checks all exited 0 in one uninterrupted run. No new build or browser result is claimed for this controller change; earlier evidence remains tied to its original source.

## Review and integration boundary

Independent Astra reviewed fixtures, protected operators, reached RED failures, exact product and GREEN/project evidence. Separate Sol TypeScript/source review found no actionable issue and ran no compiler or tests. Root alone serialized protected commands on the previously approved marked PostgreSQL 18.6 cluster at 127.0.0.1:55432.

This document and its CAMPAIGN entry are documentation-only descendants of tested 571ccdcc. Final exact-document and source-equivalence review precede canonical fast-forward; preparation is not integration. Full R14 registry, fencing, bounded catch-up, timezone policy, scheduled staging triggers and all other original requirements remain open. Separate R08/C2/R09 ownership persists. No push, PR, main merge, shared/production database change, external delivery, paid provider, deployment or release is authorized or claimed.
