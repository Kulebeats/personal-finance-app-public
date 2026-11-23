# R09 / FIN-15 CSV dates — local source checkpoint

This is a bounded implementation candidate, not R09 closure. R08 dependency,
financial correctness, HTTP/database persistence, broad tests and browser/native
acceptance remain open. Canonical integration belongs to the coordinator.

## Reading order and identity

1. `CSV-DATE-PLAN.md` for ownership, supported inputs and settled contracts.
2. `shared/import-date.ts`, then `server/services/import/parse.ts`.
3. Both import client paths, then the two services and the global route.
4. Focused tests and command evidence below.

Worktree: `C:\Users\USER\.codex\worktrees\760c\personal-finance-app`.
Branch: `codex/r09-csv-date-format`.
Base: `de61805c72d440f093eb6523f04eab9f328bf009`.
Source was reviewed before the coordinator-authorized scoped local commit. The original receipt at
`.local/r09-csv-date/source-receipt.json` covers 24 changed source/test/plan files;
its SHA256 is `862f3c6de7e0fff7b79c83422c15ab08931facb29eb9b1f883de51cc9355a37f`.
This handoff was added afterward; it is not included in that original receipt.
The approved revised freeze is `.local/r09-csv-date/source-receipt-reviewed.json`,
covering all 25 changed source/test/plan/handoff files, SHA256
`d8540dc5a4a76233b7901eb4790afb14718aba746535d6d44ee80868dccb3448`.
All 25 hashes were rechecked before recording final review dispositions and this
proposed acceptance checklist. Production/test/plan contents remain identical to
that approved receipt. The documentation-only handoff update is captured in
`.local/r09-csv-date/source-receipt-commit.json`. Preserve all receipts.

## Implemented behavior and caller trace

Global: upload raw records -> column mapping and explicit date format -> review
normalizes through `previewImportDates` -> ProgressModal snapshots raw rows,
mapping and selected format without overwriting cells -> `executeImportSchema` validates format enum ->
`ImportService.executeImport` calls `parseRows` with that format -> repository
writer receives the calendar string. Date-range boundaries use UTC day strings,
so host timezone cannot move an ISO day to its prior day.

Account: AccountDetail -> ImportTransactionsModal -> `parseTransactionCsv` uses
the same normalization -> preview shows canonical dates -> existing
useImportTransactions/accountsApi DTO carries those exact dates -> existing
transactionImportSchema accepts only valid canonical dates -> AccountImportService
independently validates the entire batch before its first transaction writer.
Format changes reparse source; file changes/removal clear prior preview. A file
read version prevents a previous read from restoring stale source after removal.
No shared account hooks/DTO/controller signatures were changed.

`2026-02-30`, invalid leap days, and unresolved `01/02/2026` produce row/date
errors. DD/MM/YYYY yields `2026-02-01`; MM/DD/YYYY yields `2026-01-02`. Existing
unambiguous ISO, numeric slash, year-first slash and English month-name forms
are exercised. Supported ISO timestamps preserve the written day after validating
calendar, time and offset components. The contract is in `CSV-DATE-PLAN.md`.
No product year bounds were invented.

## Verification and exact commands

Use Node 24.22.0 ARM64 from
`C:\Users\USER\AppData\Local\capital-r00-runtime\node-v24.22.0-win-arm64`.
Its executable SHA256 matches the coordinator-provided runtime:
`df4b0e71e4e4d022bf8582fbe75f6061feb9c4a111a86f3fec6300d24b6fe5e0`.
Prepend its directory to PATH and remove NODE_OPTIONS/NODE_PATH. All test
commands below used `scripts/run-protected-tests.mjs unit`; no live DB target,
native service or outbound provider was enabled.

| Log under `.local/r09-csv-date/` | Result and scope |
| --- | --- |
| `parser-red.log` | exit1; actual parser 14 failed / 32 passed before implementation |
| `account-red.log` | exit1; actual account service 3 failed / 1 passed; invalid dates were accepted by mocked writer |
| `client-red.log` | exit1; 4 missing preview/validation failures; also revealed test-fixture queryFn console warnings |
| `server-green1.log` | exit1; 49 passed / 1 stale exact error-message expectation; richer calendar message retained |
| `client-green1.log` | exit1; account behavior passed, global fixture queryFn warnings remained; fixture repaired |
| `server-green3.log` | exit0; 89/89 across six focused server files |
| `client-green3.log` | exit0; 9/9 across three focused client files, including source replacement and explicit format selection |
| `shared-mapping-red.log` | exit1; 1 failed / 4 passed, reproducing independent review's Notes/Merchant/Category alias corruption |
| `server-reviewed-final.log` | exit0; 91/91 focused parser/service/route, alias-mapping and raw-snapshot assertions |
| `client-reviewed-final.log` | exit0; 11/11, including controlled late FileReader and pending-read format changes |
| `timezone-los-angeles.log` | exit0; 61/61 parser/global writer UNIT tests, TZ=America/Los_Angeles |
| `timezone-kiritimati.log` | exit0; same independent calendar assertions 61/61, TZ=Pacific/Kiritimati |
| `timezone-reviewed-los-angeles.log` | exit0; revised raw-row candidate 63/63, TZ=America/Los_Angeles |
| `timezone-reviewed-kiritimati.log` | exit0; revised raw-row candidate 63/63, TZ=Pacific/Kiritimati |
| `check1.log` | exit2; TypeScript rejected insufficient union narrowing; repaired |
| `check2.log` | exit0; TypeScript and all npm check static guards passed |
| `check-final.log` | exit0; all static guards passed on first reviewed production freeze |
| `check-reviewed.log` | exit0; TypeScript and all npm check static guards after raw-row repair |
| `dependency-copy.log` | robocopy exit1 (successful copy); 55,024 files, zero failures, matched package manifests |

Server focused GREEN command:

```powershell
node scripts/run-protected-tests.mjs unit vitest --server run services/__tests__/import.parse.characterization.test.ts services/__tests__/completion-r09.import-dates.test.ts services/__tests__/completion-r09.account-import-dates.test.ts services/__tests__/completion-r09.global-import-dates.test.ts services/__tests__/import.dedupe.characterization.test.ts routes/__tests__/import.test.ts --reporter=verbose
```

Client focused GREEN command (also run with TZ=America/Los_Angeles):

```powershell
node scripts/run-protected-tests.mjs unit vitest run --config client/vitest.config.ts client/src/components/import/__tests__/CsvDates.test.tsx client/src/components/import/__tests__/ReviewStep.test.tsx client/src/components/import/__tests__/importApi.csrf.test.ts --reporter=verbose
```

Each timezone command sets TZ as above and uses:

```powershell
node scripts/run-protected-tests.mjs unit vitest --server run services/__tests__/import.parse.characterization.test.ts services/__tests__/completion-r09.import-dates.test.ts services/__tests__/completion-r09.global-import-dates.test.ts --reporter=verbose
```

`npm run check` is the static command. `git diff --check` passed. A temporary
dependency junction was used for initial parser/account RED runs before the
coordinator's ordinary-copy direction arrived, then removed. All later tests use
an independent ordinary-file copy. No dependency installation or manifest change.

## Review and next action

Independent code/TypeScript review by `overnight_general_review` found one
confirmed medium defect: canonicalizing a raw date cell corrupts other mappings
that alias that column. It otherwise found no additional confirmed defect.
The alias regression reproduced against the reviewed candidate. The repair keeps
raw cells and explicit format, with immutable row/mapping/format snapshots before
async progress. Preview-to-actual-service-to-mocked-writer assertions verify both
slash interpretations, unchanged alias values/category lookup, and source
snapshot stability. Original production source and the original receipt are
preserved in `.local/r09-csv-date/reviewed-candidate/`.

On 29 October 2026 the coordinator (chat
`01a13cde-7224-79f1-a046-cceb179e707b`) relayed independent general re-review and
final Astra High approval of the exact revised 25-file receipt above, with no
remaining actionable findings. Both reviewers verified that receipt. The
coordinator authorized one scoped local commit and instructed implementation to
stop afterward. No merge, push, deployment or canonical status update is made in
this worktree. The actual local commit ID is reported in the final chat handoff.

The scoped source commit was later integrated canonically and focused checks
were rerun; see `CAMPAIGN.md` for that integration receipt. The coordinator's
protected HTTP/DB result is recorded below. The original unit tests mock
persistence and service collaborators; the route test invokes handlers without
an HTTP listener. Neither is persistence, sign/balance, UUID or financial-
readiness proof. FIN-04 and other R09 requirements remain outside the source
commit's acceptance.

## Original protected HTTP/DB acceptance proposal

This is a read-only proposal. The coordinator owns target allocation, fixtures,
runtime/browser scheduling and all execution. Do not reuse the R05 target or
connect to ambient `finance_app`. Use the existing protected database harness,
an explicitly assigned disposable synthetic run manifest, verified persisted
run marker, and exact integrated revision. Record expected/actual rows and
request/response evidence without treating UNIT results as database proof.

1. Global entrance: upload a synthetic statement, map date/amount and select
   each supported slash order. Capture preview and request snapshot. Submit
   `01/02/2026` once per selected order in isolated fixtures; independently expect
   `2026-02-01` and `2026-01-02` in response-associated DB rows and a subsequent
   read. Use distinct fixture accounts/merchants so unrelated dedupe does not
   hide date behavior. Reuse the date column for Notes/Merchant/Category in a
   separate fixture; verify raw metadata and category resolution remain intact.
2. Global negative bypass: directly submit impossible dates and unresolved auto
   ambiguity over real HTTP. Expect useful row/date errors and no corresponding
   transaction rows. Verify invalid rows do not widen the writer date range;
   any overwrite test needs separately reviewed fixtures because broader R09
   overwrite/transfer behavior remains open.
3. Account entrance: import the same ambiguous file, change format after preview,
   and verify preview and outgoing canonical dates agree. Read persisted dates
   after successful HTTP execution. If existing FIN-04 UUID/sign writer defects
   prevent a valid import, record that concrete blocker rather than repairing
   ledger behavior in this slice or claiming account persistence acceptance.
4. Account direct bypass: submit a valid first row followed by an impossible or
   noncanonical date. Expect HTTP400 with the indexed date field and zero writer
   effects for that batch. Distinguish valid `2028-02-29`/`2000-02-29` from invalid
   `2026-02-29`/`1900-02-29` and `2026-02-30`.
5. Timezone/browser: under coordinator-owned runs on both sides of UTC, compare
   independent literal dates through preview -> actual HTTP payload -> DB ->
   subsequent read/export for both entrances, including offset timestamps under
   the documented source-day semantics. Exercise pending file reads, replacement
   and removal; prove no stale preview or old selected interpretation is sent.
6. Preserve command exits, exact revision/target identity and observed blockers;
   clean only the run-owned fixtures under coordinator direction. Keep R09/R08,
   broader financial correctness and production release gates open regardless
   of this bounded date slice's outcome.

## Coordinator protected HTTP/DB execution, 29 October 2026 — partial

The coordinator ran the R09 author's untracked real-HTTP/DB test from
`C:\Users\USER\.codex\worktrees\760c\personal-finance-app` at branch
`codex/r09-csv-date-format`, commit
`6c8025e7541581b2f818cf86587c0e154e5e72bd`. Test source SHA-256 is
`1f31519a1d95ad316f6e4fe3a02f2f9409f3340f12ef4494d940b40ec488d0d4`. The
eight main parser/caller files were compared with canonical HEAD
`e161afebf87856cd240ce050f1c3732ab0cc2a2b`; their text matches after
line-ending normalization. This test file itself remains untracked in the
author worktree and has not been integrated or independently reviewed.

The protected manifest `.local/r01-integrated/target.json` verified loopback
`127.0.0.1:55432`, database `pfa_completion_identity_r01int15a1_test`, run ID
`r01int15a1`, and marker
`pfa-synthetic-test:v1:r01int15a1:pfa_completion_identity_r01int15a1_test`.
The first read-only preflight used a nonexistent `postgres` role and refused
before tests or writes. The corrected explicit login role `pfa_campaign` passed
the same marker check. The runner used database mode and the protected harness;
ambient `.env` was not used.

The single real HTTP/DB test file ran 35 cases: **24 passed, 11 failed**. All
11 global supported-date persistence/readback cases, the alias-preservation
case, six global direct-invalid no-write cases, and six account direct-invalid
atomicity cases passed. The 11 valid-date account import cases all failed their
required persistence assertions: the endpoint returned HTTP 200 with
`imported: 0`, `skipped: 1`, and zero stored rows. This proves the account
entrance cannot yet satisfy date persistence; it does not prove the reason is
date parsing. `AccountImportService` catches each writer exception and returns
it as a skipped row; the structured application log retained only a generic
`Error` name, so the underlying writer cause remains unproven. Keep the FIN-04
account writer dependency open and do not repeat this unchanged red run.

Post-run read-only verification confirmed the exact run marker and zero
remaining R09 test households, users, accounts, transactions or categories.
Raw test, preflight and cleanup logs plus a joined receipt are preserved in the
author worktree under `.local/r09-csv-date/`: `realdb-test-main.log` SHA-256
`0020acd0982ed765196808b43e87fed6568b766c7000218795921278f7fe3007`,
`realdb-preflight-main-corrected.log` SHA-256
`d9ec4b42fb61da1aa0295d575f7f0581fd97cbb0f9c5041fdf19ee35dd204c91`,
`realdb-cleanup-verification-main-v2.log` SHA-256
`a5f95673124e9687c5e740bc22e3f3c11f34bf2522c0c64d0feb4a700dfd6dee`, and
`realdb-main-execution-receipt.json` SHA-256
`31c275bb09a710816c702283855b9c34964addfeb58f70ec3faddcfbde5c2a1f`.
This is local synthetic HTTP/database evidence only; browser and full R09
acceptance remain open.

## Review follow-up and isolated writer diagnosis, 29 October 2026

Independent Luna Extra High general and TypeScript review found and resolved
two weaknesses in the prepared test: the global transaction-audit assertion
compared a transaction entity ID with an account ID, and the account negative
cases did not check merchant/audit effects. The coordinator added deterministic
full-row before/after snapshots of household merchants and transaction audits
to both negative paths, and narrowed their names to the exact effects checked.
Both reviewers accepted the corrective source diff; neither claimed a runtime
rerun or Astra final acceptance.

The original test bytes are preserved in the author's
`.local/r09-csv-date/realdb-test-before-review-oct29.ts` with the original SHA
above. The amended assertions ran under pinned Node 24.22.0 against the same
manifest/marker-verified disposable target: **12 passed, 23 filtered out**,
exit 0. This was a deliberately focused negative-case run, not a passing
35-case suite. All prior 11 account-success failures remain open and unchanged.
The executed test SHA was
`a5d0c88a66c1a638cd889ebe665de5faa09cfcb184a14b48467f487cb98cc3ef`.

Full `npm run check` then exposed a pre-existing test helper typing error:
`post` accepted `unknown`, which Supertest's `send` rejects. A separate Luna
build-error resolver changed only the parameter type to `object`; TypeScript
review confirmed the callers match. The corrected full check passed. Initial
exit 2 and corrected exit 0 outputs are both preserved. Final test SHA:
`d4d9dd99b6f168d372bd1b82f202264937b90e1f07a48f65efa10a13e9f4fa2e`.
No DB rerun followed that type-only change. The test is still untracked in the
author checkout, unintegrated and uncommitted.

The separate read-only [FIN-04 writer diagnostic](FIN-04-WRITER-TRACE.md)
confirmed the target's UUID column rejects the synthetic account-import key
with SQLSTATE 22P02 using equivalent prepared lookup predicates. It did not
rerun the HTTP writer or recover the prior swallowed error. Source tracing
also identifies occurrence identity and sign/balance problems, so a UUID-only
patch would not satisfy R08/R09. These repairs remain outside the FIN-15 slice.

Post-run readback confirmed the exact marker and zero matching fixture
households, users, accounts, transactions and categories. The owned cluster
was started from its existing campaign-only data directory and then
smart-stopped with no established connections. Shared PostgreSQL was untouched.
The receipt contains hashes for the SQL, raw test/cleanup/check logs and exits:
`C:\Users\USER\.codex\worktrees\760c\personal-finance-app\.local\r09-csv-date\review-followup-receipt.json`,
SHA-256 `0114f35dc94995179d614b9de1212e5a635e5a1b9fe208b38051bf2086886549`.
No canonical closure state, browser acceptance or release status changed.

## Preservation and current source reconciliation, 31 October 2026

Live chat inspection confirmed the separate R09 owner remains terminal/idle after
network permission revocation. Its only untracked source was the 206-line test
above. Parent preserved those exact bytes in local WIP
`fa07e8477773d991372679641c5d4a88b448cfdc`, branch `codex/r09-csv-date-format`;
the checkout is now clean. No test source changed and no check or runtime was run
during preservation. Explicit path staging, whitespace check and a limited
sensitive-pattern scan preceded the commit. This is not a history-wide secret
scan, remote backup, source integration or acceptance.

The commit's word "unexecuted" refers only to the final typed test bytes lacking
a subsequent database run. It must not erase the historical 24-pass/11-fail run,
the revised 12-pass/23-filtered negative run, or the final static-check success
recorded above. Current SHA256 `d4d9dd99b6f168d372bd1b82f202264937b90e1f07a48f65efa10a13e9f4fa2e`
matches review-followup-receipt.json exactly; parent rehashed that receipt as
`0114f35dc94995179d614b9de1212e5a635e5a1b9fe208b38051bf2086886549`.

Fresh bounded Sol Extra High TypeScript review found no new actionable issue in
the preserved test, confirming protected-target admission, negative effect checks
and genuine account-persistence failure assertions. It performed no execution.
The account cases exercise canonical API DTOs after normalization, not the browser
modal/CSV-reader journey. FIN-04, full R09/R08 acceptance and Astra final test
adjudication remain open. Do not rerun unchanged account failures.

Preservation receipts are canonical
`.local/backlog-preservation-oct31d/r09-test-oct31a/{pre.json,result.json}`.

Astra High subsequently cleared the exact preserved test source for WIP
preservation only, verifying all 206 lines, actual callers/guards/cleanup and all
15 artifact hashes referenced by the receipt. No new actionable finding or
runtime execution occurred. This supersedes the pending final source adjudication
above; the eleven known account failures, database/browser acceptance, financial
repair and canonical test integration remain unresolved.
